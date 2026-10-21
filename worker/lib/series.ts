// Meeting series (v2.1, rulings V6-V8, V13). A series is the recurring meetings that share a title once dates and numbers are stripped,
// in one project or all unfiled. `key` and `id` are HMACs of the title and scope under a key derived from COMPASS_DATA_KEY, so the title's words never sit in a plain
// column (V13); the name and the answered list are sealed with a work series (enc.ts).
import type { Env } from '../types.ts';
import type { MeetingReview, Decision } from '../../shared/types.ts';
import { seriesKey, seriesName, questionHash, HASH, type SeriesAction, type SeriesDecision, type SeriesQuestion } from '../../shared/series.ts';
import { seal, open, openAll } from './enc.ts';
import { now } from './db.ts';
import { asReview } from '../routes/inbox.ts';
import { projectKind } from '../routes/projects.ts';

const te = new TextEncoder();
const macKeys = new Map<string, Promise<CryptoKey>>(); // derived once per secret, like crypto-box's keys
const macKey = (secret: string) => {
  if (!macKeys.has(secret)) {
    macKeys.set(secret, crypto.subtle.importKey('raw', te.encode(secret), 'HKDF', false, ['deriveBits'])
      .then((base) => crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('compass-series'), info: te.encode('series-key/v1') }, base, 256))
      .then((bits) => crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])));
  }
  return macKeys.get(secret)!;
};
const mac = async (env: Env, text: string) =>
  Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', await macKey(env.COMPASS_DATA_KEY), te.encode(text))), (b) => b.toString(16).padStart(2, '0')).join('');

export type SeriesRow = { id: string; key: string; name: string; project_id: string | null; kind: 'personal' | 'work'; answered: string | null; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number };

/** The series' key (HMAC of the normalised title) and its id (HMAC of key and scope): one series per key and project-or-unfiled, so two writers can't make two. */
export async function seriesIds(env: Env, key: string, projectId: string | null): Promise<{ key: string; id: string }> {
  return { key, id: `s_${(await mac(env, `id|${key}|${projectId ?? 'unfiled'}`)).slice(0, 32)}` };
}
export const keyOfTitle = async (env: Env, title: string) => mac(env, `key|${seriesKey(title)}`);

/** An unfiled series is work (reviews are sealed as work); a project's follows the project. */
export async function scopeKind(env: Env, projectId: string | null): Promise<'personal' | 'work'> {
  return (await projectKind(env, projectId)) ?? 'work';
}

/** INSERT OR IGNORE of a series row: the id is deterministic, so an existing series is kept as it is. */
export async function insertSeriesStmt(env: Env, id: string, key: string, name: string, projectId: string | null, kind: 'personal' | 'work'): Promise<D1PreparedStatement> {
  const t = now();
  const s = await seal(env, 'meeting_series', { id, key, name: name.slice(0, 120), project_id: projectId, kind, answered: null as string | null, enc_v: 0 });
  return env.DB.prepare(`INSERT OR IGNORE INTO meeting_series (id, key, name, project_id, kind, answered, created_at, updated_at, enc_v) VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?8)`)
    .bind(s.id, s.key, s.name, s.project_id, s.kind, s.answered, t, s.enc_v);
}

/** The series a title belongs to in a scope: its id and the statement that makes it. */
export async function seriesForTitle(env: Env, title: string, projectId: string | null, kind?: 'personal' | 'work'): Promise<{ id: string; stmt: D1PreparedStatement }> {
  const { key, id } = await seriesIds(env, await keyOfTitle(env, title), projectId);
  return { id, stmt: await insertSeriesStmt(env, id, key, seriesName(title), projectId, kind ?? await scopeKind(env, projectId)) };
}

export async function loadSeries(env: Env, id: string): Promise<SeriesRow | null> {
  const row = await env.DB.prepare('SELECT * FROM meeting_series WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<SeriesRow>();
  return row ? open(env, 'meeting_series', row) : null;
}

/** Reviews that came before series (no series_id) join theirs when the list is read. 200 a call; the list asks again until none are left. */
export async function backfillSeries(env: Env): Promise<void> {
  const { results } = await env.DB.prepare('SELECT id, title, project_id, enc_v FROM meeting_reviews WHERE series_id IS NULL LIMIT 200').all<{ id: string; title: string; project_id: string | null; enc_v: number }>();
  if (!results.length) return;
  const kinds = new Map<string | null, 'personal' | 'work'>();
  const writes: D1PreparedStatement[] = [];
  for (const r of await openAll(env, 'meeting_reviews', results)) {
    if (!kinds.has(r.project_id)) kinds.set(r.project_id, await scopeKind(env, r.project_id));
    const { id, stmt } = await seriesForTitle(env, r.title, r.project_id, kinds.get(r.project_id));
    writes.push(stmt, env.DB.prepare('UPDATE meeting_reviews SET series_id = ?2 WHERE id = ?1 AND series_id IS NULL').bind(r.id, id));
  }
  await env.DB.batch(writes);
  if (results.length === 200) await backfillSeries(env);
}

type TaskLite = { id: string; source_ref: string | null; source_url: string | null; project_id: string | null; status: string };
/** V7: the review a meeting task came from. New tasks carry `meeting:<review id>:<n>`; older ones match by project and the review's url (the longest url wins). */
export function reviewOfTask(t: TaskLite, reviews: { id: string; url: string | null; project_id: string | null }[]): string | null {
  const m = /^meeting:([^:]+):\d+$/.exec(t.source_ref ?? '');
  if (m) return reviews.some((r) => r.id === m[1]) ? m[1] : null;
  if (!t.source_url) return null;
  let best: { id: string; n: number } | null = null;
  for (const r of reviews) if (r.url && r.project_id === t.project_id && t.source_url.startsWith(r.url) && (!best || r.url.length > best.n)) best = { id: r.id, n: r.url.length };
  return best?.id ?? null;
}

export const meetingTasks = async (env: Env) =>
  (await env.DB.prepare(`SELECT id, source_ref, source_url, project_id, status FROM tasks WHERE source_kind = 'meeting' AND deleted_at IS NULL`).all<TaskLite>()).results;

/** Everything a series page and the agenda read: reviews (opened), decisions, actions and questions with their answered flags. */
export async function seriesDetail(env: Env, series: SeriesRow) {
  const { results } = await env.DB.prepare('SELECT * FROM meeting_reviews WHERE series_id = ?1 ORDER BY received_at DESC LIMIT 200').bind(series.id).all<Record<string, unknown> & { enc_v?: number }>();
  const reviews: MeetingReview[] = (await openAll(env, 'meeting_reviews', results)).map((r) => asReview(r));
  const ids = reviews.map((r) => r.id);
  const inList = ids.map((_, i) => `?${i + 1}`).join(',');
  const decRows = ids.length ? (await env.DB.prepare(`SELECT * FROM decisions WHERE from_meeting_id IN (${inList}) AND deleted_at IS NULL ORDER BY decided_at DESC, created_at DESC`).bind(...ids).all<Decision>()).results : [];
  const decisions: SeriesDecision[] = (await openAll(env, 'decisions', decRows)).map((d) => ({ id: d.id, text: d.text, decided_at: d.decided_at, at_ref: d.at_ref, from_meeting_id: d.from_meeting_id }));

  const mine = (await meetingTasks(env)).filter((t) => reviewOfTask(t, reviews));
  const full = mine.length ? (await env.DB.prepare(`SELECT * FROM tasks WHERE id IN (${mine.map((_, i) => `?${i + 1}`).join(',')})`).bind(...mine.map((t) => t.id)).all<Record<string, unknown> & { enc_v?: number }>()).results : [];
  const actions: SeriesAction[] = (await openAll(env, 'tasks', full)).map((t) => {
    const lite = mine.find((x) => x.id === t.id)!;
    const owner = (t.waiting_on as string | null) ?? /^Owner: (.+)$/m.exec((t.notes as string | null) ?? '')?.[1] ?? null;
    return { id: t.id as string, title: t.title as string, owner, due_at: (t.due_at as string | null) ?? null, status: t.status as string, review_id: reviewOfTask(lite, reviews)! };
  }).sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.due_at ?? '9').localeCompare(b.due_at ?? '9'));

  const answered = new Set<string>(parseAnswered(series.answered));
  const seen = new Set<string>(), questions: SeriesQuestion[] = [];
  for (const r of reviews) for (const q of r.open_questions) { // newest first, so the newest wording of a repeated question stays
    const text = String(q?.text ?? '').trim();
    if (!text) continue;
    const hash = await questionHash(text);
    if (seen.has(hash)) continue;
    seen.add(hash);
    questions.push({ hash, text, at: typeof q.at === 'string' ? q.at : null, review_id: r.id, answered: answered.has(hash) });
  }
  return { reviews, decisions, actions, questions };
}

export const parseAnswered = (v: string | null): string[] => {
  try { const a = JSON.parse(v ?? '[]'); return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && HASH.test(x)) : []; } catch { return []; }
};
export const MAX_ANSWERED = 500;
