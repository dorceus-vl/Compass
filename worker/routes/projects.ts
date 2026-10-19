import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { Project, Milestone } from '../../shared/types.ts';
import { checkAll, text, oneOf, date, num, type Check } from '../lib/validate.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit } from '../lib/db.ts';

const projects = new Hono<{ Bindings: Env; Variables: Variables }>();

const PROJECT_CHECKS: Record<string, Check> = {
  name: text(200), status: oneOf('active', 'on_hold', 'closed'), rag: oneOf('green', 'amber', 'red', 'none'), rag_reason: text(2000),
  sponsor: text(200), objectives: text(20000), scope_in: text(20000), scope_out: text(20000), success_criteria: text(20000), phase: text(100),
  start_at: date(), end_at: date(), budget_planned: num(0), budget_spent: num(0), data_boundary: oneOf('cloud', 'offline'),
  colour: text(20), sort: num(),
};
const MILESTONE_CHECKS: Record<string, Check> = { name: text(200), due_at: date(), done_at: date(), gate: num(0, 1, { integer: true }), sort: num() };

export async function projectKind(env: Env, projectId: string | null): Promise<'personal' | 'work' | null> {
  if (!projectId) return null;
  const r = await env.DB.prepare('SELECT kind FROM projects WHERE id = ?1 AND deleted_at IS NULL').bind(projectId).first<{ kind: 'personal' | 'work' }>();
  return r?.kind ?? null;
}

async function loadProject(env: Env, id: string): Promise<Project | null> {
  const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<Project>();
  return row ? open(env, 'projects', row) : null;
}

projects.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.deleted_at IS NULL) AS open_tasks,
            (SELECT MIN(due_at) FROM milestones m WHERE m.project_id = p.id AND m.done_at IS NULL AND m.deleted_at IS NULL) AS next_milestone
     FROM projects p WHERE p.deleted_at IS NULL ORDER BY p.sort, p.created_at`,
  ).all<Project & { open_tasks: number; next_milestone: string | null }>();
  return c.json({ projects: await openAll(c.env, 'projects', results) });
});

projects.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  if (body.kind !== undefined && body.kind !== 'personal' && body.kind !== 'work') return c.json({ error: 'kind must be one of: personal, work' }, 400);
  const kind = body.kind === 'work' ? 'work' : 'personal';
  delete body.data_boundary; // only PATCH may change it (step-up)
  const r = checkAll(body, PROJECT_CHECKS);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if (!r.values.name) return c.json({ error: 'name is required' }, 400);
  const t = now();
  const row = {
    id: crypto.randomUUID(), kind, status: 'active', rag: 'none', data_boundary: kind === 'work' ? 'offline' : 'cloud', sort: 0, enc_v: 0,
    rag_reason: null, sponsor: null, objectives: null, scope_in: null, scope_out: null, success_criteria: null, phase: null,
    start_at: null, end_at: null, budget_planned: null, budget_spent: null, colour: null,
    ...r.values, created_at: t, updated_at: t, deleted_at: null,
  } as unknown as Project;
  const s = await seal(c.env, 'projects', { ...row });
  row.enc_v = s.enc_v; // the response is plaintext, but says how the stored row is held
  await c.env.DB.prepare(
    `INSERT INTO projects (id, name, kind, status, rag, rag_reason, sponsor, objectives, scope_in, scope_out, success_criteria, phase, start_at, end_at,
       budget_planned, budget_spent, data_boundary, colour, sort, enc_v, created_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)`,
  ).bind(s.id, s.name, s.kind, s.status, s.rag, s.rag_reason ?? null, s.sponsor ?? null, s.objectives ?? null, s.scope_in ?? null, s.scope_out ?? null,
    s.success_criteria ?? null, s.phase ?? null, s.start_at ?? null, s.end_at ?? null, s.budget_planned ?? null, s.budget_spent ?? null,
    s.data_boundary, s.colour ?? null, s.sort, s.enc_v, s.created_at, s.updated_at).run();
  await audit(c.env, 'you', 'project.create', row.id);
  return c.json({ project: row }, 201);
});

projects.get('/:id', async (c) => {
  const project = await loadProject(c.env, c.req.param('id'));
  if (!project) return c.json({ error: 'Not found' }, 404);
  const { results } = await c.env.DB.prepare('SELECT * FROM milestones WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY due_at, sort').bind(project.id).all<Milestone>();
  return c.json({ project, milestones: await openAll(c.env, 'milestones', results) });
});

projects.patch('/:id', async (c) => {
  const project = await loadProject(c.env, c.req.param('id'));
  if (!project) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const r = checkAll(body, PROJECT_CHECKS);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if ('name' in r.values && !r.values.name) return c.json({ error: 'name is required' }, 400);
  if (r.values.data_boundary !== undefined && r.values.data_boundary !== project.data_boundary) return c.json({ error: 'Changing the data boundary arrives in Phase 3.' }, 403);
  const next = { ...project, ...r.values, updated_at: now() } as Project;
  const s = await seal(c.env, 'projects', { ...next });
  const cols = Object.keys(r.values).concat('updated_at', 'enc_v');
  await c.env.DB.prepare(`UPDATE projects SET ${cols.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
    .bind(project.id, ...cols.map((k) => (s as Record<string, unknown>)[k] ?? null)).run();
  await audit(c.env, 'you', 'project.edit', project.id, Object.keys(r.values));
  return c.json({ project: next });
});

projects.delete('/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE projects SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'project.trash', c.req.param('id'));
  return c.json({ ok: true });
});

projects.post('/:id/milestones', async (c) => {
  const kind = await projectKind(c.env, c.req.param('id'));
  if (!kind) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const r = checkAll(body, MILESTONE_CHECKS);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if (!r.values.name) return c.json({ error: 'name is required' }, 400);
  const t = now();
  const row = { id: crypto.randomUUID(), project_id: c.req.param('id'), gate: 0, sort: 0, due_at: null, done_at: null, enc_v: 0, ...r.values, created_at: t, updated_at: t, deleted_at: null } as unknown as Milestone;
  const s = await seal(c.env, 'milestones', { ...row }, kind);
  row.enc_v = s.enc_v;
  await c.env.DB.prepare('INSERT INTO milestones (id, project_id, name, due_at, done_at, gate, sort, enc_v, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)')
    .bind(s.id, s.project_id, s.name, s.due_at, s.done_at, s.gate, s.sort, s.enc_v, s.created_at, s.updated_at).run();
  await audit(c.env, 'you', 'milestone.create', row.id);
  return c.json({ milestone: row }, 201);
});

export const milestones = new Hono<{ Bindings: Env; Variables: Variables }>();

milestones.patch('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT m.*, p.kind AS project_kind FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.id = ?1 AND m.deleted_at IS NULL')
    .bind(c.req.param('id')).first<Milestone & { project_kind: 'personal' | 'work' }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  const current = await open(c.env, 'milestones', row);
  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const r = checkAll(body, MILESTONE_CHECKS);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if ('name' in r.values && !r.values.name) return c.json({ error: 'name is required' }, 400);
  const next = { ...current, ...r.values, updated_at: now() };
  const s = await seal(c.env, 'milestones', { ...next }, row.project_kind);
  const cols = Object.keys(r.values).concat('updated_at', 'enc_v');
  await c.env.DB.prepare(`UPDATE milestones SET ${cols.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
    .bind(row.id, ...cols.map((k) => (s as Record<string, unknown>)[k] ?? null)).run();
  const { project_kind: _pk, ...milestone } = next;
  return c.json({ milestone });
});

milestones.delete('/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE milestones SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default projects;
