import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { MeetingReview, Decision, Task, TaskEvent, Kind } from '../../shared/types.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit, getSettings } from '../lib/db.ts';
import { localDate } from '../lib/dates.ts';
import { date } from '../lib/validate.ts';
import { projectKind } from './projects.ts';
import { buildTaskFromSource, insertTaskStmt } from './tasks.ts';
import { asReview } from './inbox.ts';

const meetings = new Hono<{ Bindings: Env; Variables: Variables }>();

type Row = Record<string, unknown> & { enc_v?: number };
const load = async (env: Env, id: string): Promise<MeetingReview | null> => {
  const row = await env.DB.prepare('SELECT * FROM meeting_reviews WHERE id = ?1').bind(id).first<Row>();
  return row ? asReview((await open(env, 'meeting_reviews', row)) as Row) : null;
};
const ME = ['vlad', 'vladimir', 'me'];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
/** The Today strip's meeting row follows the review: kept on accept, dismissed on dismiss. */
const inboxStmt = (env: Env, rid: string, state: 'kept' | 'dismissed', t: string) =>
  env.DB.prepare(`UPDATE inbox_items SET state = ?2, updated_at = ?3 WHERE ref = ?1 AND kind = 'meeting'`).bind(`sonarflow:recording:${rid}`, state, t);
/** First statement of a batch: errors (so D1 rolls the whole batch back) when the review is no longer 'new', which also covers two accepts racing. */
const guardStmt = (env: Env, id: string) =>
  env.DB.prepare(`SELECT CASE WHEN (SELECT state FROM meeting_reviews WHERE id = ?1) = 'new' THEN 1 ELSE json('not json') END`).bind(id);
const reviewStmt = (env: Env, id: string, project_id: string | null, t: string) =>
  env.DB.prepare(`UPDATE meeting_reviews SET state = 'reviewed', project_id = ?2, reviewed_at = ?3, updated_at = ?3 WHERE id = ?1 AND state = 'new'`).bind(id, project_id, t);

/** Runs the batch (guard first, review update last); false when the review had already been handled. */
async function commit(env: Env, id: string, writes: D1PreparedStatement[]): Promise<boolean> {
  try {
    const res = await env.DB.batch(writes);
    return !!res[res.length - 1].meta.changes;
  } catch (e) {
    const s = await env.DB.prepare('SELECT state FROM meeting_reviews WHERE id = ?1').bind(id).first<{ state: string }>();
    if (s && s.state !== 'new') return false;
    throw e;
  }
}

meetings.get('/', async (c) => {
  const project = c.req.query('project'); // one project's meetings, whatever their state
  const all = c.req.query('state') === 'all';
  const { results } = await c.env.DB.prepare(`SELECT * FROM meeting_reviews ${project ? 'WHERE project_id = ?1' : all ? '' : `WHERE state = 'new'`} ORDER BY received_at DESC LIMIT 200`).bind(...(project ? [project] : [])).all<Row>();
  return c.json({ meetings: (await openAll(c.env, 'meeting_reviews', results)).map((r) => asReview(r)) });
});

meetings.get('/:id', async (c) => {
  const meeting = await load(c.env, c.req.param('id'));
  return meeting ? c.json({ meeting }) : c.json({ error: 'Not found' }, 404);
});

meetings.post('/:id/dismiss', async (c) => {
  const meeting = await load(c.env, c.req.param('id'));
  if (!meeting) return c.json({ error: 'Not found' }, 404);
  if (meeting.state !== 'new') return c.json({ error: 'Already reviewed' }, 409);
  const t = now();
  if (!(await commit(c.env, meeting.id, [guardStmt(c.env, meeting.id), inboxStmt(c.env, meeting.recording_id, 'dismissed', t), reviewStmt(c.env, meeting.id, null, t)]))) return c.json({ error: 'Already reviewed' }, 409);
  await audit(c.env, 'you', 'meeting.dismiss', meeting.id);
  return c.json({ meeting: { ...meeting, state: 'reviewed', reviewed_at: t } });
});

meetings.post('/:id/accept', async (c) => {
  const meeting = await load(c.env, c.req.param('id'));
  if (!meeting) return c.json({ error: 'Not found' }, 404);
  if (meeting.state !== 'new') return c.json({ error: 'Already reviewed' }, 409);
  const body = await c.req.json<unknown>().catch(() => null);
  if (!isObj(body)) return c.json({ error: 'body must be an object' }, 400);
  const { tasks: rawTasks = [], decisions: rawDecisions = [] } = body;
  if (!Array.isArray(rawTasks) || !Array.isArray(rawDecisions) || rawTasks.length > 50 || rawDecisions.length > 50) return c.json({ error: 'tasks and decisions must be lists of 50 at most' }, 400);
  const rawRaid = body.raid ?? [];
  if (!Array.isArray(rawRaid) || rawRaid.length > 50) return c.json({ error: 'raid must be a list of 50 at most' }, 400);
  const project_id = body.project_id ?? null;
  let pkind: Kind | null = null;
  if (project_id !== null) {
    pkind = typeof project_id === 'string' ? await projectKind(c.env, project_id) : null;
    if (!pkind) return c.json({ error: 'project_id is not a project' }, 400);
  }
  type Item = { text: string; due: string | null; owner: string | null; at: string | null; kind: Kind };
  const items: Item[] = [], decs: { text: string; at: string | null }[] = [];
  for (const t of rawTasks) {
    if (!isObj(t)) return c.json({ error: 'each task must be an object' }, 400);
    const text = str(t.text, 300), due = date()(t.due, 'due'), at = t.at == null ? null : str(t.at, 12);
    const owner = t.owner == null ? null : str(t.owner, 200);
    if (!text) return c.json({ error: 'task text must be 1-300 characters' }, 400);
    if ('error' in due) return c.json({ error: due.error }, 400);
    if (t.at != null && !at) return c.json({ error: 'at must be 1-12 characters' }, 400);
    if (t.owner != null && !owner) return c.json({ error: 'owner must be 1-200 characters' }, 400);
    if (t.kind !== undefined && t.kind !== 'personal' && t.kind !== 'work') return c.json({ error: 'kind must be personal or work' }, 400);
    items.push({ text, due: due.value as string | null, owner, at, kind: (t.kind as Kind | undefined) ?? 'work' });
  }
  for (const d of rawDecisions) {
    if (!isObj(d)) return c.json({ error: 'each decision must be an object' }, 400);
    const text = str(d.text, 300), at = d.at == null ? null : str(d.at, 12);
    if (!text) return c.json({ error: 'decision text must be 1-300 characters' }, 400);
    if (d.at != null && !at) return c.json({ error: 'at must be 1-12 characters' }, 400);
    decs.push({ text, at });
  }

  const raidItems: { type: 'risk' | 'issue'; text: string; at: string | null }[] = [];
  for (const x of rawRaid) {
    if (!isObj(x)) return c.json({ error: 'each raid item must be an object' }, 400);
    const text = str(x.text, 2000), at = x.at == null ? null : str(x.at, 12);
    if (x.type !== 'risk' && x.type !== 'issue') return c.json({ error: 'raid type must be risk or issue' }, 400);
    if (!text) return c.json({ error: 'raid text must be 1-2000 characters' }, 400);
    if (x.at != null && !at) return c.json({ error: 'at must be 1-12 characters' }, 400);
    raidItems.push({ type: x.type, text, at });
  }
  if (raidItems.length && !pkind) return c.json({ error: 'raid items need a project' }, 400);

  const t = now();
  const decidedAt = localDate((await getSettings(c.env)).tz, new Date(meeting.received_at));
  const writes: D1PreparedStatement[] = [guardStmt(c.env, meeting.id)];
  const madeTasks: Task[] = [];
  const perStatus: Record<string, number> = {};
  for (const i of items) {
    const mine = !i.owner || ME.includes(i.owner.toLowerCase());
    const task = await buildTaskFromSource(c.env, {
      title: i.text, notes: i.owner ? `Owner: ${i.owner}` : null, waiting_on: mine ? null : i.owner, status: mine ? 'new' : 'waiting', due_at: i.due,
      project_id: project_id as string | null, kind: pkind ?? i.kind, source_app: 'sonarflow', source_kind: 'meeting', source_ref: null,
      source_url: meeting.url ? meeting.url + (i.at ? `${meeting.url.includes('?') ? '&' : '?'}t=${encodeURIComponent(i.at)}` : '') : null,
    });
    task.sort_in_column += 1000 * (perStatus[task.status] ?? 0); // every task read the same column maximum; step them apart, per status
    perStatus[task.status] = (perStatus[task.status] ?? 0) + 1;
    writes.push(await insertTaskStmt(c.env, task));
    const ev: TaskEvent = { id: crypto.randomUUID(), task_id: task.id, at: t, actor: 'meeting', type: 'created', data: JSON.stringify({ meeting_id: meeting.id }), enc_v: 0 };
    const s = await seal(c.env, 'task_events', { ...ev }, task.kind);
    writes.push(c.env.DB.prepare('INSERT INTO task_events (id, task_id, at, actor, type, data, enc_v) VALUES (?1,?2,?3,?4,?5,?6,?7)').bind(s.id, s.task_id, s.at, s.actor, s.type, s.data, s.enc_v));
    madeTasks.push(task);
  }
  const madeDecisions: Decision[] = [];
  for (const d of decs) {
    const dec: Decision = { id: crypto.randomUUID(), project_id: project_id as string | null, text: d.text, decided_at: decidedAt, from_meeting_id: meeting.id, at_ref: d.at, created_at: t, updated_at: t, deleted_at: null, enc_v: 0 };
    const s = await seal(c.env, 'decisions', { ...dec }, pkind ?? 'work');
    writes.push(c.env.DB.prepare('INSERT INTO decisions (id, project_id, text, decided_at, from_meeting_id, at_ref, created_at, updated_at, enc_v) VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?8)')
      .bind(s.id, s.project_id, s.text, s.decided_at, s.from_meeting_id, s.at_ref, t, s.enc_v));
    madeDecisions.push(dec);
  }
  for (const x of raidItems) {
    const row: Record<string, unknown> = {
      id: crypto.randomUUID(), project_id, type: x.type, text: x.text, trigger: x.at ? `Meeting ${x.at}` : null, status: 'open', from_meeting_id: meeting.id,
      created_at: t, updated_at: t, enc_v: 0,
    };
    const s = await seal(c.env, 'raid_items', row, pkind!);
    writes.push(c.env.DB.prepare('INSERT INTO raid_items (id, project_id, type, text, trigger, status, from_meeting_id, created_at, updated_at, enc_v) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)')
      .bind(s.id, s.project_id, s.type, s.text, s.trigger, s.status, s.from_meeting_id, t, t, s.enc_v));
  }
  writes.push(inboxStmt(c.env, meeting.recording_id, 'kept', t), reviewStmt(c.env, meeting.id, project_id as string | null, t));
  if (!(await commit(c.env, meeting.id, writes))) return c.json({ error: 'Already reviewed' }, 409);
  await audit(c.env, 'you', 'meeting.accept', meeting.id, { tasks: madeTasks.length, decisions: madeDecisions.length, raid: raidItems.length });
  return c.json({ meeting: { ...meeting, state: 'reviewed', project_id, reviewed_at: t }, tasks: madeTasks, decisions: madeDecisions, raid: raidItems.length }, 201);
});

export default meetings;
