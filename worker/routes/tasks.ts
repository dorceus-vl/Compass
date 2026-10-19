import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { Task, TaskEvent, Status } from '../../shared/types.ts';
import { checkAll, text, httpsUrl, oneOf, date, num, type Check } from '../lib/validate.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit, getSettings } from '../lib/db.ts';
import { localDate } from '../lib/dates.ts';
import { projectKind } from './projects.ts';
import { parseRecur, nextOccurrence } from '../lib/recur.ts';
import { positionBetween } from '../../shared/position.ts';

const tasks = new Hono<{ Bindings: Env; Variables: Variables }>();

const CHECKS: Record<string, Check> = {
  title: text(300), notes: text(20000), project_id: text(40), parent_id: text(40), kind: oneOf('personal', 'work'),
  horizon: oneOf('short', 'medium', 'long'), status: oneOf('new', 'progress', 'hold', 'waiting', 'done'), priority: num(0, 3, { integer: true, nullable: false }),
  start_at: date(), due_at: date(), estimate_minutes: num(0, 100000, { integer: true }), waiting_on: text(200), nudge_every_days: num(1, 365, { integer: true }),
  recur: text(300), source_url: httpsUrl(2048), tags: text(1000),
};
const COLS = ['id','project_id','parent_id','title','notes','kind','horizon','status','priority','start_at','due_at','done_at','estimate_minutes','waiting_on','waiting_since',
  'nudge_every_days','recur','source_app','source_kind','source_ref','source_url','sort_in_column','tags','enc_v','created_at','updated_at','deleted_at'] as const;
// Text columns that are ciphertext on a work row. Every update rewrites them, so a task that changes kind
// (via its project) is never left half-encrypted.
const TEXT_COLS = ['title', 'notes', 'waiting_on'];

// Both helpers seal a copy (never the caller's task) and set task.enc_v to what is stored, so responses say how the row is held.
export async function insertTaskStmt(env: Env, task: Task): Promise<D1PreparedStatement> {
  const s = await seal(env, 'tasks', { ...task, enc_v: 0 });
  task.enc_v = s.enc_v;
  return env.DB.prepare(`INSERT INTO tasks (${COLS.join(',')}) VALUES (${COLS.map((_, i) => `?${i + 1}`).join(',')})`)
    .bind(...COLS.map((k) => (s as Record<string, unknown>)[k] ?? null));
}
export async function insertTask(env: Env, task: Task): Promise<void> { await (await insertTaskStmt(env, task)).run(); }
export async function loadTask(env: Env, id: string): Promise<Task | null> {
  const row = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<Task>();
  return row ? open(env, 'tasks', row) : null;
}
export async function updateTask(env: Env, task: Task, fields: string[]): Promise<void> {
  const s = await seal(env, 'tasks', { ...task, enc_v: 0 });
  task.enc_v = s.enc_v;
  const cols = [...new Set(fields.concat(TEXT_COLS, 'updated_at', 'enc_v'))];
  await env.DB.prepare(`UPDATE tasks SET ${cols.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
    .bind(task.id, ...cols.map((k) => (s as Record<string, unknown>)[k] ?? null)).run();
}
export async function addEvent(env: Env, task: Task, actor: TaskEvent['actor'], type: TaskEvent['type'], data?: unknown): Promise<TaskEvent> {
  const ev: TaskEvent = { id: crypto.randomUUID(), task_id: task.id, at: now(), actor, type, data: data === undefined ? null : JSON.stringify(data), enc_v: 0 };
  const s = await seal(env, 'task_events', { ...ev }, task.kind);
  ev.enc_v = s.enc_v;
  await env.DB.prepare('INSERT INTO task_events (id, task_id, at, actor, type, data, enc_v) VALUES (?1,?2,?3,?4,?5,?6,?7)').bind(s.id, s.task_id, s.at, s.actor, s.type, s.data, s.enc_v).run();
  return ev;
}
/**
 * A task made by a rule or from an inbox item (not typed by the user). Fills the defaults, follows the project's kind
 * (a project that is gone is dropped) and puts it last in its column. build... returns it unsaved (to batch with other writes);
 * create... also inserts it. The caller writes the 'created' event.
 */
export async function buildTaskFromSource(env: Env, f: Partial<Task> & { title: string }): Promise<Task> {
  const t = now();
  const status = f.status ?? 'new';
  let project_id = f.project_id ?? null;
  let kind: Task['kind'] = f.kind ?? 'personal';
  if (project_id) { const k = await projectKind(env, project_id); if (k) kind = k; else project_id = null; }
  const last = await env.DB.prepare('SELECT MAX(sort_in_column) AS m FROM tasks WHERE status = ?1 AND deleted_at IS NULL').bind(status).first<{ m: number | null }>();
  const task: Task = {
    parent_id: null, notes: null, horizon: 'short', priority: 0, start_at: null, due_at: null, done_at: null, estimate_minutes: null, waiting_on: null,
    waiting_since: status === 'waiting' ? t : null, nudge_every_days: null, recur: null, source_app: 'manual', source_kind: null, source_ref: null, source_url: null,
    tags: '[]', enc_v: 0, ...f, id: crypto.randomUUID(), project_id, kind, status, sort_in_column: positionBetween(last?.m ?? null, null),
    created_at: t, updated_at: t, deleted_at: null,
  };
  return task;
}
export async function createTaskFromSource(env: Env, f: Partial<Task> & { title: string }): Promise<Task> {
  const task = await buildTaskFromSource(env, f);
  await insertTask(env, task);
  return task;
}
function bad(r: ReturnType<typeof checkAll>): r is { error: string } { return 'error' in r; }
const badRecur = (v: unknown) => typeof v === 'string' && v !== '' && !parseRecur(v);
const badTags = (v: unknown) => { if (v === null || v === undefined) return false; try { const a = JSON.parse(String(v)); return !Array.isArray(a) || !a.every((t) => typeof t === 'string'); } catch { return true; } };

/** The task's kind follows its project; a task without a project keeps the kind it was given. */
async function resolveKind(env: Env, projectId: string | null, given: unknown): Promise<'personal' | 'work' | null> {
  if (projectId) return projectKind(env, projectId);
  return given === 'work' ? 'work' : 'personal';
}

/**
 * The one way a task becomes done: marks it done, writes the 'done' event and, for a recurring task, creates
 * the next occurrence (counted from the user's local date). `task` is the already-edited task; `fields` are its extra changed columns.
 */
async function completeTask(env: Env, task: Task, fields: string[] = []): Promise<{ task: Task; next?: Task }> {
  const t = now();
  const done: Task = { ...task, status: 'done', done_at: t, updated_at: t };
  await updateTask(env, done, ['status', 'done_at', ...fields]);
  await addEvent(env, done, 'you', 'done');
  const rule = parseRecur(done.recur);
  if (!rule) return { task: done };
  const today = localDate((await getSettings(env)).tz);
  const due = nextOccurrence(done.due_at ?? today, rule, today);
  if (!due) return { task: done };
  const next: Task = { ...done, id: crypto.randomUUID(), status: 'new', due_at: due, done_at: null, created_at: t, updated_at: t, sort_in_column: 0, source_ref: null };
  await insertTask(env, next);
  await addEvent(env, next, 'you', 'created', { recurred_from: done.id });
  return { task: done, next };
}

tasks.get('/', async (c) => {
  const q = c.req.query();
  // With `since`, trashed rows come back too (deleted_at set) so other devices learn about trashes.
  const where: string[] = q.since ? [] : ['deleted_at IS NULL'];
  const args: unknown[] = [];
  if (q.status === 'all') { /* everything */ } else if (q.status) { where.push(`status = ?${args.push(q.status)}`); } else where.push(`status != 'done'`);
  if (q.project) where.push(`project_id = ?${args.push(q.project)}`);
  if (q.kind) where.push(`kind = ?${args.push(q.kind)}`);
  if (q.since) where.push(`updated_at >= ?${args.push(q.since)}`);
  const { results } = await c.env.DB.prepare(`SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY sort_in_column, created_at`).bind(...args).all<Task>();
  return c.json({ tasks: await openAll(c.env, 'tasks', results) });
});

tasks.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const r = checkAll(body, CHECKS);
  if (bad(r)) return c.json({ error: r.error }, 400);
  if (!r.values.title) return c.json({ error: 'title is required' }, 400);
  if (badRecur(r.values.recur)) return c.json({ error: 'recur is not a valid rule' }, 400);
  if (badTags(r.values.tags)) return c.json({ error: 'tags must be a JSON array of strings' }, 400);
  const kind = await resolveKind(c.env, (r.values.project_id as string) ?? null, r.values.kind);
  if (!kind) return c.json({ error: 'project not found' }, 404);
  const status = (r.values.status as Status) ?? 'new';
  const last = await c.env.DB.prepare('SELECT MAX(sort_in_column) AS m FROM tasks WHERE status = ?1 AND deleted_at IS NULL').bind(status).first<{ m: number | null }>();
  const t = now();
  const task: Task = {
    id: crypto.randomUUID(), project_id: null, parent_id: null, notes: null, horizon: 'short', priority: 0, start_at: null, due_at: null, done_at: null,
    estimate_minutes: null, waiting_on: null, waiting_since: null, nudge_every_days: null, recur: null, source_app: 'manual', source_kind: null,
    source_ref: null, source_url: null, tags: '[]', enc_v: 0, ...(r.values as Partial<Task>), title: String(r.values.title), kind, status,
    sort_in_column: positionBetween(last?.m ?? null, null), created_at: t, updated_at: t, deleted_at: null,
  };
  if (task.tags === null) task.tags = '[]';
  if (task.status === 'waiting' && !task.waiting_since) task.waiting_since = t;
  if (task.status === 'done') task.done_at = t;
  await insertTask(c.env, task);
  await addEvent(c.env, task, 'you', 'created');
  await audit(c.env, 'you', 'task.create', task.id);
  return c.json({ task }, 201);
});

tasks.get('/:id', async (c) => {
  const task = await loadTask(c.env, c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  const ev = await c.env.DB.prepare('SELECT * FROM task_events WHERE task_id = ?1 ORDER BY at').bind(task.id).all<TaskEvent>();
  const sub = await c.env.DB.prepare('SELECT * FROM tasks WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY sort_in_column, created_at').bind(task.id).all<Task>();
  return c.json({ task, events: await openAll(c.env, 'task_events', ev.results), subtasks: await openAll(c.env, 'tasks', sub.results) });
});

// The raw forwarded email, kept in R2 by the email handler. Only for a task that exists and isn't trashed.
tasks.get('/:id/email', async (c) => {
  const id = c.req.param('id');
  const live = await c.env.DB.prepare('SELECT 1 AS x FROM tasks WHERE id = ?1 AND deleted_at IS NULL').bind(id).first();
  const obj = live ? await c.env.FILES.get(`email/${id}.eml`) : null;
  if (!obj) return c.json({ error: 'Not found' }, 404);
  return new Response(obj.body, { headers: { 'Content-Type': 'message/rfc822', 'Content-Disposition': 'attachment; filename="email.eml"', 'Cache-Control': 'private, no-store' } });
});

tasks.patch('/:id', async (c) => {
  const task = await loadTask(c.env, c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const r = checkAll(body, CHECKS);
  if (bad(r)) return c.json({ error: r.error }, 400);
  if (badRecur(r.values.recur)) return c.json({ error: 'recur is not a valid rule' }, 400);
  if (badTags(r.values.tags)) return c.json({ error: 'tags must be a JSON array of strings' }, 400);
  if (r.values.title === null) return c.json({ error: 'title is required' }, 400);
  if (r.values.tags === null) r.values.tags = '[]';
  const fields = Object.keys(r.values);
  const next: Task = { ...task, ...(r.values as Partial<Task>), updated_at: now() };
  // Kind follows the project; a body `kind` only counts for a task that ends up with no project.
  // Only re-resolve when the project changes: a task whose project is in the trash must stay editable.
  if (next.project_id) {
    if ('project_id' in r.values) {
      const kind = await projectKind(c.env, next.project_id);
      if (!kind) return c.json({ error: 'project not found' }, 404);
      next.kind = kind;
    } else next.kind = task.kind;
  }
  fields.push('kind');
  if (next.status === 'waiting' && task.status !== 'waiting') { next.waiting_since = next.updated_at; fields.push('waiting_since'); }
  if (next.status !== 'done' && task.status === 'done') { next.done_at = null; fields.push('done_at'); }
  if (next.status === 'done' && task.status !== 'done') {
    const res = await completeTask(c.env, next, fields);
    await addEvent(c.env, res.task, 'you', 'edited', fields);
    return c.json(res);
  }
  await updateTask(c.env, next, fields);
  await addEvent(c.env, next, 'you', 'edited', fields);
  return c.json({ task: next });
});

tasks.delete('/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE tasks SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'task.trash', c.req.param('id'));
  return c.json({ ok: true });
});

// Drag on the board: new status and the card it lands before (null = end of the column).
tasks.post('/:id/move', async (c) => {
  const task = await loadTask(c.env, c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<{ status?: Status; before?: string | null }>().catch((): { status?: Status; before?: string | null } => ({}));
  const status = body.status ?? task.status;
  if (!['new', 'progress', 'hold', 'waiting', 'done'].includes(status)) return c.json({ error: 'bad status' }, 400);
  let prev: number | null = null, nextPos: number | null = null;
  if (body.before) {
    const b = await c.env.DB.prepare('SELECT sort_in_column FROM tasks WHERE id = ?1 AND status = ?2 AND deleted_at IS NULL').bind(body.before, status).first<{ sort_in_column: number }>();
    if (!b) return c.json({ error: 'before is not in that column' }, 400);
    nextPos = b.sort_in_column;
    const p = await c.env.DB.prepare('SELECT MAX(sort_in_column) AS m FROM tasks WHERE status = ?1 AND sort_in_column < ?2 AND id != ?3 AND deleted_at IS NULL').bind(status, nextPos, task.id).first<{ m: number | null }>();
    prev = p?.m ?? null;
  } else {
    const p = await c.env.DB.prepare('SELECT MAX(sort_in_column) AS m FROM tasks WHERE status = ?1 AND id != ?2 AND deleted_at IS NULL').bind(status, task.id).first<{ m: number | null }>();
    prev = p?.m ?? null;
  }
  const t = now();
  const sort_in_column = positionBetween(prev, nextPos);
  if (status === 'done' && task.status !== 'done') return c.json(await completeTask(c.env, { ...task, sort_in_column }, ['sort_in_column']));
  const next: Task = { ...task, status, sort_in_column, updated_at: t,
    done_at: status === 'done' ? (task.done_at ?? t) : null, waiting_since: status === 'waiting' ? (task.waiting_since ?? t) : task.waiting_since };
  await updateTask(c.env, next, ['status', 'sort_in_column', 'done_at', 'waiting_since']);
  if (status !== task.status) await addEvent(c.env, next, 'you', 'moved', { from: task.status, to: status });
  return c.json({ task: next });
});

// Done handles recurrence: the finished task stays done; a recurring one gets its next occurrence as a new task.
tasks.post('/:id/done', async (c) => {
  const task = await loadTask(c.env, c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  if (task.status === 'done') return c.json({ task }); // already done: no second recurrence
  return c.json(await completeTask(c.env, task));
});

tasks.post('/:id/comment', async (c) => {
  const task = await loadTask(c.env, c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<{ text?: unknown }>().catch((): { text?: unknown } => ({}));
  const r = text(5000)(body.text, 'text');
  if ('error' in r || !r.value) return c.json({ error: 'text is required' }, 400);
  const event = await addEvent(c.env, task, 'you', 'comment', { text: r.value });
  return c.json({ event }, 201);
});

export default tasks;
