import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { InboxItem, InboxApp, MeetingReview, MeetingNotes, Rule, Task, SourceApp } from '../../shared/types.ts';
import { appsForSecret, parseInboxBody, isWorkAccount, INBOX_APPS, type InboxPost } from '../lib/inbox-parse.ts';
import { parseRule, matchRule, taskFromRule, safeRegex } from '../lib/rules.ts';
import { seal, openAll, open } from '../lib/enc.ts';
import { now, audit, getSettings } from '../lib/db.ts';
import { localDate } from '../lib/dates.ts';
import { oneOf, text, num, bool, dateTime } from '../lib/validate.ts';
import { buildTaskFromSource, insertTaskStmt, updateTask, loadTask, addEvent } from './tasks.ts';

const inbox = new Hono<{ Bindings: Env; Variables: Variables }>();
export const rules = new Hono<{ Bindings: Env; Variables: Variables }>();

type RuleRow = Parameters<typeof parseRule>[0];
const ITEM_COLS = ['id', 'app', 'kind', 'work', 'title', 'body', 'url', 'ref', 'suggest', 'payload', 'state', 'rule_id', 'task_id', 'snoozed_until', 'received_at', 'updated_at', 'enc_v'] as const;
// inbox_items has no `kind: 'work'` column (its kind is notification/meeting/email), so the cipher kind comes from the `work` flag.
const sealed = (env: Env, i: InboxItem) => seal(env, 'inbox_items', { ...i, enc_v: 0 }, i.work ? 'work' : 'personal'); // a copy: the caller's item stays plaintext
const str = (v: unknown) => (typeof v === 'string' ? v : null);

async function insertItemStmt(env: Env, item: InboxItem): Promise<D1PreparedStatement> {
  const s = await sealed(env, item);
  item.enc_v = s.enc_v;
  return env.DB.prepare(`INSERT INTO inbox_items (${ITEM_COLS.join(',')}) VALUES (${ITEM_COLS.map((_, i) => `?${i + 1}`).join(',')})`)
    .bind(...ITEM_COLS.map((k) => (s as Record<string, unknown>)[k] ?? null));
}
/** Rewrites the item's text columns (title, body, payload share one cipher rule) plus the given plain columns. */
async function saveItemStmt(env: Env, item: InboxItem, cols: string[]): Promise<D1PreparedStatement> {
  const s = await sealed(env, item);
  item.enc_v = s.enc_v;
  const all = [...new Set(cols.concat('title', 'body', 'payload', 'updated_at', 'enc_v'))];
  return env.DB.prepare(`UPDATE inbox_items SET ${all.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
    .bind(item.id, ...all.map((k) => (s as Record<string, unknown>)[k] ?? null));
}
async function loadItem(env: Env, id: string): Promise<InboxItem | null> {
  const row = await env.DB.prepare('SELECT * FROM inbox_items WHERE id = ?1').bind(id).first<InboxItem>();
  return row ? open(env, 'inbox_items', row) : null;
}

const arrJson = (v: unknown): string => JSON.stringify(Array.isArray(v) ? v : []);
const parseArr = (v: unknown): unknown[] => { try { const a = JSON.parse(String(v)); return Array.isArray(a) ? a : []; } catch { return []; } };
const asReview = (r: Record<string, unknown>): MeetingReview => ({ ...(r as unknown as MeetingReview), decisions: parseArr(r.decisions) as MeetingReview['decisions'],
  action_items: parseArr(r.action_items) as MeetingReview['action_items'], open_questions: parseArr(r.open_questions) as MeetingReview['open_questions'],
  important_notes: parseArr(r.important_notes) as MeetingReview['important_notes'] });

/** A source_ref is unique among live tasks: a finished or trashed task gives its ref up to the new occurrence (so restoring it stays possible); an open one keeps it (the new task goes without). */
export async function claimRef(env: Env, ref: string | null): Promise<string | null> {
  if (!ref) return null;
  await env.DB.prepare(`UPDATE tasks SET source_ref = NULL WHERE source_ref = ?1 AND (status = 'done' OR deleted_at IS NOT NULL)`).bind(ref).run();
  const held = await env.DB.prepare('SELECT 1 AS x FROM tasks WHERE source_ref = ?1 AND deleted_at IS NULL').bind(ref).first();
  return held ? null : ref;
}

/** A task's notes: the short body, or for forwarded email the full text. */
const noteFor = (app: string, body: string | null, payload: unknown): string | null =>
  ((app === 'email' ? str((payload as { text?: unknown } | null)?.text) : null) ?? body)?.slice(0, 20000) || null;

async function ingestMeeting(env: Env, post: InboxPost): Promise<{ item: InboxItem; review: MeetingReview; created: boolean }> {
  const t = now();
  const n = post.payload as MeetingNotes;
  const rid = (post.ref ?? '').replace(/^sonarflow:recording:/, '');
  const f = { title: post.title, summary: str(n.summary), decisions: arrJson(n.decisions), action_items: arrJson(n.action_items), open_questions: arrJson(n.open_questions), important_notes: arrJson(n.important_notes) };
  const old = await env.DB.prepare('SELECT * FROM meeting_reviews WHERE recording_id = ?1').bind(rid).first<Record<string, unknown>>();
  const prev = await env.DB.prepare(`SELECT * FROM inbox_items WHERE ref = ?1 AND kind = 'meeting' ORDER BY received_at DESC LIMIT 1`).bind(post.ref).first<InboxItem>();
  const reviewed = old?.state === 'reviewed';
  const writes: D1PreparedStatement[] = [];
  let review: MeetingReview, created = false;
  if (old && reviewed) review = asReview(await open(env, 'meeting_reviews', old as { enc_v?: number }) as Record<string, unknown>); // left alone
  else if (old) { // a regenerated summary replaces the unreviewed one
    const s = await seal(env, 'meeting_reviews', { ...f, url: post.url, updated_at: t, enc_v: 0 }, 'work');
    writes.push(env.DB.prepare(`UPDATE meeting_reviews SET title=?2, summary=?3, decisions=?4, action_items=?5, open_questions=?6, important_notes=?7, url=?8, updated_at=?9, enc_v=?10 WHERE id=?1 AND state = 'new'`)
      .bind(old.id, s.title, s.summary, s.decisions, s.action_items, s.open_questions, s.important_notes, s.url, s.updated_at, s.enc_v));
    review = asReview({ ...old, ...f, url: post.url, updated_at: t });
  } else {
    const row = { id: crypto.randomUUID(), recording_id: rid, url: post.url, ...f, project_id: null, state: 'new', received_at: t, reviewed_at: null, updated_at: t, enc_v: 0 };
    const s = await seal(env, 'meeting_reviews', { ...row }, 'work');
    writes.push(env.DB.prepare('INSERT INTO meeting_reviews (id, recording_id, url, title, summary, decisions, action_items, open_questions, important_notes, project_id, state, received_at, reviewed_at, updated_at, enc_v) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)')
      .bind(s.id, s.recording_id, s.url, s.title, s.summary, s.decisions, s.action_items, s.open_questions, s.important_notes, s.project_id, s.state, s.received_at, s.reviewed_at, s.updated_at, s.enc_v));
    review = asReview(row);
    created = true;
  }
  // One "Meeting notes ready" row per recording, kept fresh when the summary is regenerated (not bumped once reviewed).
  let item: InboxItem;
  if (prev) { item = await open(env, 'inbox_items', prev); if (!reviewed) { Object.assign(item, { title: post.title, url: post.url, updated_at: t }); writes.push(await saveItemStmt(env, item, ['url'])); } }
  else {
    item = { id: crypto.randomUUID(), app: post.app, kind: 'meeting', work: 1, title: post.title, body: post.body, url: post.url, ref: post.ref, suggest: null, payload: null,
      state: 'added', rule_id: null, task_id: null, snoozed_until: null, received_at: t, updated_at: t, enc_v: 0 };
    writes.push(await insertItemStmt(env, item));
  }
  if (writes.length) await env.DB.batch(writes); // review and inbox row together
  await audit(env, 'rule', 'inbox.ingest', item.id, { app: post.app, mode: 'meeting', rule_id: null });
  return { item, review, created };
}

/**
 * Takes one post from any sender (HTTP route, email handler): decides meeting / notification / email, applies the first matching
 * rule, dedupes on `ref`, writes the inbox row and creates or updates the task. Pushes are the caller's job.
 */
export async function ingest(env: Env, post: InboxPost, opts: { work: boolean; from?: string | null }): Promise<{ item: InboxItem; task?: Task; review?: MeetingReview; created: boolean }> {
  if (post.kind === 'meeting') return ingestMeeting(env, post);
  const t = now();
  const { results } = await env.DB.prepare('SELECT * FROM rules ORDER BY sort').all<RuleRow>();
  const rule = matchRule(results.map(parseRule), post);
  const mode = rule?.mode ?? 'inbox';
  const today = localDate((await getSettings(env)).tz);
  const set = rule ? taskFromRule(rule, { app: post.app, kind: post.kind, title: post.title, from: opts.from ?? null }, today, opts.work) : null;
  const dedupe = rule?.dedupe ?? 'skip';
  const done = (item: InboxItem, m: string, extra: { task?: Task } = {}) =>
    audit(env, 'rule', 'inbox.ingest', item.id, { app: post.app, mode: m, rule_id: rule?.id ?? null }).then(() => ({ item, ...extra, created: false }));

  if (post.ref && dedupe !== 'always') {
    const prev = await env.DB.prepare(
      `SELECT i.* FROM inbox_items i LEFT JOIN tasks t ON t.id = i.task_id
       WHERE i.ref = ?1 AND i.kind != 'meeting' AND (i.state IN ('new','snoozed') OR (t.id IS NOT NULL AND t.status != 'done' AND t.deleted_at IS NULL))
       ORDER BY i.received_at DESC LIMIT 1`).bind(post.ref).first<InboxItem>();
    if (prev) {
      const item = await open(env, 'inbox_items', prev);
      if (dedupe === 'skip') { await env.DB.prepare('UPDATE inbox_items SET updated_at = ?2 WHERE id = ?1').bind(item.id, t).run(); item.updated_at = t; return done(item, 'skip'); }
      Object.assign(item, { title: post.title, body: post.body, url: post.url, updated_at: t });
      await saveItemStmt(env, item, ['url']).then((st) => st.run());
      const task = item.task_id ? await loadTask(env, item.task_id) : null;
      if (!task || task.status === 'done') return done(item, 'update');
      const fields = ['title', 'notes', 'source_url'];
      Object.assign(task, { title: post.title, notes: noteFor(post.app, post.body, post.payload), source_url: post.url, updated_at: t });
      if (set?.due_at) { task.due_at = set.due_at; fields.push('due_at'); }
      await updateTask(env, task, fields);
      await addEvent(env, task, 'rule', 'edited', fields);
      return done(item, 'update', { task });
    }
  }

  const item: InboxItem = { id: crypto.randomUUID(), app: post.app, kind: post.kind, work: opts.work || rule?.then_set.kind === 'work' ? 1 : 0, title: post.title, body: post.body,
    url: post.url, ref: post.ref, suggest: post.suggest, payload: post.payload == null ? null : JSON.stringify(post.payload),
    state: mode === 'ignore' ? 'dismissed' : mode === 'task' ? 'added' : 'new', rule_id: rule?.id ?? null, task_id: null, snoozed_until: null, received_at: t, updated_at: t, enc_v: 0 };
  let task: Task | undefined;
  if (mode === 'task' && set) {
    task = await buildTaskFromSource(env, { ...set, title: post.title, notes: noteFor(post.app, post.body, post.payload), source_app: post.app as SourceApp, source_kind: post.kind,
      source_ref: await claimRef(env, post.ref), source_url: post.url });
    item.task_id = task.id;
  }
  // The task and its inbox row go in together, so a failure can't leave an orphan task.
  await env.DB.batch([...(task ? [await insertTaskStmt(env, task)] : []), await insertItemStmt(env, item)]);
  if (task) await addEvent(env, task, 'rule', 'created', { inbox_id: item.id });
  await audit(env, 'rule', 'inbox.ingest', item.id, { app: post.app, mode, rule_id: rule?.id ?? null });
  return { item, task, created: !!task };
}

const WINDOW_MS = 60_000, MAX_POSTS = 120;
type Refusal = 400 | 401 | 403 | 413 | 429;
const refuse = (c: { json: (b: unknown, s: Refusal) => Response }, status: Refusal, error: string, caller?: string) => {
  console.warn(`inbox ${status}: ${error}${caller ? ` (caller ${caller})` : ''}`); // never the token
  return c.json({ error }, status);
};

// POST /api/inbox is the one public route: the guard lets it through (no cookie, no Origin) and the per-sender secret is checked here.
inbox.post('/', async (c) => {
  const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
  const apps = m ? await appsForSecret(c.env, m[1]) : null;
  if (!apps) return refuse(c, 401, 'Unauthorized');
  const caller = apps.join(',');
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM inbox_items WHERE received_at > ?1').bind(new Date(Date.now() - WINDOW_MS).toISOString()).first<{ n: number }>();
  if ((recent?.n ?? 0) > MAX_POSTS) return refuse(c, 429, 'Too many posts, slow down', caller);
  const raw = await c.req.text();
  if (raw.length > 200_000) return refuse(c, 413, 'body is too large', caller);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return refuse(c, 400, 'body must be JSON', caller); }
  const post = parseInboxBody(body);
  if (typeof post === 'string') return refuse(c, 400, post, caller);
  if (!apps.includes(post.app)) return refuse(c, 403, 'app does not match the secret used', caller);
  const p = (post.payload ?? {}) as { from?: unknown; account?: unknown };
  const work = post.kind === 'meeting' || (post.app === 'kelly' && post.kind === 'email' && isWorkAccount(p.account, (await getSettings(c.env)).work_email_domains));
  const { item } = await ingest(c.env, post, { work, from: post.kind === 'email' ? str(p.from) : null });
  return c.json({ id: item.id, state: item.state, task_id: item.task_id }, 201);
});

// Session routes below: the guard still requires the cookie and a same-origin request for everything but the POST above.
inbox.get('/', async (c) => {
  const t = now();
  await c.env.DB.prepare(`UPDATE inbox_items SET state = 'new', snoozed_until = NULL, updated_at = ?1 WHERE state = 'snoozed' AND snoozed_until <= ?1`).bind(t).run();
  const all = c.req.query('state') === 'all';
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM inbox_items ${all ? '' : `WHERE state = 'new' OR (state = 'added' AND updated_at >= ?1)`} ORDER BY received_at DESC LIMIT 200`,
  ).bind(...(all ? [] : [new Date(Date.now() - 86_400_000).toISOString()])).all<InboxItem>();
  return c.json({ items: await openAll(c.env, 'inbox_items', results) });
});

inbox.post('/:id/keep', async (c) => {
  const item = await loadItem(c.env, c.req.param('id'));
  if (!item) return c.json({ error: 'Not found' }, 404);
  let task = item.task_id ? await loadTask(c.env, item.task_id) : null;
  if (!task) {
    const row = item.rule_id ? await c.env.DB.prepare('SELECT * FROM rules WHERE id = ?1').bind(item.rule_id).first<RuleRow>() : null;
    const found = row ? parseRule(row) : null;
    const rule = found?.mode === 'inbox' ? found : ({ then_set: {} } as Rule); // only an inbox-mode rule applies; otherwise horizon short, kind from the item
    const set = taskFromRule(rule, { app: item.app, kind: item.kind, title: item.title, from: null }, localDate((await getSettings(c.env)).tz), !!item.work);
    let payload: unknown = null;
    try { payload = item.payload ? JSON.parse(item.payload) : null; } catch { /* not JSON: no extra text */ }
    const fresh = await buildTaskFromSource(c.env, { ...set, title: item.title, notes: noteFor(item.app, item.body, payload), source_app: item.app as SourceApp, source_kind: item.kind,
      source_ref: await claimRef(c.env, item.ref), source_url: item.url });
    item.updated_at = now();
    await c.env.DB.batch([await insertTaskStmt(c.env, fresh), c.env.DB.prepare(`UPDATE inbox_items SET state = 'kept', task_id = ?2, updated_at = ?3 WHERE id = ?1`).bind(item.id, fresh.id, item.updated_at)]);
    await addEvent(c.env, fresh, 'you', 'created', { inbox_id: item.id });
    task = fresh;
  } else {
    item.updated_at = now();
    await c.env.DB.prepare(`UPDATE inbox_items SET state = 'kept', updated_at = ?2 WHERE id = ?1`).bind(item.id, item.updated_at).run();
  }
  item.state = 'kept'; item.task_id = task.id;
  await audit(c.env, 'you', 'inbox.keep', item.id);
  return c.json({ item, task });
});

inbox.post('/:id/dismiss', async (c) => {
  const item = await loadItem(c.env, c.req.param('id'));
  if (!item) return c.json({ error: 'Not found' }, 404);
  item.state = 'dismissed'; item.updated_at = now(); // the task, if any, is untouched
  await c.env.DB.prepare(`UPDATE inbox_items SET state = 'dismissed', updated_at = ?2 WHERE id = ?1`).bind(item.id, item.updated_at).run();
  return c.json({ item });
});

inbox.post('/:id/snooze', async (c) => {
  const item = await loadItem(c.env, c.req.param('id'));
  if (!item) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<{ until?: unknown }>().catch((): { until?: unknown } => ({}));
  const r = dateTime({ nullable: false })(body.until, 'until');
  if ('error' in r) return c.json({ error: r.error }, 400);
  const until = new Date(r.value as string);
  if (Number.isNaN(until.getTime())) return c.json({ error: 'until must be a date and time' }, 400);
  item.state = 'snoozed'; item.snoozed_until = until.toISOString(); item.updated_at = now(); // UTC, so the wake-up compare is UTC to UTC
  await c.env.DB.prepare(`UPDATE inbox_items SET state = 'snoozed', snoozed_until = ?2, updated_at = ?3 WHERE id = ?1`).bind(item.id, item.snoozed_until, item.updated_at).run();
  return c.json({ item });
});

// ---- Rules: configuration, not user content, so DELETE is a real delete (no trash). ----
const BAD_REGEX = 'That pattern could be slow or is invalid. Use plain words or a simpler pattern.';
const MATCH_KEYS = ['suggest', 'kind', 'title_regex'], SET_KEYS = ['horizon', 'kind', 'project_id', 'due_offset_days', 'priority', 'status'];
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** Checks a rule body (every required field when `full`, only the present ones otherwise); returns the columns to write or an error message. */
async function checkRule(env: Env, b: Obj, full: boolean): Promise<{ cols: Obj } | { error: string }> {
  const cols: Obj = {};
  if (b.name !== undefined || full) { const r = text(80)(b.name, 'name'); if ('error' in r || !r.value) return { error: 'name must be 1-80 characters' }; cols.name = r.value; }
  if (b.app !== undefined || full) { if (b.app !== '*' && !INBOX_APPS.includes(b.app as InboxApp)) return { error: 'app must be an app or *' }; cols.app = b.app; }
  if (b.mode !== undefined || full) { const r = oneOf('task', 'inbox', 'ignore')(b.mode, 'mode'); if ('error' in r) return r; cols.mode = r.value; }
  if (b.dedupe !== undefined) { const r = oneOf('update', 'skip', 'always')(b.dedupe, 'dedupe'); if ('error' in r) return r; cols.dedupe = r.value; }
  if (b.enabled !== undefined) cols.enabled = (bool()(b.enabled, 'enabled') as { value: number }).value;
  if (b.sort !== undefined) { const r = num()(b.sort, 'sort'); if ('error' in r || r.value === null) return { error: 'sort must be a number' }; cols.sort = r.value; }
  if (b.match !== undefined) {
    const m = b.match;
    if (!isObj(m) || Object.keys(m).some((k) => !MATCH_KEYS.includes(k))) return { error: `match may only have: ${MATCH_KEYS.join(', ')}` };
    if (m.suggest !== undefined && (typeof m.suggest !== 'string' || !m.suggest || m.suggest.length > 40)) return { error: 'match.suggest must be 1-40 characters' };
    if (m.kind !== undefined && !['notification', 'meeting', 'email'].includes(m.kind as string)) return { error: 'match.kind must be notification, meeting or email' };
    if (m.title_regex !== undefined && (typeof m.title_regex !== 'string' || !m.title_regex || m.title_regex.length > 200 || !safeRegex(m.title_regex))) return { error: BAD_REGEX };
    cols.match = JSON.stringify(m);
  }
  if (b.then_set !== undefined) {
    const s = b.then_set;
    if (!isObj(s) || Object.keys(s).some((k) => !SET_KEYS.includes(k))) return { error: `then_set may only have: ${SET_KEYS.join(', ')}` };
    for (const [k, vals] of [['horizon', ['short', 'medium', 'long']], ['kind', ['personal', 'work']], ['status', ['new', 'progress', 'hold', 'waiting']]] as const) {
      if (s[k] !== undefined && !(vals as readonly string[]).includes(s[k] as string)) return { error: `then_set.${k} must be one of: ${vals.join(', ')}` };
    }
    if (s.due_offset_days !== undefined && !intIn(s.due_offset_days, 0, 365)) return { error: 'then_set.due_offset_days must be a whole number from 0 to 365' };
    if (s.priority !== undefined && !intIn(s.priority, 0, 3)) return { error: 'then_set.priority must be 0 to 3' };
    if (s.project_id !== undefined && !(typeof s.project_id === 'string' && (await env.DB.prepare('SELECT 1 AS x FROM projects WHERE id = ?1 AND deleted_at IS NULL').bind(s.project_id).first()))) return { error: 'then_set.project_id is not a project' };
    cols.then_set = JSON.stringify(s);
  }
  return { cols };
}

rules.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM rules ORDER BY sort, id').all<RuleRow>();
  return c.json({ rules: results.map(parseRule) });
});

rules.post('/', async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  const r = await checkRule(c.env, isObj(body) ? body : {}, true);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const t = now();
  const last = await c.env.DB.prepare('SELECT MAX(sort) AS m FROM rules').first<{ m: number | null }>();
  const row: Obj = { id: crypto.randomUUID(), match: '{}', then_set: '{}', dedupe: 'update', enabled: 1, sort: (last?.m ?? 0) + 10, ...r.cols, created_at: t, updated_at: t };
  const k = Object.keys(row);
  await c.env.DB.prepare(`INSERT INTO rules (${k.join(',')}) VALUES (${k.map((_, i) => `?${i + 1}`).join(',')})`).bind(...k.map((x) => row[x])).run();
  await audit(c.env, 'you', 'rule.create', row.id as string);
  return c.json({ rule: parseRule(row as unknown as RuleRow) }, 201);
});

rules.patch('/:id', async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  const r = await checkRule(c.env, isObj(body) ? body : {}, false);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const cols: Obj = { ...r.cols, updated_at: now() };
  const k = Object.keys(cols);
  const res = await c.env.DB.prepare(`UPDATE rules SET ${k.map((x, i) => `${x} = ?${i + 2}`).join(', ')} WHERE id = ?1`).bind(c.req.param('id'), ...k.map((x) => cols[x])).run();
  if (!res.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'rule.update', c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ?1').bind(c.req.param('id')).first<RuleRow>();
  return c.json({ rule: parseRule(row!) });
});

rules.delete('/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM rules WHERE id = ?1').bind(c.req.param('id')).run();
  if (!res.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'rule.delete', c.req.param('id'));
  return c.json({ ok: true });
});

export default inbox;
