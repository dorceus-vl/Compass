import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { Task, Kind, Project, Milestone } from '../../shared/types.ts';
import { BUILTINS, parseBody, snapshotProject, snapshotTask, applyOffsets, isDate, MAX_TEMPLATE_MILESTONES, MAX_TEMPLATE_TASKS, MAX_TEMPLATE_BYTES, type TemplateScope } from '../../shared/templates.ts';
import { text } from '../lib/validate.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit } from '../lib/db.ts';
import { positionBetween } from '../../shared/position.ts';
import { loadTask, insertTaskStmt, eventStmt } from './tasks.ts';
import { projectKind, projectStmt, milestoneStmt } from './projects.ts';

const templates = new Hono<{ Bindings: Env; Variables: Variables }>();

type Row = { id: string; name: string; kind: Kind; scope: TemplateScope; body: string; builtin: number; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number };
const count = (scope: TemplateScope, body: string) => {
  const b = parseBody(scope, body);
  if (!b) return { tasks: 0, milestones: 0 };
  return 'project' in b ? { tasks: b.tasks.length, milestones: b.milestones.length } : { tasks: 1 + b.subtasks.length, milestones: 0 };
};
const summary = (r: Row) => ({ id: r.id, name: r.name, kind: r.kind, scope: r.scope, builtin: false, ...count(r.scope, r.body), created_at: r.created_at, updated_at: r.updated_at });
const loadRow = async (env: Env, id: string) => {
  const row = await env.DB.prepare('SELECT * FROM templates WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<Row>();
  return row ? open(env, 'templates', row) : null;
};

// Yours first (newest first), then the built-ins. A work template's name is opened for the session; the body is not sent (apply reads it on the server).
templates.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM templates WHERE deleted_at IS NULL ORDER BY created_at DESC').all<Row>();
  const mine = (await openAll(c.env, 'templates', results)).map(summary);
  const built = BUILTINS.map((b) => ({ id: b.id, name: b.name, description: b.description, kind: null, scope: b.scope, builtin: true, tasks: b.body.tasks.length, milestones: b.body.milestones.length }));
  return c.json({ templates: [...mine, ...built] });
});

// Save as template: a snapshot of a task (with its subtasks) or of a project (milestones and tasks), as offsets from the earliest date.
templates.post('/', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const nm = text(200)(b.name, 'name');
  if ('error' in nm) return c.json({ error: nm.error }, 400);
  if (!nm.value) return c.json({ error: 'name is required' }, 400);
  const fromTask = typeof b.from_task_id === 'string' && b.from_task_id, fromProject = typeof b.from_project_id === 'string' && b.from_project_id;
  if (!fromTask === !fromProject) return c.json({ error: 'Name either from_task_id or from_project_id' }, 400);
  let scope: TemplateScope, kind: Kind, body: unknown;
  if (fromTask) {
    const task = await loadTask(c.env, fromTask);
    if (!task) return c.json({ error: 'Not found' }, 404);
    const { results } = await c.env.DB.prepare('SELECT * FROM tasks WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY sort_in_column, created_at').bind(task.id).all<Task>();
    const subs = await openAll(c.env, 'tasks', results);
    if (subs.length > MAX_TEMPLATE_TASKS - 1) return c.json({ error: 'template_too_big' }, 400);
    if (subs.some((s) => s.kind !== task.kind)) return c.json({ error: 'template_invalid' }, 400); // never put work text in a personal template
    scope = 'task'; kind = task.kind; body = snapshotTask(task, subs);
  } else {
    const prow = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?1 AND deleted_at IS NULL').bind(fromProject).first<Project>();
    if (!prow) return c.json({ error: 'Not found' }, 404);
    const p = await open(c.env, 'projects', prow);
    const ms = await openAll(c.env, 'milestones', (await c.env.DB.prepare('SELECT * FROM milestones WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY due_at, sort').bind(p.id).all<Milestone>()).results);
    const ts = await openAll(c.env, 'tasks', (await c.env.DB.prepare('SELECT * FROM tasks WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY created_at, sort_in_column').bind(p.id).all<Task>()).results);
    if (ts.some((x) => x.kind !== p.kind)) return c.json({ error: 'template_invalid' }, 400); // never put work text in a personal template
    if (ts.length > MAX_TEMPLATE_TASKS || ms.length > MAX_TEMPLATE_MILESTONES) return c.json({ error: 'template_too_big' }, 400);
    scope = 'project'; kind = p.kind; body = snapshotProject(p, ms, ts);
  }
  const clean = parseBody(scope, body); // the same check a stored body gets on apply
  if (!clean) return c.json({ error: 'template_invalid' }, 400);
  if (JSON.stringify(clean).length > MAX_TEMPLATE_BYTES) return c.json({ error: 'template_too_big' }, 400);
  const t = now();
  const row: Row = { id: crypto.randomUUID(), name: nm.value as string, kind, scope, body: JSON.stringify(clean), builtin: 0, created_at: t, updated_at: t, deleted_at: null, enc_v: 0 };
  const plain = { ...row };
  const s = await seal(c.env, 'templates', { ...row });
  await c.env.DB.prepare('INSERT INTO templates (id, name, kind, scope, body, builtin, created_at, updated_at, enc_v) VALUES (?1,?2,?3,?4,?5,0,?6,?7,?8)')
    .bind(s.id, s.name, s.kind, s.scope, s.body, s.created_at, s.updated_at, s.enc_v).run();
  await audit(c.env, 'you', 'template.create', row.id);
  return c.json({ template: summary(plain) }, 201);
});

// Apply: ONE batch makes the project, its milestones, the tasks (with parent links) and their 'created' events, so a failure leaves nothing half made.
// A project template makes a new project; a task template makes a task (and subtasks), in a project of its own kind or standalone. Same-kind rule: 400 template_kind.
templates.post('/apply', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  if (!isDate(b.start_date)) return c.json({ error: 'start_date must be a date (YYYY-MM-DD)' }, 400);
  let scope: TemplateScope, kind: Kind, body, source: string;
  if (typeof b.builtin === 'string') {
    const bi = BUILTINS.find((x) => x.id === b.builtin);
    if (!bi) return c.json({ error: 'Not found' }, 404);
    if (b.kind !== undefined && b.kind !== 'personal' && b.kind !== 'work') return c.json({ error: 'kind must be one of: personal, work' }, 400);
    scope = bi.scope; kind = b.kind === 'work' ? 'work' : 'personal'; body = parseBody(scope, bi.body); source = bi.id;
  } else if (typeof b.template_id === 'string') {
    const row = await loadRow(c.env, b.template_id);
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (b.kind !== undefined && b.kind !== row.kind) return c.json({ error: 'template_kind' }, 400);
    scope = row.scope; kind = row.kind; body = parseBody(scope, row.body); source = row.id;
  } else return c.json({ error: 'Name either template_id or builtin' }, 400);
  if (!body) return c.json({ error: 'template_invalid' }, 400);
  const dated = applyOffsets(body, b.start_date);

  const stmts: D1PreparedStatement[] = [];
  let project: Project | null = null;
  const milestones: Milestone[] = [];
  let projectId = typeof b.project_id === 'string' && b.project_id ? b.project_id : null;
  if (scope === 'project') {
    if (projectId) return c.json({ error: 'template_scope' }, 400); // a project template always makes a new project
    const nm = text(200)(b.name ?? dated.project?.name, 'name');
    if ('error' in nm) return c.json({ error: nm.error }, 400);
    if (!nm.value) return c.json({ error: 'name is required' }, 400);
    const p = dated.project!;
    const made = await projectStmt(c.env, kind, { name: nm.value, start_at: b.start_date, sponsor: p.sponsor, phase: p.phase, objectives: p.objectives, scope_in: p.scope_in, scope_out: p.scope_out, success_criteria: p.success_criteria });
    project = made.row; projectId = project.id; stmts.push(made.stmt);
    for (const [i, m] of dated.milestones.entries()) {
      const ms = await milestoneStmt(c.env, projectId, kind, { name: m.name, due_at: m.due_at, gate: m.gate, sort: i });
      milestones.push(ms.row); stmts.push(ms.stmt);
    }
  } else if (projectId) {
    const pk = await projectKind(c.env, projectId);
    if (!pk) return c.json({ error: 'project not found' }, 404);
    if (pk !== kind) return c.json({ error: 'template_kind' }, 400);
  }
  const last = await c.env.DB.prepare(`SELECT MAX(sort_in_column) AS m FROM tasks WHERE status = 'new' AND deleted_at IS NULL`).first<{ m: number | null }>();
  let pos = last?.m ?? null;
  const t = now();
  const made: Task[] = dated.tasks.map((x) => {
    pos = positionBetween(pos, null);
    return { id: crypto.randomUUID(), project_id: projectId, parent_id: null, title: x.title, notes: x.notes, kind, horizon: x.horizon, status: 'new', priority: x.priority,
      start_at: x.start_at, due_at: x.due_at, done_at: null, estimate_minutes: x.estimate_minutes, waiting_on: null, waiting_since: null, nudge_every_days: null, recur: null,
      source_app: 'manual', source_kind: null, source_ref: null, source_url: null, blocked_by: null, checklist: x.checklist.length ? JSON.stringify(x.checklist) : null,
      sort_in_column: pos, tags: '[]', enc_v: 0, created_at: t, updated_at: t, deleted_at: null };
  });
  dated.tasks.forEach((x, i) => { if (x.parent_index !== null) made[i].parent_id = made[x.parent_index].id; });
  // Parents first: tasks.parent_id is a foreign key checked as each row goes in, whatever order the template was saved in.
  for (const task of [...made.filter((x) => !x.parent_id), ...made.filter((x) => x.parent_id)]) {
    stmts.push(await insertTaskStmt(c.env, task));
    stmts.push((await eventStmt(c.env, task, 'you', 'created', { from: 'template' })).stmt);
  }
  await c.env.DB.batch(stmts);
  await audit(c.env, 'you', 'template.apply', source, { tasks: made.length, milestones: milestones.length });
  return c.json({ project, milestones, tasks: made }, 201);
});

templates.patch('/:id', async (c) => {
  const row = await loadRow(c.env, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found' }, 404);
  const b = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const nm = text(200)(b.name, 'name');
  if ('error' in nm) return c.json({ error: nm.error }, 400);
  if (!nm.value) return c.json({ error: 'name is required' }, 400);
  const next: Row = { ...row, name: nm.value as string, updated_at: now() };
  const s = await seal(c.env, 'templates', { ...next });
  await c.env.DB.prepare('UPDATE templates SET name = ?2, body = ?3, enc_v = ?4, updated_at = ?5 WHERE id = ?1').bind(row.id, s.name, s.body, s.enc_v, s.updated_at).run();
  return c.json({ template: summary(next) });
});

templates.delete('/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE templates SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'template.trash', c.req.param('id'));
  return c.json({ ok: true });
});

export default templates;
