import type { Env } from '../types.ts';
import type { Project, Milestone, Task, RaidItem, ChangeRequest, Decision, Lesson } from '../../shared/types.ts';
import { open, openAll } from './enc.ts';

type Review = { title: string; summary: string | null; received_at: string; enc_v: number };

/** Where a project's data may go: null project → cloud; unknown or trashed project → null. */
export async function boundaryOf(env: Env, projectId: string | null): Promise<'cloud' | 'offline' | null> {
  if (!projectId) return 'cloud';
  const r = await env.DB.prepare('SELECT data_boundary FROM projects WHERE id = ?1 AND deleted_at IS NULL').bind(projectId).first<{ data_boundary: 'cloud' | 'offline' }>();
  return r?.data_boundary ?? null;
}

const one = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');
const section = (title: string, items: string[]) => (items.length ? [`${title}:`, ...items.map((x) => '- ' + x)].join('\n') : '');
const parts = (...xs: [string, unknown][]) => xs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (k ? `${k} ${v}` : String(v))).join('; ');

/** The project, decrypted, as plain lines for the model. Callers check the boundary first; empty sections are left out. */
export async function projectContext(env: Env, projectId: string): Promise<string> {
  const q = (sql: string) => env.DB.prepare(sql).bind(projectId);
  const [p, ms, ts, raid, crs, dec, les, mr] = await env.DB.batch([
    q('SELECT * FROM projects WHERE id = ?1 AND deleted_at IS NULL'),
    q('SELECT * FROM milestones WHERE project_id = ?1 AND done_at IS NULL AND deleted_at IS NULL ORDER BY due_at IS NULL, due_at, sort'),
    q(`SELECT * FROM tasks WHERE project_id = ?1 AND status != 'done' AND deleted_at IS NULL ORDER BY due_at IS NULL, due_at, created_at LIMIT 40`),
    q(`SELECT * FROM raid_items WHERE project_id = ?1 AND status = 'open' AND deleted_at IS NULL ORDER BY COALESCE(probability, 0) * COALESCE(impact, 0) DESC, created_at LIMIT 20`),
    q(`SELECT * FROM change_requests WHERE project_id = ?1 AND decision = 'pending' AND deleted_at IS NULL ORDER BY created_at`),
    q('SELECT * FROM decisions WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY decided_at DESC, created_at DESC LIMIT 10'),
    q('SELECT * FROM lessons WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10'),
    q('SELECT title, summary, received_at, enc_v FROM meeting_reviews WHERE project_id = ?1 ORDER BY received_at DESC LIMIT 3'),
  ]);
  const row = p.results[0] as Project | undefined;
  if (!row) return '';
  const pr = await open(env, 'projects', row);
  const budget = pr.budget_planned !== null || pr.budget_spent !== null ? parts(['planned', pr.budget_planned], ['spent', pr.budget_spent]) : '';
  const record = [
    `Project: ${one(pr.name)} (${pr.kind})`,
    `Status: ${parts(['', pr.status], ['phase', one(pr.phase)])}`,
    pr.rag !== 'none' ? `RAG: ${pr.rag}${pr.rag_reason ? ' - ' + one(pr.rag_reason) : ''}` : '',
    pr.sponsor ? `Sponsor: ${one(pr.sponsor)}` : '',
    pr.start_at || pr.end_at ? `Dates: ${parts(['start', pr.start_at], ['end', pr.end_at])}` : '',
    budget ? `Budget: ${budget}` : '',
    pr.objectives ? `Objectives: ${one(pr.objectives)}` : '',
    pr.scope_in ? `Scope in: ${one(pr.scope_in)}` : '',
    pr.scope_out ? `Scope out: ${one(pr.scope_out)}` : '',
    pr.success_criteria ? `Success criteria: ${one(pr.success_criteria)}` : '',
  ].filter(Boolean).join('\n');

  const milestones = (await openAll(env, 'milestones', ms.results as Milestone[])).map((m) => parts(['', one(m.name)], ['due', m.due_at], ['', m.gate ? 'gate' : '']));
  const tasks = (await openAll(env, 'tasks', ts.results as Task[])).map((t) => parts(['', one(t.title)], ['status', t.status], ['due', t.due_at], ['waiting on', one(t.waiting_on)]));
  const risks = (await openAll(env, 'raid_items', raid.results as RaidItem[])).map((r) => parts([r.type + ':', one(r.text)], ['P', r.probability], ['I', r.impact], ['owner', one(r.owner)], ['response', one(r.response)]));
  const changes = (await openAll(env, 'change_requests', crs.results as ChangeRequest[])).map((x) => parts(['', one(x.title)], ['scope impact', one(x.impact_scope)], ['time impact', one(x.impact_time)], ['cost impact', one(x.impact_cost)]));
  const decisions = (await openAll(env, 'decisions', dec.results as Decision[])).map((d) => `${day(d.decided_at)} ${one(d.text)}`);
  const lessons = (await openAll(env, 'lessons', les.results as Lesson[])).map((l) => one(l.text));
  const meetings = (await openAll(env, 'meeting_reviews', mr.results as Review[])).map((m) => `${one(m.title)} (${day(m.received_at)})${m.summary ? ': ' + one(m.summary.slice(0, 600)) : ''}`);

  return [
    record,
    section('Open milestones', milestones), section('Open tasks', tasks), section('Open RAID', risks),
    section('Pending change requests', changes), section('Last decisions', decisions), section('Last lessons', lessons),
    section('Last meeting reviews', meetings),
  ].filter(Boolean).join('\n\n');
}
