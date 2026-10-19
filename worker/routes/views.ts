import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { Task, Milestone, Project, Status, TodayAnswer } from '../../shared/types.ts';
import { openAll } from '../lib/enc.ts';
import { getSettings } from '../lib/db.ts';
import { localDate, addDays, weekStart as weekStartOf } from '../lib/dates.ts';

const views = new Hono<{ Bindings: Env; Variables: Variables }>();

views.get('/today', async (c) => {
  const settings = await getSettings(c.env);
  const date = localDate(settings.tz);
  const weekStart = weekStartOf(date);
  const open = await c.env.DB.prepare(`SELECT * FROM tasks WHERE deleted_at IS NULL AND status != 'done' AND parent_id IS NULL ORDER BY due_at IS NULL, due_at, priority DESC, sort_in_column`).all<Task>();
  const tasks = await openAll(c.env, 'tasks', open.results);
  const doneWeek = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND status = 'done' AND done_at >= ?1`).bind(weekStart).first<{ n: number }>();
  const ms = await c.env.DB.prepare(
    `SELECT m.*, p.name AS project_name, p.kind AS project_kind FROM milestones m JOIN projects p ON p.id = m.project_id
     WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND m.done_at IS NULL AND m.due_at IS NOT NULL ORDER BY m.due_at LIMIT 5`,
  ).all<Milestone & { project_name: string; project_kind: string }>();
  const milestones = await openAll(c.env, 'milestones', ms.results);
  for (const m of milestones) if (m.project_kind === 'work') m.project_name = (await openAll(c.env, 'projects', [{ name: m.project_name, enc_v: 2 } as unknown as Project]))[0].name;
  const answer: TodayAnswer = {
    date,
    short: tasks.filter((t) => t.horizon === 'short'), medium: tasks.filter((t) => t.horizon === 'medium'), long: tasks.filter((t) => t.horizon === 'long'),
    overdue: tasks.filter((t) => t.due_at && t.due_at < date),
    open_today: tasks.filter((t) => t.due_at && t.due_at <= date).length,
    done_this_week: doneWeek?.n ?? 0,
    milestones: milestones.map(({ project_kind: _k, ...m }) => m),
  };
  return c.json(answer);
});

views.get('/board', async (c) => {
  const q = c.req.query();
  const where = ['deleted_at IS NULL', 'parent_id IS NULL'];
  const args: unknown[] = [];
  if (q.kind === 'personal' || q.kind === 'work') where.push(`kind = ?${args.push(q.kind)}`);
  if (q.project) where.push(`project_id = ?${args.push(q.project)}`);
  // Done shows this week's only; older done cards live in List (status=done) and Trash.
  const settings = await getSettings(c.env);
  const date = localDate(settings.tz);
  const weekStart = weekStartOf(date);
  where.push(`(status != 'done' OR done_at >= ?${args.push(weekStart)})`);
  const { results } = await c.env.DB.prepare(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY sort_in_column, created_at`).bind(...args).all<Task>();
  const tasks = await openAll(c.env, 'tasks', results);
  const columns: Record<Status, Task[]> = { new: [], progress: [], hold: [], waiting: [], done: [] };
  for (const t of tasks) columns[t.status].push(t);
  return c.json({ columns, wip_limits: settings.wip_limits });
});

views.get('/timeline', async (c) => {
  const q = c.req.query();
  const settings = await getSettings(c.env);
  const from = q.from ?? addDays(localDate(settings.tz), -14);
  const to = q.to ?? addDays(localDate(settings.tz), 90);
  const pw = q.project ? 'AND project_id = ?3' : '';
  const args = q.project ? [from, to, q.project] : [from, to];
  const t = await c.env.DB.prepare(`SELECT * FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND due_at IS NOT NULL AND due_at >= ?1 AND COALESCE(start_at, due_at) <= ?2 ${pw} ORDER BY COALESCE(start_at, due_at)`).bind(...args).all<Task>();
  const m = await c.env.DB.prepare(`SELECT * FROM milestones WHERE deleted_at IS NULL AND due_at IS NOT NULL AND due_at >= ?1 AND due_at <= ?2 ${pw} ORDER BY due_at`).bind(...args).all<Milestone>();
  const p = await c.env.DB.prepare(`SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY sort, created_at`).all<Project>();
  const projects = await openAll(c.env, 'projects', p.results);
  const milestones = await openAll(c.env, 'milestones', m.results);
  return c.json({ from, to, tasks: await openAll(c.env, 'tasks', t.results), milestones, projects });
});

export default views;
