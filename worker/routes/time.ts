import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { Kind, TimeEntry } from '../../shared/types.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit } from '../lib/db.ts';
import { clampTs, MAX_RUNNING, MAX_ENTRY_MINUTES, MAX_NOTE, FUTURE_SLACK_MS } from '../../shared/time.ts';

/** Time entries (v2.5): list (incremental `since`), start or log, stop, edit, trash. A work entry's note is sealed. Kelly has no route here. */
const time = new Hono<{ Bindings: Env; Variables: Variables }>();
const readBody = (c: { req: { json: <T>() => Promise<T> } }) => c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
const MAX_MS = MAX_ENTRY_MINUTES * 60_000;
const COLS = ['id', 'task_id', 'project_id', 'kind', 'started_at', 'ended_at', 'note', 'source', 'auto_stopped', 'enc_v', 'created_at', 'updated_at', 'deleted_at'] as const;
const id40 = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 40;
const bad = (message: string) => ({ status: 400 as const, body: { error: 'bad_time', message } });
/** A running timer, as SQL: the partial index time_running covers it. */
const RUNNING = 'ended_at IS NULL AND deleted_at IS NULL';

type Result = { status: 200 | 201 | 400 | 404 | 409; body: Record<string, unknown> };

/**
 * POST /api/time, also for the widget route (Task 4): `task_id` xor `project_id` (a project entry needs a note); with `ended_at` it is a manual entry,
 * without it a running timer (`source` timer, or widget). kind comes from the target (T2). The caps are checked in the INSERT itself, so two starts at once can't both pass.
 */
export async function createEntry(env: Env, body: Record<string, unknown>, source: 'timer' | 'widget' = 'timer'): Promise<Result> {
  const hasTask = body.task_id != null, hasProject = body.project_id != null;
  if (hasTask === hasProject) return bad('task_id or project_id, not both');
  if (hasTask ? !id40(body.task_id) : !id40(body.project_id)) return bad('a bad id');
  if (body.note != null && typeof body.note !== 'string') return bad('note must be text');
  const note = typeof body.note === 'string' ? body.note.trim() || null : null;
  if (note && note.length > MAX_NOTE) return bad(`note is at most ${MAX_NOTE} characters`);
  let kind: Kind | undefined;
  if (hasTask) {
    kind = (await env.DB.prepare(`SELECT kind FROM tasks WHERE id = ?1 AND deleted_at IS NULL AND status != 'done'`).bind(body.task_id).first<{ kind: Kind }>())?.kind;
  } else {
    if (!note) return bad('a project entry needs a note');
    kind = (await env.DB.prepare('SELECT kind FROM projects WHERE id = ?1 AND deleted_at IS NULL').bind(body.project_id).first<{ kind: Kind }>())?.kind;
  }
  if (!kind) return { status: 409, body: { error: 'time_target', message: 'That task or project can’t take time' } };
  const nowMs = Date.now(), t = new Date(nowMs).toISOString();
  if (body.started_at != null && typeof body.started_at !== 'string') return bad('started_at must be a timestamp');
  const started_at = typeof body.started_at === 'string' ? clampTs(body.started_at, nowMs) : t;
  let ended_at: string | null = null;
  if (body.ended_at != null) {
    // A manual entry is typed: an end in the future (past the clock slack) is a mistake, refused rather than shortened.
    const raw = typeof body.ended_at === 'string' ? Date.parse(body.ended_at) : NaN;
    if (Number.isNaN(raw) || raw > nowMs + FUTURE_SLACK_MS) return bad('ended_at must be a past timestamp');
    ended_at = clampTs(body.ended_at as string, nowMs);
    const ms = Date.parse(ended_at) - Date.parse(started_at);
    if (ms <= 0) return bad('ended_at must be after started_at');
    if (ms > MAX_MS) return bad('an entry is at most 24 hours');
  } else if (body.source != null && body.source !== 'timer' && body.source !== 'widget') return bad('source must be timer or widget');
  const row: TimeEntry = {
    id: crypto.randomUUID(), task_id: hasTask ? body.task_id as string : null, project_id: hasProject ? body.project_id as string : null, kind, started_at, ended_at, note,
    source: ended_at ? 'manual' : body.source === 'widget' ? 'widget' : source, auto_stopped: 0, enc_v: 0, created_at: t, updated_at: t, deleted_at: null,
  };
  const s = await seal(env, 'time_entries', { ...row }) as unknown as Record<string, unknown>;
  row.enc_v = s.enc_v as number;
  const values = COLS.map((k) => s[k] ?? null); // 13 binds
  if (ended_at) await env.DB.prepare(`INSERT INTO time_entries (${COLS.join(', ')}) VALUES (${COLS.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...values).run();
  else {
    // 15 binds: the 13 columns, the cap, the task id (null for a project entry, which matches nothing).
    const r = await env.DB.prepare(`INSERT INTO time_entries (${COLS.join(', ')}) SELECT ${COLS.map((_, i) => `?${i + 1}`).join(', ')}
      WHERE (SELECT COUNT(*) FROM time_entries WHERE ${RUNNING}) < ?14 AND NOT EXISTS (SELECT 1 FROM time_entries WHERE task_id = ?15 AND ${RUNNING})`).bind(...values, MAX_RUNNING, row.task_id).run();
    if (!r.meta.changes) {
      const onTask = row.task_id && await env.DB.prepare(`SELECT 1 AS x FROM time_entries WHERE task_id = ?1 AND ${RUNNING}`).bind(row.task_id).first();
      return onTask
        ? { status: 409, body: { error: 'timer_running', message: 'A timer is already running on that task' } }
        : { status: 409, body: { error: 'timer_limit', message: `${MAX_RUNNING} timers can run at once` } };
    }
  }
  await audit(env, 'you', 'time.create', row.id); // never the note
  return { status: 201, body: { entry: row } };
}

/** T4: stop a running entry at `ended_at` (clamped, never before the start, at most 24 h). Already stopped: 200 with the stored row. Exported for the widget route. */
export async function stopEntry(env: Env, id: string, endedAt: unknown): Promise<Result> {
  const stored = await env.DB.prepare('SELECT * FROM time_entries WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<TimeEntry>();
  if (!stored) return { status: 404, body: { error: 'Not found' } };
  if (stored.ended_at) return { status: 200, body: { entry: await open(env, 'time_entries', stored) } };
  const nowMs = Date.now(), start = Date.parse(stored.started_at);
  const end = Math.min(Math.max(Date.parse(clampTs(typeof endedAt === 'string' ? endedAt : '', nowMs)), start), start + MAX_MS);
  const ended_at = new Date(end).toISOString(), t = new Date(nowMs).toISOString();
  const r = await env.DB.prepare(`UPDATE time_entries SET ended_at = ?2, updated_at = ?3 WHERE id = ?1 AND ${RUNNING}`).bind(id, ended_at, t).run();
  if (!r.meta.changes) return stopEntry(env, id, endedAt); // stopped or trashed in between: answer with what is stored now
  await audit(env, 'you', 'time.stop', id);
  return { status: 200, body: { entry: await open(env, 'time_entries', { ...stored, ended_at, updated_at: t }) } };
}

// T6: with `since`, trashed rows come back too (deleted_at set) so the device drops them.
time.get('/', async (c) => {
  const since = c.req.query('since');
  const stmt = since
    ? c.env.DB.prepare('SELECT * FROM time_entries WHERE updated_at >= ?1 ORDER BY started_at').bind(since)
    : c.env.DB.prepare('SELECT * FROM time_entries WHERE deleted_at IS NULL ORDER BY started_at');
  const { results } = await stmt.all<TimeEntry>();
  return c.json({ entries: await openAll(c.env, 'time_entries', results) }, 200, { 'Cache-Control': 'private, no-store' });
});

time.post('/', async (c) => {
  const r = await createEntry(c.env, await readBody(c));
  return c.json(r.body, r.status);
});

time.post('/:id/stop', async (c) => {
  const r = await stopEntry(c.env, c.req.param('id'), (await readBody(c)).ended_at);
  return c.json(r.body, r.status);
});

time.patch('/:id', async (c) => {
  const stored = await c.env.DB.prepare('SELECT * FROM time_entries WHERE id = ?1 AND deleted_at IS NULL').bind(c.req.param('id')).first<TimeEntry>();
  if (!stored) return c.json({ error: 'Not found' }, 404);
  const body = await readBody(c), nowMs = Date.now();
  const next = await open(c.env, 'time_entries', { ...stored });
  if ('started_at' in body) {
    if (typeof body.started_at !== 'string') return c.json(bad('started_at must be a timestamp').body, 400);
    next.started_at = clampTs(body.started_at, nowMs);
  }
  if ('ended_at' in body) {
    if (typeof body.ended_at !== 'string') return c.json(bad('ended_at must be a timestamp (stop a timer to end it)').body, 400);
    next.ended_at = clampTs(body.ended_at, nowMs);
  }
  if ('note' in body) {
    if (body.note !== null && typeof body.note !== 'string') return c.json(bad('note must be text').body, 400);
    next.note = typeof body.note === 'string' ? body.note.trim() || null : null;
    if (next.note && next.note.length > MAX_NOTE) return c.json(bad(`note is at most ${MAX_NOTE} characters`).body, 400);
    if (next.project_id && !next.note) return c.json(bad('a project entry needs a note').body, 400);
  }
  if (next.ended_at) {
    const ms = Date.parse(next.ended_at) - Date.parse(next.started_at);
    if (ms <= 0) return c.json(bad('ended_at must be after started_at').body, 400);
    if (ms > MAX_MS) return c.json(bad('an entry is at most 24 hours').body, 400);
  }
  next.auto_stopped = 0;
  next.updated_at = new Date(nowMs).toISOString();
  // T2: sealed by the entry's own kind, never the task's current one.
  const s = await seal(c.env, 'time_entries', { ...next, enc_v: 0 });
  next.enc_v = s.enc_v;
  // 6 binds
  await c.env.DB.prepare('UPDATE time_entries SET started_at = ?2, ended_at = ?3, note = ?4, auto_stopped = 0, updated_at = ?5, enc_v = ?6 WHERE id = ?1 AND deleted_at IS NULL')
    .bind(stored.id, s.started_at, s.ended_at, s.note, s.updated_at, s.enc_v).run();
  await audit(c.env, 'you', 'time.edit', stored.id, Object.keys(body).filter((k) => ['started_at', 'ended_at', 'note'].includes(k)));
  return c.json({ entry: next });
});

time.delete('/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE time_entries SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'time.trash', c.req.param('id'));
  return c.json({ ok: true });
});

export default time;
