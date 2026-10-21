import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import { text } from '../lib/validate.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit } from '../lib/db.ts';
import { buildSnapshot, parseSnapshot, MAX_BASELINE_TASKS, MAX_BASELINE_MILESTONES, MAX_BASELINES } from '../../shared/baseline.ts';
import { projectKind } from './projects.ts';

type App = Hono<{ Bindings: Env; Variables: Variables }>;
type Row = { id: string; project_id: string; name: string; snapshot: string; task_count: number; milestone_count: number; taken_at: string; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number };
const summary = (r: Pick<Row, 'id' | 'project_id' | 'name' | 'task_count' | 'milestone_count' | 'taken_at'>) =>
  ({ id: r.id, project_id: r.project_id, name: r.name, taken_at: r.taken_at, task_count: r.task_count, milestone_count: r.milestone_count });
const readBody = (c: { req: { json: <T>() => Promise<T> } }) => c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
const nameOf = (b: Record<string, unknown>) => {
  const nm = text(200)(b.name, 'name');
  if ('error' in nm) return { error: nm.error };
  return nm.value ? { value: nm.value as string } : { error: 'name is required' };
};

/** Baselines (v2.2, C1): list and save under a project, read, rename and trash by id. Work baselines are sealed like every work row. Kelly has no route here. */
export const byProject: App = new Hono(), byId: App = new Hono();

byProject.get('/:id/baselines', async (c) => {
  if (!(await projectKind(c.env, c.req.param('id')))) return c.json({ error: 'Not found' }, 404);
  // The list never reads the snapshot (it can be large and is sealed); the counts are plain columns.
  const { results } = await c.env.DB.prepare('SELECT id, project_id, name, task_count, milestone_count, taken_at, enc_v FROM baselines WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY taken_at DESC LIMIT ?2')
    .bind(c.req.param('id'), MAX_BASELINES).all<Row>();
  return c.json({ baselines: (await openAll(c.env, 'baselines', results)).map(summary) });
});

// Save: the snapshot is built here from D1, so it is complete even when the device is behind. The reads are `WHERE project_id = ?` with a fixed LIMIT (rule 9).
byProject.post('/:id/baselines', async (c) => {
  const project_id = c.req.param('id');
  const kind = await projectKind(c.env, project_id);
  if (!kind) return c.json({ error: 'Not found' }, 404);
  const nm = nameOf(await readBody(c));
  if ('error' in nm) return c.json({ error: nm.error }, 400);
  // One batch, so the count, the project, the tasks and the milestones are read at the same moment.
  const [liveR, pR, ts, ms] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM baselines WHERE project_id = ?1 AND deleted_at IS NULL').bind(project_id),
    c.env.DB.prepare('SELECT start_at, end_at FROM projects WHERE id = ?1').bind(project_id),
    c.env.DB.prepare('SELECT id, start_at, due_at FROM tasks WHERE project_id = ?1 AND deleted_at IS NULL LIMIT ?2').bind(project_id, MAX_BASELINE_TASKS + 1),
    c.env.DB.prepare('SELECT id, due_at FROM milestones WHERE project_id = ?1 AND deleted_at IS NULL LIMIT ?2').bind(project_id, MAX_BASELINE_MILESTONES + 1),
  ]) as [D1Result<{ n: number }>, D1Result<{ start_at: string | null; end_at: string | null }>, D1Result<{ id: string; start_at: string | null; due_at: string | null }>, D1Result<{ id: string; due_at: string | null }>];
  if ((liveR.results[0]?.n ?? 0) >= MAX_BASELINES) return c.json({ error: 'baseline_limit', message: `A project keeps ${MAX_BASELINES} baselines at most; delete one first` }, 409);
  if (ts.results.length > MAX_BASELINE_TASKS || ms.results.length > MAX_BASELINE_MILESTONES) return c.json({ error: 'baseline_too_big', message: `A baseline holds ${MAX_BASELINE_TASKS} tasks and ${MAX_BASELINE_MILESTONES} milestones at most` }, 409);
  const snapshot = buildSnapshot(pR.results[0] ?? { start_at: null, end_at: null }, ts.results, ms.results);
  const t = now();
  const row: Row = { id: crypto.randomUUID(), project_id, name: nm.value, snapshot: JSON.stringify(snapshot), task_count: snapshot.tasks.length, milestone_count: snapshot.milestones.length, taken_at: t, created_at: t, updated_at: t, deleted_at: null, enc_v: 0 };
  const s = await seal(c.env, 'baselines', { ...row }, kind);
  await c.env.DB.prepare('INSERT INTO baselines (id, project_id, name, snapshot, task_count, milestone_count, taken_at, created_at, updated_at, enc_v) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)')
    .bind(s.id, s.project_id, s.name, s.snapshot, s.task_count, s.milestone_count, s.taken_at, s.created_at, s.updated_at, s.enc_v).run();
  await audit(c.env, 'you', 'baseline.create', row.id, { tasks: row.task_count, milestones: row.milestone_count });
  return c.json({ baseline: summary(row) }, 201);
});

const load = (env: Env, id: string) => env.DB.prepare('SELECT * FROM baselines WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<Row>();

byId.get('/:id', async (c) => {
  const stored = await load(c.env, c.req.param('id'));
  if (!stored) return c.json({ error: 'Not found' }, 404);
  const row = await open(c.env, 'baselines', { ...stored });
  const snapshot = parseSnapshot(row.snapshot);
  if (!snapshot) return c.json({ error: 'baseline_unreadable' }, 500);
  return c.json({ baseline: { ...summary(row), snapshot } }, 200, { 'Cache-Control': 'private, no-store' });
});

byId.patch('/:id', async (c) => {
  const stored = await load(c.env, c.req.param('id'));
  if (!stored) return c.json({ error: 'Not found' }, 404);
  const nm = nameOf(await readBody(c));
  if ('error' in nm) return c.json({ error: nm.error }, 400);
  const next = await open(c.env, 'baselines', { ...stored });
  next.name = nm.value; next.updated_at = now();
  // Seal the way the row is already held, so a rename never mixes ciphertext and plain text in one row.
  const s = await seal(c.env, 'baselines', { ...next }, stored.enc_v === 2 ? 'work' : 'personal');
  await c.env.DB.prepare('UPDATE baselines SET name = ?2, snapshot = ?3, enc_v = ?4, updated_at = ?5 WHERE id = ?1').bind(stored.id, s.name, s.snapshot, s.enc_v, s.updated_at).run();
  await audit(c.env, 'you', 'baseline.rename', stored.id);
  return c.json({ baseline: summary(next) });
});

byId.delete('/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE baselines SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'baseline.trash', c.req.param('id'));
  return c.json({ ok: true });
});
