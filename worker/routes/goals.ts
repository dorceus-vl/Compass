import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { Kind, Goal, KeyResult, GoalLink, GoalCheckin, KrType, Confidence, GoalStatus } from '../../shared/types.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit } from '../lib/db.ts';
import { clampTs } from '../../shared/time.ts';
import { MAX_KRS, MAX_LINKS, MAX_NOTE, MAX_TITLE } from '../../shared/goals.ts';

/**
 * Goals (v2.6): goals, key results, links to tasks or projects, check-ins. Children seal by their goal's kind and are hidden while their goal
 * (or key result) is in Trash (G2). Every progress figure is computed on the device (shared/goals.ts). Kelly and Athena have no route here.
 */
const goals = new Hono<{ Bindings: Env; Variables: Variables }>();
const readBody = (c: { req: { json: <T>() => Promise<T> } }) => c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
const id40 = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 40;
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const KR_TYPES: KrType[] = ['number', 'tasks', 'done', 'percent'];
const CONFIDENCE: Confidence[] = ['on_track', 'at_risk', 'off_track'];
const STATUSES: GoalStatus[] = ['active', 'achieved', 'missed', 'dropped'];
const GOAL_COLS = ['id', 'kind', 'title', 'description', 'starts_on', 'ends_on', 'status', 'sort', 'enc_v', 'created_at', 'updated_at', 'deleted_at'] as const;
const KR_COLS = ['id', 'goal_id', 'title', 'type', 'start_value', 'target_value', 'current_value', 'unit', 'sort', 'enc_v', 'created_at', 'updated_at', 'deleted_at'] as const;
const LINK_COLS = ['id', 'kr_id', 'task_id', 'project_id', 'created_at', 'updated_at', 'deleted_at'] as const;
const CHECKIN_COLS = ['id', 'kr_id', 'value', 'confidence', 'note', 'at', 'enc_v', 'created_at', 'updated_at', 'deleted_at'] as const;
const marks = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `?${i + from}`).join(', ');
const NO_STORE = { 'Cache-Control': 'private, no-store' };

type Fail = { error: string; message: string };
const fail = (error: string, message: string): Fail => ({ error, message });
/** Text: trimmed, null when empty; a Fail when not text or too long. */
function text(v: unknown, max: number, name: string): string | null | Fail {
  if (v == null) return null;
  if (typeof v !== 'string') return fail('bad_goal', `${name} must be text`);
  const s = v.trim();
  if (s.length > max) return fail('bad_goal', `${name} is at most ${max} characters`);
  return s || null;
}
const isFail = (v: unknown): v is Fail => typeof v === 'object' && v !== null && 'error' in v;

/** A live key result whose goal is live, with the goal's kind (children seal by it). */
const liveKr = (env: Env, id: string) => env.DB.prepare(`SELECT k.*, g.kind AS goal_kind FROM key_results k JOIN goals g ON g.id = k.goal_id
  WHERE k.id = ?1 AND k.deleted_at IS NULL AND g.deleted_at IS NULL`).bind(id).first<KeyResult & { goal_kind: Kind }>();

/** G3: a key result's values from its type; a Fail when a number key result's start or target is missing or equal. */
function krValues(type: KrType, body: Record<string, unknown>): Pick<KeyResult, 'start_value' | 'target_value' | 'current_value' | 'unit'> | Fail {
  if (type === 'tasks') return { start_value: null, target_value: null, current_value: null, unit: null };
  if (type === 'percent') return { start_value: 0, target_value: 100, current_value: 0, unit: null };
  if (type === 'done') return { start_value: 0, target_value: 1, current_value: 0, unit: null };
  if (!isNum(body.start_value) || !isNum(body.target_value)) return fail('bad_kr', 'a number key result needs a start and a target');
  if (body.start_value === body.target_value) return fail('bad_kr', 'the start and the target must differ');
  const unit = text(body.unit, 20, 'unit');
  if (isFail(unit)) return { ...unit, error: 'bad_kr' };
  return { start_value: body.start_value, target_value: body.target_value, current_value: body.start_value, unit };
}

/** Compare-and-swap on updated_at: only `fields` are written, over the version read (or the one the caller names). At most 3 + 6 binds. */
async function casUpdate(env: Env, table: 'goals' | 'key_results', stored: { id: string; updated_at: string }, sealed: Record<string, unknown>, fields: string[], callerVersion: unknown) {
  const expected = typeof callerVersion === 'string' ? callerVersion : stored.updated_at;
  const r = await env.DB.prepare(`UPDATE ${table} SET ${fields.map((k, i) => `${k} = ?${i + 5}, `).join('')}updated_at = ?3, enc_v = ?4 WHERE id = ?1 AND deleted_at IS NULL AND updated_at = ?2`)
    .bind(stored.id, expected, sealed.updated_at, sealed.enc_v, ...fields.map((k) => sealed[k] ?? null)).run();
  return r.meta.changes > 0;
}
const conflict = fail('goal_conflict', 'This changed meanwhile; try again');

// G7: one pull for the four tables. With `since`, trashed rows come back too so the device drops them.
goals.get('/', async (c) => {
  const since = c.req.query('since');
  const read = <T>(table: string) => (since
    ? c.env.DB.prepare(`SELECT * FROM ${table} WHERE updated_at >= ?1`).bind(since)
    : c.env.DB.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL`)).all<T>().then((r) => r.results);
  const [g, k, l, ch] = await Promise.all([read<Goal>('goals'), read<KeyResult>('key_results'), read<GoalLink>('goal_links'), read<GoalCheckin>('goal_checkins')]);
  return c.json({ goals: await openAll(c.env, 'goals', g), krs: await openAll(c.env, 'key_results', k), links: l, checkins: await openAll(c.env, 'goal_checkins', ch) }, 200, NO_STORE);
});

goals.post('/', async (c) => {
  const body = await readBody(c);
  if (body.kind !== 'personal' && body.kind !== 'work') return c.json(fail('bad_goal', 'kind is personal or work'), 400);
  const title = text(body.title, MAX_TITLE, 'title'), description = text(body.description, 2000, 'description');
  if (isFail(title)) return c.json(title, 400);
  if (!title) return c.json(fail('bad_goal', 'a goal needs a title'), 400);
  if (isFail(description)) return c.json(description, 400);
  if (!isYmd(body.starts_on) || !isYmd(body.ends_on) || body.starts_on > body.ends_on) return c.json(fail('bad_goal', 'starts_on and ends_on are dates, start first'), 400);
  const t = now();
  const row: Goal = {
    id: crypto.randomUUID(), kind: body.kind, title, description, starts_on: body.starts_on, ends_on: body.ends_on, status: 'active',
    sort: isNum(body.sort) ? body.sort : 0, enc_v: 0, created_at: t, updated_at: t, deleted_at: null,
  };
  const s = await seal(c.env, 'goals', { ...row }) as unknown as Record<string, unknown>;
  row.enc_v = s.enc_v as number;
  await c.env.DB.prepare(`INSERT INTO goals (${GOAL_COLS.join(', ')}) VALUES (${marks(GOAL_COLS.length)})`).bind(...GOAL_COLS.map((k) => s[k] ?? null)).run(); // 12 binds
  await audit(c.env, 'you', 'goal.create', row.id);
  return c.json({ goal: row }, 201);
});

goals.patch('/:id', async (c) => {
  const stored = await c.env.DB.prepare('SELECT * FROM goals WHERE id = ?1 AND deleted_at IS NULL').bind(c.req.param('id')).first<Goal>();
  if (!stored) return c.json({ error: 'Not found' }, 404);
  const body = await readBody(c), next = await open(c.env, 'goals', { ...stored });
  if ('title' in body) {
    const v = text(body.title, MAX_TITLE, 'title');
    if (isFail(v)) return c.json(v, 400);
    if (!v) return c.json(fail('bad_goal', 'a goal needs a title'), 400);
    next.title = v;
  }
  if ('description' in body) {
    const v = text(body.description, 2000, 'description');
    if (isFail(v)) return c.json(v, 400);
    next.description = v;
  }
  for (const k of ['starts_on', 'ends_on'] as const) if (k in body) {
    if (!isYmd(body[k])) return c.json(fail('bad_goal', `${k} is a date`), 400);
    next[k] = body[k] as string;
  }
  if (next.starts_on > next.ends_on) return c.json(fail('bad_goal', 'the start comes before the end'), 400);
  if ('status' in body) {
    if (!STATUSES.includes(body.status as GoalStatus)) return c.json(fail('bad_goal', 'status is active, achieved, missed or dropped'), 400);
    next.status = body.status as GoalStatus;
  }
  if ('sort' in body) {
    if (!isNum(body.sort)) return c.json(fail('bad_goal', 'sort is a number'), 400);
    next.sort = body.sort;
  }
  next.updated_at = now();
  const s = await seal(c.env, 'goals', { ...next, enc_v: 0 }); // G6: kind is never in the body
  next.enc_v = s.enc_v;
  const fields = (['title', 'description', 'starts_on', 'ends_on', 'status', 'sort'] as const).filter((k) => k in body);
  if (!await casUpdate(c.env, 'goals', stored, s as unknown as Record<string, unknown>, fields, body.updated_at)) return c.json(conflict, 409);
  await audit(c.env, 'you', 'goal.edit', stored.id, fields);
  return c.json({ goal: next });
});

goals.delete('/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE goals SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'goal.trash', c.req.param('id'));
  return c.json({ ok: true });
});

goals.post('/:id/krs', async (c) => {
  const goal = await c.env.DB.prepare('SELECT id, kind FROM goals WHERE id = ?1 AND deleted_at IS NULL').bind(c.req.param('id')).first<{ id: string; kind: Kind }>();
  if (!goal) return c.json({ error: 'Not found' }, 404);
  const body = await readBody(c);
  const title = text(body.title, MAX_TITLE, 'title');
  if (isFail(title)) return c.json({ ...title, error: 'bad_kr' }, 400);
  if (!title) return c.json(fail('bad_kr', 'a key result needs a title'), 400);
  if (!KR_TYPES.includes(body.type as KrType)) return c.json(fail('bad_kr', 'type is number, tasks, done or percent'), 400);
  const values = krValues(body.type as KrType, body);
  if (isFail(values)) return c.json(values, 400);
  const t = now();
  const row: KeyResult = {
    id: crypto.randomUUID(), goal_id: goal.id, title, type: body.type as KrType, ...values,
    sort: isNum(body.sort) ? body.sort : 0, enc_v: 0, created_at: t, updated_at: t, deleted_at: null,
  };
  const s = await seal(c.env, 'key_results', { ...row }, goal.kind) as unknown as Record<string, unknown>;
  row.enc_v = s.enc_v as number;
  // G5: the cap in the INSERT itself (13 columns, the goal id, the cap: 15 binds).
  const r = await c.env.DB.prepare(`INSERT INTO key_results (${KR_COLS.join(', ')}) SELECT ${marks(KR_COLS.length)}
    WHERE (SELECT COUNT(*) FROM key_results WHERE goal_id = ?14 AND deleted_at IS NULL) < ?15`).bind(...KR_COLS.map((k) => s[k] ?? null), goal.id, MAX_KRS).run();
  if (!r.meta.changes) return c.json(fail('kr_limit', `A goal keeps ${MAX_KRS} key results at most`), 409);
  await audit(c.env, 'you', 'goal.kr.create', row.id);
  return c.json({ kr: row }, 201);
});

goals.patch('/krs/:id', async (c) => {
  const found = await liveKr(c.env, c.req.param('id'));
  if (!found) return c.json({ error: 'Not found' }, 404);
  const { goal_kind, ...stored } = found;
  const body = await readBody(c), next = await open(c.env, 'key_results', { ...stored });
  if ('title' in body) {
    const v = text(body.title, MAX_TITLE, 'title');
    if (isFail(v)) return c.json({ ...v, error: 'bad_kr' }, 400);
    if (!v) return c.json(fail('bad_kr', 'a key result needs a title'), 400);
    next.title = v;
  }
  // Start, target and unit belong to a number key result; the current value moves only through a check-in (G4).
  const numberOnly = (['start_value', 'target_value', 'unit'] as const).filter((k) => k in body);
  if (numberOnly.length && next.type !== 'number') return c.json(fail('bad_kr', 'only a number key result has a start, a target and a unit'), 400);
  for (const k of ['start_value', 'target_value'] as const) if (k in body) {
    if (!isNum(body[k])) return c.json(fail('bad_kr', `${k} is a number`), 400);
    next[k] = body[k] as number;
  }
  if (next.type === 'number' && next.start_value === next.target_value) return c.json(fail('bad_kr', 'the start and the target must differ'), 400);
  if ('unit' in body) {
    const v = text(body.unit, 20, 'unit');
    if (isFail(v)) return c.json({ ...v, error: 'bad_kr' }, 400);
    next.unit = v;
  }
  if ('sort' in body) {
    if (!isNum(body.sort)) return c.json(fail('bad_kr', 'sort is a number'), 400);
    next.sort = body.sort;
  }
  next.updated_at = now();
  const s = await seal(c.env, 'key_results', { ...next, enc_v: 0 }, goal_kind);
  next.enc_v = s.enc_v;
  const fields = (['title', 'start_value', 'target_value', 'unit', 'sort'] as const).filter((k) => k in body);
  if (!await casUpdate(c.env, 'key_results', stored, s as unknown as Record<string, unknown>, fields, body.updated_at)) return c.json(conflict, 409);
  await audit(c.env, 'you', 'goal.kr.edit', stored.id, fields);
  return c.json({ kr: next });
});

goals.delete('/krs/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE key_results SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'goal.kr.trash', c.req.param('id'));
  return c.json({ ok: true });
});

goals.post('/krs/:id/links', async (c) => {
  const kr = await liveKr(c.env, c.req.param('id'));
  if (!kr) return c.json({ error: 'Not found' }, 404);
  const body = await readBody(c);
  const hasTask = body.task_id != null, hasProject = body.project_id != null;
  if (hasTask === hasProject || !id40(hasTask ? body.task_id : body.project_id)) return c.json(fail('bad_link', 'task_id or project_id, not both'), 400);
  const target = await c.env.DB.prepare(`SELECT kind FROM ${hasTask ? 'tasks' : 'projects'} WHERE id = ?1 AND deleted_at IS NULL`).bind(hasTask ? body.task_id : body.project_id).first<{ kind: Kind }>();
  if (!target) return c.json({ error: 'Not found' }, 404);
  if (target.kind !== kr.goal_kind) return c.json(fail('goal_kind', `A ${kr.goal_kind} goal links ${kr.goal_kind} tasks and projects only`), 409); // G6
  const t = now();
  const row: GoalLink = { id: crypto.randomUUID(), kr_id: kr.id, task_id: hasTask ? body.task_id as string : null, project_id: hasProject ? body.project_id as string : null, created_at: t, updated_at: t, deleted_at: null };
  let r;
  try {
    // G5: 7 columns, the key result, the cap: 9 binds.
    r = await c.env.DB.prepare(`INSERT INTO goal_links (${LINK_COLS.join(', ')}) SELECT ${marks(LINK_COLS.length)}
      WHERE (SELECT COUNT(*) FROM goal_links WHERE kr_id = ?8 AND deleted_at IS NULL) < ?9`).bind(...LINK_COLS.map((k) => row[k]), kr.id, MAX_LINKS).run();
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error).message))) return c.json(fail('link_exists', 'That is already linked to this key result'), 409);
    throw e;
  }
  if (!r.meta.changes) return c.json(fail('link_limit', `A key result keeps ${MAX_LINKS} links at most`), 409);
  await audit(c.env, 'you', 'goal.link', row.id);
  return c.json({ link: row }, 201);
});

goals.delete('/links/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE goal_links SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'goal.unlink', c.req.param('id'));
  return c.json({ ok: true });
});

// G4: a check-in on a number, percent or done key result also moves its current value, in the same batch.
goals.post('/krs/:id/checkins', async (c) => {
  const found = await liveKr(c.env, c.req.param('id'));
  if (!found) return c.json({ error: 'Not found' }, 404);
  const { goal_kind, ...kr } = found;
  const body = await readBody(c);
  if (!CONFIDENCE.includes(body.confidence as Confidence)) return c.json(fail('bad_checkin', 'confidence is on_track, at_risk or off_track'), 400);
  const note = text(body.note, MAX_NOTE, 'note');
  if (isFail(note)) return c.json({ ...note, error: 'bad_checkin' }, 400);
  let value: number | null = null;
  if (kr.type === 'tasks') {
    if (body.value != null) return c.json(fail('bad_checkin', 'a tasks key result counts its tasks; no value'), 400);
  } else {
    if (!isNum(body.value)) return c.json(fail('bad_checkin', 'a check-in needs a value'), 400);
    if (kr.type === 'percent' && (body.value < 0 || body.value > 100)) return c.json(fail('bad_checkin', 'a percent is 0 to 100'), 400);
    if (kr.type === 'done' && body.value !== 0 && body.value !== 1) return c.json(fail('bad_checkin', 'done is 0 or 1'), 400);
    value = body.value;
  }
  const nowMs = Date.now(), t = new Date(nowMs).toISOString();
  const row: GoalCheckin = {
    id: crypto.randomUUID(), kr_id: kr.id, value, confidence: body.confidence as Confidence, note,
    at: typeof body.at === 'string' ? clampTs(body.at, nowMs) : t, enc_v: 0, created_at: t, updated_at: t, deleted_at: null,
  };
  const s = await seal(c.env, 'goal_checkins', { ...row }, goal_kind) as unknown as Record<string, unknown>;
  row.enc_v = s.enc_v as number;
  const insert = c.env.DB.prepare(`INSERT INTO goal_checkins (${CHECKIN_COLS.join(', ')}) VALUES (${marks(CHECKIN_COLS.length)})`).bind(...CHECKIN_COLS.map((k) => s[k] ?? null)); // 10 binds
  if (value === null) await insert.run();
  else await c.env.DB.batch([insert, c.env.DB.prepare('UPDATE key_results SET current_value = ?2, updated_at = ?3 WHERE id = ?1').bind(kr.id, value, t)]);
  await audit(c.env, 'you', 'goal.checkin', row.id); // never the note
  const next = await open(c.env, 'key_results', { ...kr, current_value: value ?? kr.current_value, updated_at: value === null ? kr.updated_at : t });
  return c.json({ checkin: row, kr: next }, 201);
});

goals.delete('/checkins/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE goal_checkins SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'goal.checkin.trash', c.req.param('id'));
  return c.json({ ok: true });
});

export default goals;
