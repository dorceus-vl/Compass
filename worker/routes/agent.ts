import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env, Variables } from '../types.ts';
import type { AgentScope, Milestone, Project, Task } from '../../shared/types.ts';
import { allowed, shared, parseNewTask, overLimit } from '../lib/agent.ts';
import { safeEqual } from '../lib/inbox-parse.ts';
import { open } from '../lib/enc.ts';
import { now, audit, getSettings } from '../lib/db.ts';
import { localDate } from '../lib/dates.ts';
import { createTaskFromSource, loadTask, addEvent, completeTask } from './tasks.ts';
import { portfolioRows } from './projects.ts';
import { hybridSearch } from '../lib/vectors.ts';
import { AiRefused } from '../lib/ai.ts';

// Kelly's agent API. Server to server, no cookie: the guard lets /api/agent/* through and the bearer secret is checked here.
// Everything returned or touched is "shared" (worker/lib/agent.ts): personal with no project, or a live cloud project. Anything else is a 404 and only ever a count.
const agent = new Hono<{ Bindings: Env; Variables: Variables }>();

type AgentTask = { id: string; title: string; due_at: string | null; horizon: Task['horizon']; status: Task['status']; project: string | null; priority: number };
type Projects = Map<string, Project>;
type Ctx = Context<{ Bindings: Env; Variables: Variables }>;
type Refusal = 'kelly_disabled' | 'scope_not_granted' | 'not_found' | 'rate_limited' | 'write_limit' | 'invalid' | 'error';
type Outcome = { body: unknown; detail?: Record<string, number>; status?: ContentfulStatusCode; target?: string | null; refused?: Refusal };

agent.use('*', async (c, next) => {
  const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
  const secret = c.env.AGENT_SECRET_KELLY;
  // A bad or missing secret gets 401 and nothing else: no audit row, not counted toward the rate limit.
  if (!m || !secret || !(await safeEqual(secret, m[1]))) return c.json({ error: 'Unauthorized' }, 401);
  return next();
});

const count = async (env: Env, where: string, since: string, ...args: string[]) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE actor = 'kelly' AND at > ?1 AND ${where}`).bind(since, ...args).first<{ n: number }>())?.n ?? 0;

/** The one path every authenticated call takes: limits, switch, scope, the work, then one audit row (action, target, a refusal reason or ok; never task text). */
async function call(c: Ctx, action: string, scope: AgentScope, fn: () => Promise<Outcome>): Promise<Response> {
  const env = c.env;
  const isWrite = scope === 'compass:write.tasks';
  const done = async (status: ContentfulStatusCode, body: unknown, refused?: Refusal, target: string | null = null, detail?: Outcome['detail']) => {
    await audit(env, 'kelly', action, target, refused ? { refused } : { ok: true, ...detail });
    return c.json(body, status);
  };
  const t = Date.now();
  const calls = (await count(env, `action LIKE 'agent.%'`, new Date(t - 60_000).toISOString())) + 1;
  const writes = isWrite ? (await count(env, `action IN ('agent.tasks.create','agent.tasks.done') AND detail = '{"ok":true}'`, new Date(t - 3_600_000).toISOString())) + 1 : 0;
  const over = overLimit(calls, writes, isWrite);
  if (over) { const r = over === 'rate' ? 'rate_limited' : 'write_limit'; return done(429, { error: r }, r); }
  const kelly = (await getSettings(env)).kelly;
  if (kelly?.enabled !== true) return done(403, { error: 'kelly_disabled' }, 'kelly_disabled');
  if (!allowed(kelly, scope)) return done(403, { error: 'scope_not_granted', scope }, 'scope_not_granted');
  let out: Outcome;
  try { out = await fn(); } catch (e) { console.error(e); return done(500, { error: 'internal' }, 'error'); } // still one audit row for the call
  return done(out.status ?? 200, out.body, out.refused, out.target ?? null, out.detail);
}

async function liveProjects(env: Env): Promise<Projects> {
  const { results } = await env.DB.prepare('SELECT * FROM projects WHERE deleted_at IS NULL').all<Project>();
  return new Map(results.map((p) => [p.id, p]));
}
const projectOf = (projects: Projects, t: Pick<Task, 'project_id'>) => (t.project_id ? projects.get(t.project_id) ?? null : null);
const projectName = async (env: Env, p: Project | null) => (p ? (await open(env, 'projects', { ...p })).name : null);

/** `row` is as stored (sealed for work); a task the route just wrote is already plain (insertTask / updateTask leave it so), pass plain = true. */
async function agentTask(env: Env, row: Task, projects: Projects, plain = false): Promise<AgentTask> {
  const t = plain ? row : await open(env, 'tasks', { ...row });
  return { id: t.id, title: t.title, due_at: t.due_at, horizon: t.horizon, status: t.status, project: await projectName(env, projectOf(projects, t)), priority: t.priority };
}

/** Open top-level tasks matching `where` (subtasks don't inherit their parent's project or kind, so the agent never sees them), shared ones only (newest rows beyond 500 are not looked at: ponytail, page it if one view ever holds more). */
async function sharedTasks(env: Env, where: string, args: string[], projects: Projects) {
  const { results } = await env.DB.prepare(`SELECT * FROM tasks WHERE deleted_at IS NULL AND status != 'done' AND parent_id IS NULL AND ${where} ORDER BY due_at IS NULL, due_at, created_at LIMIT 500`).bind(...args).all<Task>();
  const keep = results.filter((t) => shared(t, projectOf(projects, t)));
  return { rows: keep, hidden: results.length - keep.length };
}

agent.get('/today', (c) => call(c, 'agent.today', 'compass:read.tasks', async () => {
  const env = c.env, date = localDate((await getSettings(env)).tz), projects = await liveProjects(env);
  const { rows, hidden: hiddenTasks } = await sharedTasks(env, `(status = 'waiting' OR due_at <= ?1)`, [date], projects);
  const out = { due_today: [] as AgentTask[], overdue: [] as AgentTask[], waiting: [] as AgentTask[] };
  for (const row of rows) out[row.due_at && row.due_at < date ? 'overdue' : row.due_at === date ? 'due_today' : 'waiting'].push(await agentTask(env, row, projects));
  // Next 3 milestones of shared projects; those of other live projects ahead of them are only counted.
  const { results } = await env.DB.prepare('SELECT * FROM milestones WHERE deleted_at IS NULL AND done_at IS NULL AND due_at IS NOT NULL ORDER BY due_at LIMIT 100').all<Milestone>();
  const next_milestones: { name: string; project: string; due_at: string }[] = [];
  let hidden = hiddenTasks;
  for (const m of results) {
    const p = projects.get(m.project_id);
    if (!p) continue; // trashed project, as in the brief
    if (!shared({ project_id: p.id, kind: 'work' }, p)) { hidden++; continue; }
    next_milestones.push({ name: (await open(env, 'milestones', { ...m })).name, project: (await projectName(env, p))!, due_at: m.due_at! });
    if (next_milestones.length === 3) break;
  }
  return { body: { date, ...out, next_milestones, hidden } };
}));

const VIEWS: Record<string, string> = { today: 'due_at = ?1', overdue: 'due_at < ?1', upcoming: 'due_at > ?1', waiting: `(status = 'waiting' AND ?1 IS NOT NULL)` /* ?1 is only here so the bind count matches */ };
agent.get('/tasks', (c) => call(c, 'agent.tasks.list', 'compass:read.tasks', async () => {
  const view = c.req.query('view') ?? 'today', n = Number(c.req.query('limit') ?? 20);
  if (!VIEWS[view] || !Number.isInteger(n) || n < 1) return { status: 400, refused: 'invalid', body: { error: 'view must be today, overdue, upcoming or waiting; limit a whole number from 1 to 50' } };
  const env = c.env, date = localDate((await getSettings(env)).tz), projects = await liveProjects(env);
  const { rows, hidden } = await sharedTasks(env, VIEWS[view], [date], projects);
  return { body: { date, view, tasks: await Promise.all(rows.slice(0, Math.min(n, 50)).map((r) => agentTask(env, r, projects))), hidden } };
}));

/** One task by id, open or done, so Kelly can name it in her OK box before completing it. Missing, trashed, a subtask and not-shared all look the same (404). */
agent.get('/tasks/:id', (c) => call(c, 'agent.tasks.get', 'compass:read.tasks', async () => {
  const env = c.env, id = c.req.param('id');
  const projects = await liveProjects(env);
  const task = await loadTask(env, id);
  if (!task || task.parent_id || !shared(task, projectOf(projects, task))) return { status: 404, refused: 'not_found', target: id, body: { error: 'Not found' } };
  return { target: id, body: { task: await agentTask(env, task, projects, true) } };
}));

agent.post('/tasks', (c) => call(c, 'agent.tasks.create', 'compass:write.tasks', async () => {
  const env = c.env;
  const input = parseNewTask(await c.req.json().catch(() => null));
  if ('error' in input) return { status: 400, refused: 'invalid', body: { error: input.error } };
  const projects = await liveProjects(env);
  const project = input.project_id ? projects.get(input.project_id) ?? null : null;
  if (input.project_id && !shared({ project_id: input.project_id, kind: 'work' }, project)) return { status: 404, refused: 'not_found', body: { error: 'Not found' } };
  // The task follows its project's kind (work-and-cloud is sealed as work); with no project it is personal.
  const task = await createTaskFromSource(env, { ...input, kind: 'personal', source_app: 'kelly' });
  await addEvent(env, task, 'kelly', 'created');
  return { status: 201, target: task.id, body: { task: await agentTask(env, task, projects, true) } };
}));

agent.post('/tasks/:id/done', (c) => call(c, 'agent.tasks.done', 'compass:write.tasks', async () => {
  const env = c.env, id = c.req.param('id');
  const projects = await liveProjects(env);
  const task = await loadTask(env, id);
  // Missing, trashed, a subtask, already done and not-shared all look the same.
  if (!task || task.parent_id || task.status === 'done' || !shared(task, projectOf(projects, task))) return { status: 404, refused: 'not_found', target: id, body: { error: 'Not found' } };
  const res = await completeTask(env, task, [], 'kelly');
  return { target: id, body: { task: await agentTask(env, res.task, projects, true) } };
}));

agent.get('/projects', (c) => call(c, 'agent.projects', 'compass:read.projects', async () => {
  const rows = (await portfolioRows(c.env)).filter((p) => shared({ project_id: p.id, kind: p.kind }, p));
  return { body: { projects: rows.map((p) => ({ id: p.id, name: p.name, rag: p.rag, rag_reason: p.rag_reason, pct_done: p.pct_done, next_milestone: p.next_milestone, open_risks: p.open_risks })) } };
}));

/**
 * KN8: Kelly's knowledge search. The collection ids come from the DB here and nowhere else: live, Cloud AI, personal ("From my apps" included: its digest is already filtered, KN20). A work collection is never queried, whatever the scope says; the result is filtered again on the way out. The audit row carries counts only.
 */
agent.get('/knowledge/search', (c) => call(c, 'agent.knowledge.search', 'compass:read.knowledge', async () => {
  const q = (c.req.query('q') ?? '').trim(), raw = c.req.query('limit'), n = raw === undefined ? 5 : Number(raw);
  if (q.length < 2 || q.length > 300 || !Number.isInteger(n) || n < 1 || n > 8) return { status: 400, refused: 'invalid', body: { error: 'q must be 2 to 300 characters; limit a whole number from 1 to 8' } };
  const { results } = await c.env.DB.prepare("SELECT id FROM knowledge_collections WHERE scope = 'personal' AND boundary = 'cloud' AND deleted_at IS NULL").all<{ id: string }>();
  const ids = results.map((r) => r.id);
  try {
    const found = (await hybridSearch(c.env, q, ids, n)).filter((p) => p.collection.scope === 'personal' && ids.includes(p.collection.id));
    return { detail: { passages: found.length, collections: ids.length }, body: { passages: found.map((p) => ({ text: p.text, document: p.item_title, locator: p.locator, collection: p.collection.name })) } };
  } catch (e) {
    if (!(e instanceof AiRefused)) throw e;
    return { status: e.status as ContentfulStatusCode, refused: e.code === 'rate_limited' ? 'rate_limited' : 'error', body: { error: e.code } };
  }
}));

export default agent;
