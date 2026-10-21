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
import { unembedStale } from '../lib/vectors.ts';
import { seriesName, HASH } from '../../shared/series.ts';
import { backfillSeries, keyOfTitle, insertSeriesStmt, loadSeries, meetingTasks, parseAnswered, reviewOfTask, scopeKind, seriesDetail, seriesIds, MAX_ANSWERED } from '../lib/series.ts';

const meetings = new Hono<{ Bindings: Env; Variables: Variables }>();

type Row = Record<string, unknown> & { enc_v?: number };
export const loadMeeting = async (env: Env, id: string): Promise<MeetingReview | null> => {
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
const reviewStmt = (env: Env, id: string, project_id: string | null, t: string, series_id: string | null = null) =>
  env.DB.prepare(`UPDATE meeting_reviews SET state = 'reviewed', project_id = ?2, reviewed_at = ?3, updated_at = ?3, series_id = COALESCE(?4, series_id) WHERE id = ?1 AND state = 'new'`).bind(id, project_id, t, series_id);

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

// ---- v2.1 series. Registered before /:id so "series" is never read as a review id. Online only, like the rest of reviewing.
meetings.get('/series', async (c) => {
  await backfillSeries(c.env);
  const [{ results: rows }, { results: revs }, tasks] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM meeting_series WHERE deleted_at IS NULL').all<Row>(),
    c.env.DB.prepare('SELECT id, url, project_id, series_id, state, received_at FROM meeting_reviews WHERE series_id IS NOT NULL').all<{ id: string; url: string | null; project_id: string | null; series_id: string; state: string; received_at: string }>(),
    meetingTasks(c.env),
  ]);
  const open = new Map<string, number>(); // series id -> open actions
  const of = new Map(revs.map((r) => [r.id, r.series_id]));
  for (const t of tasks) { const rid = reviewOfTask(t, revs); const sid = rid && of.get(rid); if (sid && t.status !== 'done') open.set(sid, (open.get(sid) ?? 0) + 1); }
  const series = (await openAll(c.env, 'meeting_series', rows)).flatMap((s) => {
    const mine = revs.filter((r) => r.series_id === s.id);
    if (!mine.length) return []; // a series every meeting has left stays out of the list
    return [{ id: s.id as string, name: s.name as string, project_id: (s.project_id as string | null) ?? null, kind: s.kind as 'personal' | 'work', meetings: mine.length,
      new_meetings: mine.filter((r) => r.state === 'new').length, last_at: mine.map((r) => r.received_at).sort().at(-1)!, open_actions: open.get(s.id as string) ?? 0 }];
  }).sort((a, b) => b.last_at.localeCompare(a.last_at));
  return c.json({ series });
});

meetings.get('/series/:id', async (c) => {
  const s = await loadSeries(c.env, c.req.param('id'));
  if (!s) return c.json({ error: 'Not found' }, 404);
  const d = await seriesDetail(c.env, s);
  // V17: Athena may write the agenda only for an unfiled series or one whose project is live and Cloud (not Offline only, missing or in Trash).
  const pr = s.project_id ? await c.env.DB.prepare('SELECT data_boundary FROM projects WHERE id = ?1 AND deleted_at IS NULL').bind(s.project_id).first<{ data_boundary: string }>() : null;
  const athena = !s.project_id || pr?.data_boundary === 'cloud';
  return c.json({ series: { id: s.id, name: s.name, project_id: s.project_id, kind: s.kind, athena }, meetings: d.reviews, decisions: d.decisions, actions: d.actions, questions: d.questions });
});

meetings.patch('/series/:id', async (c) => {
  const s = await loadSeries(c.env, c.req.param('id'));
  if (!s) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<unknown>().catch(() => null);
  if (!isObj(body)) return c.json({ error: 'body must be an object' }, 400);
  let name = s.name, list = parseAnswered(s.answered);
  if (body.name !== undefined) { const n = str(body.name, 120); if (!n) return c.json({ error: 'name must be 1-120 characters' }, 400); name = n; }
  if (body.answer !== undefined) { // { hash, answered }: V8, a question stays open until it is marked answered
    const a = body.answer;
    if (!isObj(a) || typeof a.hash !== 'string' || !HASH.test(a.hash) || typeof a.answered !== 'boolean') return c.json({ error: 'answer must be { hash, answered }' }, 400);
    list = list.filter((h) => h !== a.hash);
    if (a.answered) list.push(a.hash);
    if (list.length > MAX_ANSWERED) return c.json({ error: `at most ${MAX_ANSWERED} answered questions` }, 400);
  }
  if (body.name === undefined && body.answer === undefined) return c.json({ error: 'nothing to change' }, 400);
  const t = now();
  const sealed = await seal(c.env, 'meeting_series', { name, answered: body.answer !== undefined || s.answered !== null ? JSON.stringify(list) : null, enc_v: 0 }, s.kind);
  await c.env.DB.prepare('UPDATE meeting_series SET name = ?2, answered = ?3, updated_at = ?4, enc_v = ?5 WHERE id = ?1').bind(s.id, sealed.name, sealed.answered, t, sealed.enc_v).run();
  await audit(c.env, 'you', 'meeting.series', s.id, { name: body.name !== undefined, answer: body.answer !== undefined });
  return c.json({ series: { id: s.id, name, project_id: s.project_id, kind: s.kind } });
});

/** Move a meeting into another series of its project (or the unfiled ones), or into a new one. The move is the meeting's series: accepting it later keeps that series' key. */
meetings.post('/:id/series', async (c) => {
  const meeting = await loadMeeting(c.env, c.req.param('id'));
  if (!meeting) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<unknown>().catch(() => null);
  if (!isObj(body)) return c.json({ error: 'body must be an object' }, 400);
  const writes: D1PreparedStatement[] = [];
  let target: { id: string; name: string };
  if (typeof body.series_id === 'string') {
    const s = await loadSeries(c.env, body.series_id);
    if (!s) return c.json({ error: 'Not found' }, 404);
    if (s.project_id !== meeting.project_id) return c.json({ error: 'A meeting can only join a series of its own project' }, 400);
    target = { id: s.id, name: s.name };
  } else {
    const name = str(body.new_name, 120);
    if (!name) return c.json({ error: 'new_name must be 1-120 characters' }, 400);
    const { key, id } = await seriesIds(c.env, await keyOfTitle(c.env, name), meeting.project_id);
    writes.push(await insertSeriesStmt(c.env, id, key, name, meeting.project_id, await scopeKind(c.env, meeting.project_id)));
    target = { id, name };
  }
  writes.push(c.env.DB.prepare('UPDATE meeting_reviews SET series_id = ?2 WHERE id = ?1').bind(meeting.id, target.id));
  await c.env.DB.batch(writes);
  const row = (await loadSeries(c.env, target.id))!; // an existing series with the same words keeps its own name
  await audit(c.env, 'you', 'meeting.move', meeting.id);
  return c.json({ meeting: { ...meeting, series_id: target.id }, series: { id: row.id, name: row.name } });
});

meetings.get('/:id', async (c) => {
  const meeting = await loadMeeting(c.env, c.req.param('id'));
  if (!meeting) return c.json({ error: 'Not found' }, 404);
  const s = meeting.series_id ? await loadSeries(c.env, meeting.series_id) : null;
  return c.json({ meeting, series: s ? { id: s.id, name: s.name } : null });
});

meetings.post('/:id/dismiss', async (c) => {
  const meeting = await loadMeeting(c.env, c.req.param('id'));
  if (!meeting) return c.json({ error: 'Not found' }, 404);
  if (meeting.state !== 'new') return c.json({ error: 'Already reviewed' }, 409);
  const t = now();
  if (!(await commit(c.env, meeting.id, [guardStmt(c.env, meeting.id), inboxStmt(c.env, meeting.recording_id, 'dismissed', t), reviewStmt(c.env, meeting.id, null, t)]))) return c.json({ error: 'Already reviewed' }, 409);
  await audit(c.env, 'you', 'meeting.dismiss', meeting.id);
  return c.json({ meeting: { ...meeting, state: 'reviewed', reviewed_at: t } });
});

meetings.post('/:id/accept', async (c) => {
  const meeting = await loadMeeting(c.env, c.req.param('id'));
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
      project_id: project_id as string | null, kind: pkind ?? i.kind, source_app: 'sonarflow', source_kind: 'meeting', source_ref: `meeting:${meeting.id}:${madeTasks.length}`, // V7: the series page finds its actions through this
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
  // v2.1: into a project, the review joins that project's series for its key (the key of the series it is in now, so a move by hand is kept); unfiled, it keeps its series.
  let seriesId: string | null = null;
  if (project_id || !meeting.series_id) {
    const cur = meeting.series_id ? await loadSeries(c.env, meeting.series_id) : null;
    const ids = await seriesIds(c.env, cur?.key ?? await keyOfTitle(c.env, meeting.title), (project_id as string | null) ?? null);
    writes.push(await insertSeriesStmt(c.env, ids.id, ids.key, cur?.name ?? seriesName(meeting.title), (project_id as string | null) ?? null, pkind ?? 'work'));
    seriesId = ids.id;
  }
  writes.push(inboxStmt(c.env, meeting.recording_id, 'kept', t), reviewStmt(c.env, meeting.id, project_id as string | null, t, seriesId));
  if (!(await commit(c.env, meeting.id, writes))) return c.json({ error: 'Already reviewed' }, 409);
  await audit(c.env, 'you', 'meeting.accept', meeting.id, { tasks: madeTasks.length, decisions: madeDecisions.length, raid: raidItems.length });
  // KN16: notes already saved to knowledge now follow this project; Offline only takes their vectors at once (search already leaves them out: LIVE).
  if (project_id) c.executionCtx.waitUntil(unembedStale(c.env).catch((e) => console.error(`[knowledge] sweep failed: ${(e as Error).name}`)));
  return c.json({ meeting: { ...meeting, state: 'reviewed', project_id, reviewed_at: t }, tasks: madeTasks, decisions: madeDecisions, raid: raidItems.length }, 201);
});

export default meetings;
