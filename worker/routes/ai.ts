import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env, Variables } from '../types.ts';
import type { AiThread, AiMessage, LibraryPage, Provider } from '../../shared/types.ts';
import { PRESETS } from '../../shared/presets.ts';
import { isEmpty, splitAnswer } from '../../shared/ai-meta.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit, getSettings } from '../lib/db.ts';
import { localDate } from '../lib/dates.ts';
import { runAi, aiUsage, AiRefused, type AiTurn } from '../lib/ai.ts';
import { buildSystem, trimHistory } from '../lib/prompt.ts';
import { retrieve, modelPage } from '../lib/library.ts';
import { projectAccess, projectContext } from '../lib/project-context.ts';

const ai = new Hono<{ Bindings: Env; Variables: Variables }>();
type MsgRow = Omit<AiMessage, 'citations' | 'proposals'> & { citations: string; proposals: string | null };
const MSG_ORDER = 'ORDER BY created_at, rowid'; // a user message and its answer can share a millisecond

async function toMessage(env: Env, row: MsgRow): Promise<AiMessage> {
  const m = await open(env, 'ai_messages', { ...row });
  return { ...m, citations: JSON.parse(m.citations || '[]'), proposals: m.proposals ? JSON.parse(m.proposals) : null };
}
const liveThread = (env: Env, id: string) => env.DB.prepare('SELECT * FROM ai_threads WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<AiThread>();
const threadMessages = async (env: Env, id: string) =>
  (await env.DB.prepare(`SELECT * FROM ai_messages WHERE thread_id = ?1 ${MSG_ORDER}`).bind(id).all<MsgRow>()).results;

ai.post('/chat', async (c) => {
  const env = c.env;
  const b = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const absent = (v: unknown) => v === undefined || v === null;
  // 1. Validate.
  const rerun = b.rerun === true;
  if (!absent(b.rerun) && typeof b.rerun !== 'boolean') return c.json({ error: 'rerun must be true or false' }, 400);
  let message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!rerun && (typeof b.message !== 'string' || message.length < 1 || message.length > 8000)) return c.json({ error: 'message must be 1 to 8000 characters' }, 400);
  const preset = absent(b.preset) ? null : PRESETS.find((p) => p.id === b.preset);
  if (preset === undefined) return c.json({ error: `preset must be one of: ${PRESETS.map((p) => p.id).join(', ')}` }, 400);
  if (!absent(b.provider) && b.provider !== 'claude' && b.provider !== 'gemini') return c.json({ error: 'provider must be one of: claude, gemini' }, 400);
  if (!absent(b.page) && (typeof b.page !== 'string' || !/^[a-z0-9-]+$/.test(b.page))) return c.json({ error: 'page must be a library slug' }, 400);
  if (!absent(b.thread_id) && typeof b.thread_id !== 'string') return c.json({ error: 'thread_id must be text' }, 400);
  if (!absent(b.project_id) && typeof b.project_id !== 'string') return c.json({ error: 'project_id must be text' }, 400);
  if (rerun && absent(b.thread_id)) return c.json({ error: 'rerun needs a thread_id' }, 400);
  const settings = await getSettings(env);
  const provider: Provider = (b.provider as Provider | undefined) ?? settings.default_provider;

  // 2. Thread: an existing thread's project always wins over the body's.
  const thread = absent(b.thread_id) ? null : await liveThread(env, b.thread_id as string);
  if (!absent(b.thread_id) && !thread) return c.json({ error: 'Not found' }, 404);
  const projectId = thread ? thread.project_id : ((b.project_id as string | undefined) ?? null);

  try {
    // 3. Boundary and kind in one read, before anything is stored or sent. The kind sealed with is this one, never a later read.
    const access = await projectAccess(env, projectId);
    if (!access) return c.json({ error: 'Not found' }, 404);
    const { boundary, kind } = access;
    if (boundary === 'offline') throw new AiRefused('offline_boundary', 'This project is Offline only. Library search, templates and saved answers still work.');

    // 4. History (and, for a rerun, the question).
    let history: AiTurn[] = [];
    if (thread) {
      const turns = await Promise.all((await threadMessages(env, thread.id)).map((r) => toMessage(env, r)));
      const cut = rerun ? turns.map((m) => m.role).lastIndexOf('user') : turns.length;
      if (cut < 0) return c.json({ error: 'Not found' }, 404);
      if (rerun) message = turns[cut].content;
      history = turns.slice(0, cut).map((m) => ({ role: m.role, content: m.content }));
    }

    // 5. Library pages (model-facing only).
    let pages: LibraryPage[];
    if (!absent(b.page)) {
      const page = await modelPage(env, b.page as string);
      if (!page) return c.json({ error: 'Not found' }, 404);
      pages = [page, ...(await retrieve(env, page.title + ' ' + message, 6)).filter((p) => p.slug !== page.slug).slice(0, 5)];
    } else pages = await retrieve(env, message, 6);

    // 6–8. Prompt, model call, validated answer.
    const asked = now();
    const system = buildSystem({ today: localDate(settings.tz), pages, project: projectId ? await projectContext(env, projectId) : null, preset: preset?.id ?? null });
    const out = await runAi(env, preset?.feature ?? 'copilot', { provider, system, messages: [...trimHistory(history), { role: 'user', content: message }], maxTokens: 2000 });
    const answer = splitAnswer(out.text, new Set(pages.map((p) => p.slug)));
    // An empty answer (e.g. Gemini spent its budget thinking) is a provider failure: nothing is stored.
    if (!answer.content) throw new AiRefused('provider_error', `${provider === 'claude' ? 'Claude' : 'Gemini'} returned an empty answer.`);

    // 9. One batch, every row sealed with the project's kind.
    const t = now();
    const th: AiThread = thread ? { ...(await open(env, 'ai_threads', { ...thread })), updated_at: t }
      : { id: crypto.randomUUID(), project_id: projectId, title: message.slice(0, 60), provider, created_at: t, updated_at: t, deleted_at: null, enc_v: 0 };
    const msg = (role: 'user' | 'assistant', content: string, extra: Partial<AiMessage>, at: string): AiMessage => ({
      id: crypto.randomUUID(), thread_id: th.id, role, provider: null, content, citations: [], proposals: null, cost_micro: 0, saved: 0, created_at: at, enc_v: 0, ...extra,
    });
    const fresh = [
      ...(rerun ? [] : [msg('user', message, {}, asked)]),
      msg('assistant', answer.content, { provider, citations: answer.citations, proposals: isEmpty(answer.proposals) ? null : answer.proposals, cost_micro: out.cost_micro }, t),
    ];
    const stmts: D1PreparedStatement[] = [];
    if (!thread) {
      const s = await seal(env, 'ai_threads', { ...th }, kind);
      th.enc_v = s.enc_v;
      stmts.push(env.DB.prepare('INSERT INTO ai_threads (id, project_id, title, provider, created_at, updated_at, enc_v) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(s.id, s.project_id, s.title, s.provider, s.created_at, s.updated_at, s.enc_v));
    }
    for (const m of fresh) {
      const s = await seal(env, 'ai_messages', { ...m, citations: JSON.stringify(m.citations), proposals: m.proposals ? JSON.stringify(m.proposals) : null }, kind);
      m.enc_v = s.enc_v;
      stmts.push(env.DB.prepare('INSERT INTO ai_messages (id, thread_id, role, provider, content, citations, proposals, cost_micro, saved, created_at, enc_v) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)')
        .bind(s.id, s.thread_id, s.role, s.provider, s.content, s.citations, s.proposals, s.cost_micro, s.saved, s.created_at, s.enc_v));
    }
    if (thread) stmts.push(env.DB.prepare('UPDATE ai_threads SET updated_at = ?2 WHERE id = ?1').bind(th.id, t));
    await env.DB.batch(stmts);
    // 10. Plaintext back.
    return c.json({ thread: th, messages: fresh });
  } catch (e) {
    if (e instanceof AiRefused) return c.json({ error: e.code, message: e.message }, e.status as ContentfulStatusCode);
    throw e;
  }
});

ai.get('/threads', async (c) => {
  const p = c.req.query('project');
  const where = p === undefined ? '' : p === 'none' ? 'AND project_id IS NULL' : 'AND project_id = ?1';
  const { results } = await c.env.DB.prepare(`SELECT * FROM ai_threads WHERE deleted_at IS NULL ${where} ORDER BY updated_at DESC LIMIT 100`)
    .bind(...(p === undefined || p === 'none' ? [] : [p])).all<AiThread>();
  return c.json({ threads: await openAll(c.env, 'ai_threads', results) });
});

ai.get('/threads/:id', async (c) => {
  const thread = await liveThread(c.env, c.req.param('id'));
  if (!thread) return c.json({ error: 'Not found' }, 404);
  const messages = await Promise.all((await threadMessages(c.env, thread.id)).map((r) => toMessage(c.env, r)));
  return c.json({ thread: await open(c.env, 'ai_threads', thread), messages });
});

ai.delete('/threads/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE ai_threads SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'thread.trash', c.req.param('id'));
  return c.json({ ok: true });
});

ai.patch('/messages/:id', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  if (b.saved !== 0 && b.saved !== 1) return c.json({ error: 'saved must be 0 or 1' }, 400);
  const row = await c.env.DB.prepare('SELECT m.* FROM ai_messages m JOIN ai_threads t ON t.id = m.thread_id WHERE m.id = ?1 AND t.deleted_at IS NULL')
    .bind(c.req.param('id')).first<MsgRow>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.role !== 'assistant') return c.json({ error: 'Only answers can be saved' }, 400);
  await c.env.DB.prepare('UPDATE ai_messages SET saved = ?2 WHERE id = ?1').bind(row.id, b.saved).run();
  return c.json({ message: await toMessage(c.env, { ...row, saved: b.saved }) });
});

ai.get('/saved', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, t.title AS thread_title, t.project_id, t.enc_v AS thread_enc_v FROM ai_messages m JOIN ai_threads t ON t.id = m.thread_id
     WHERE m.saved = 1 AND t.deleted_at IS NULL ORDER BY m.created_at DESC, m.rowid DESC LIMIT 100`,
  ).all<MsgRow & { thread_title: string; project_id: string | null; thread_enc_v: number }>();
  const messages = await Promise.all(results.map(async ({ thread_title, project_id, thread_enc_v, ...row }) => ({
    ...(await toMessage(c.env, row)), project_id, thread_title: (await open(c.env, 'ai_threads', { title: thread_title, enc_v: thread_enc_v })).title,
  })));
  return c.json({ messages });
});

ai.get('/usage', async (c) => c.json(await aiUsage(c.env)));

export default ai;
