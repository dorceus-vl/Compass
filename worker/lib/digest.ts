// Phase 6 Task 4 (KN7): the automatic "From my apps" collection. Once a day Compass builds a Markdown digest of its own personal items and pulls
// Finance, Health, Home and Hollow from Kelly-Cloud's relay (GET /apps-digest; that side keeps medication names out). Each source is ONE item in
// the system collection: a refresh adds the new item, then deletes the old one with its passages and vectors (derived data, rebuilt every day).
// A source that fails keeps yesterday's item and shows its error in the item; a source that never worked has a "failed" item that says why.
import type { Env } from '../types.ts';
import type { KnowledgeCollection, KnowledgeSource, Settings } from '../../shared/types.ts';
import { audit, now, getSettings } from './db.ts';
import { addDays, localDate, weekStart } from './dates.ts';
import { localNow } from './schedule.ts';
import { chunk } from './chunk.ts';
import { embedPending, remove } from './vectors.ts';
import { relayFetch, relayOf } from '../routes/kelly.ts';
import { addItem } from '../routes/knowledge.ts';

export const RELAY_SOURCES = ['finance', 'health', 'home', 'hollow'] as const;
export const SOURCES = ['compass', ...RELAY_SOURCES] as const;
export type AppSource = (typeof SOURCES)[number];
export const APPS_NAME = 'From my apps';
const TITLE: Record<AppSource, string> = { compass: 'Compass', finance: 'Finance', health: 'Health', home: 'Home', hollow: 'Hollow' };
export const SECTION_MAX = 4000, DIGEST_MAX = 12_000, TASKS = 150, REFRESH_WINDOW_MS = 10 * 60_000, RELAY_MS = 15_000, RELAY_MAX_BYTES = 200_000;
const ACTION = 'knowledge.apps.refresh';

const one = (s: string | null | undefined, n = 200) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** No long digit runs (account numbers) or card-shaped numbers in anything kept from an app. Kelly-Cloud does the same; this is the second lock. */
export const scrub = (s: string) => s.replace(/\b\d{4}(?:[ -]\d{4}){3}\b/g, '[number removed]').replace(/\d{9,}/g, '[number removed]');
const list = (title: string, rows: string[]) => (rows.length ? `${title}\n${rows.map((r) => `- ${r}`).join('\n')}` : '');

type Row = Record<string, string | number | null>;
export const LIVE_PERSONAL = `p.id IS NOT NULL AND p.deleted_at IS NULL AND p.kind = 'personal' AND p.enc_v = 0 AND p.data_boundary = 'cloud'`;

/**
 * Compass's own part, personal items only, as Markdown: open personal tasks (overdue, due this week, the rest), live personal projects with a RAG
 * status, and the last 30 days of decisions and lessons of personal projects. Work rows (kind 'work', sealed) are never read; neither is anything
 * of an Offline-only or trashed project, personal ones included.
 */
export async function compassDigest(env: Env, at = new Date(), settings?: Pick<Settings, 'tz'>): Promise<string> {
  const tz = (settings ?? (await getSettings(env))).tz, today = localDate(tz, at), weekEnd = addDays(weekStart(today), 6);
  const since = addDays(today, -30);
  const [tasks, projects, decisions, lessons] = await env.DB.batch([
    env.DB.prepare(`SELECT t.title, t.status, t.due_at, t.waiting_on FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.deleted_at IS NULL AND t.kind = 'personal' AND t.enc_v = 0 AND t.status != 'done' AND (t.project_id IS NULL OR (${LIVE_PERSONAL}))
      ORDER BY t.due_at IS NULL, t.due_at, t.priority DESC, t.created_at LIMIT ${TASKS + 1}`),
    env.DB.prepare(`SELECT p.name, p.status, p.phase, p.rag, p.rag_reason, p.end_at FROM projects p
      WHERE ${LIVE_PERSONAL} AND p.status != 'closed' AND p.rag != 'none' ORDER BY p.sort, p.created_at LIMIT 30`),
    env.DB.prepare(`SELECT d.text, d.decided_at, p.name AS project FROM decisions d JOIN projects p ON p.id = d.project_id
      WHERE d.deleted_at IS NULL AND d.enc_v = 0 AND ${LIVE_PERSONAL} AND substr(d.decided_at, 1, 10) >= ?1 ORDER BY d.decided_at DESC LIMIT 30`).bind(since),
    env.DB.prepare(`SELECT l.text, l.created_at, p.name AS project FROM lessons l JOIN projects p ON p.id = l.project_id
      WHERE l.deleted_at IS NULL AND l.enc_v = 0 AND ${LIVE_PERSONAL} AND substr(l.created_at, 1, 10) >= ?1 ORDER BY l.created_at DESC LIMIT 30`).bind(since),
  ]);
  const more = tasks.results.length > TASKS;
  const t = (tasks.results as Row[]).slice(0, TASKS).map((r) => ({ due: r.due_at ? String(r.due_at).slice(0, 10) : '', line: `${one(r.title as string)}${r.status && r.status !== 'new' ? ` (${r.status}${r.waiting_on ? ` on ${one(r.waiting_on as string, 60)}` : ''})` : ''}` }));
  const withDue = (x: { due: string; line: string }) => (x.due ? `${x.line}; due ${x.due}` : x.line);
  const overdue = t.filter((x) => x.due && x.due < today), week = t.filter((x) => x.due >= today && x.due <= weekEnd), rest = t.filter((x) => !x.due || x.due > weekEnd);
  const md = [
    `# Compass: my personal items (as of ${today})`,
    list('## Overdue tasks', overdue.map(withDue)), list('## Tasks due this week', week.map(withDue)), list('## Other open tasks', [...rest.map(withDue), ...(more ? ['(more tasks are not shown)'] : [])]),
    list('## Projects', (projects.results as Row[]).map((r) => `${one(r.name as string, 80)}: ${r.rag}${r.rag_reason ? ` (${one(r.rag_reason as string, 120)})` : ''}; ${r.status}${r.phase ? `, ${one(r.phase as string, 40)}` : ''}${r.end_at ? `; ends ${String(r.end_at).slice(0, 10)}` : ''}`)),
    list('## Decisions in the last 30 days', (decisions.results as Row[]).map((r) => `${String(r.decided_at).slice(0, 10)} ${one(r.project as string, 60)}: ${one(r.text as string, 300)}`)),
    list('## Lessons from the last 30 days', (lessons.results as Row[]).map((r) => `${String(r.created_at).slice(0, 10)} ${one(r.project as string, 60)}: ${one(r.text as string, 300)}`)),
  ].filter(Boolean).join('\n\n');
  return capAt(md, DIGEST_MAX);
}

/** At most `max` characters, cut at a line break. */
function capAt(md: string, max: number): string {
  if (md.length <= max) return md;
  const head = md.slice(0, max - 40);
  return `${head.slice(0, Math.max(head.lastIndexOf('\n'), 0))}\n\n(The rest is not shown.)`;
}

/** The relay's answer as we keep it: for each app, text (cleaned, at most 4,000 characters) or null; anything but a string is null. */
export function cleanRelay(body: unknown): Record<(typeof RELAY_SOURCES)[number], string | null> {
  const s = (body as { sections?: Record<string, unknown> } | null)?.sections;
  return Object.fromEntries(RELAY_SOURCES.map((k) => {
    const v = s && typeof s === 'object' ? s[k] : null;
    // eslint-disable-next-line no-control-regex
    const text = typeof v === 'string' ? capAt(scrub(v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()), SECTION_MAX) : '';
    return [k, text || null];
  })) as Record<(typeof RELAY_SOURCES)[number], string | null>;
}

export const RETRY_MS = 3_600_000;
/**
 * Whether the cron owes a refresh: it is `digest_hour` or later in the user's zone and either nothing was tried yet on that zone's date, or the
 * last attempt of the day did not come out clean (a source failed, or it never finished) and was made at least an hour ago (one retry an hour at most).
 */
export function appsDue(s: Pick<Settings, 'tz' | 'digest_hour'>, last: { at: string; failed: boolean } | null, at: Date): boolean {
  const n = localNow(s.tz, at);
  if (n.hhmm < `${String(s.digest_hour).padStart(2, '0')}:00`) return false;
  if (!last || localDate(s.tz, new Date(last.at)) !== n.date) return true;
  return last.failed && at.getTime() - Date.parse(last.at) >= RETRY_MS;
}

/**
 * The newest attempt and whether it came out clean: its `knowledge.apps.done` row (written when it finishes) names the apps that failed (`retry`);
 * none = it never finished, so `retry` is null (all five again).
 */
export async function lastRun(env: Env): Promise<{ at: string; failed: boolean; retry: AppSource[] | null } | null> {
  const at = await lastAttempt(env);
  if (!at) return null;
  const done = await env.DB.prepare('SELECT detail FROM audit_log WHERE action = ?1 AND at >= ?2 ORDER BY at DESC LIMIT 1').bind('knowledge.apps.done', at).first<{ detail: string | null }>();
  try {
    if (!done) return { at, failed: true, retry: null };
    const retry = ((JSON.parse(done.detail ?? '{}').failed ?? []) as string[]).filter((a): a is AppSource => (SOURCES as readonly string[]).includes(a));
    return { at, failed: retry.length > 0, retry };
  } catch { return { at, failed: true, retry: null }; }
}

/** Which sources the cron refreshes now: on the same day as a finished attempt with failures, only those that failed (the others keep what worked); otherwise all (null). */
export function retryOnly(s: Pick<Settings, 'tz'>, last: { at: string; retry: AppSource[] | null } | null, at: Date): AppSource[] | null {
  return last?.retry?.length && localDate(s.tz, new Date(last.at)) === localDate(s.tz, at) ? last.retry : null;
}

/** The newest refresh attempt (cron or Refresh now), or null. */
export const lastAttempt = async (env: Env) => (await env.DB.prepare('SELECT MAX(at) AS at FROM audit_log WHERE action = ?1').bind(ACTION).first<{ at: string | null }>())?.at ?? null;

/** Takes the right to refresh in one statement (rows in `audit_log`, so the audit retention must stay far longer than 10 minutes) (so two callers cannot both): false when an attempt was made in the last 10 minutes. */
export async function claimRefresh(env: Env, actor: 'you' | 'cron', at = Date.now()): Promise<boolean> {
  const r = await env.DB.prepare(`INSERT INTO audit_log (id, at, actor, action, target, detail) SELECT ?1, ?2, ?3, ?4, NULL, NULL
    WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action = ?4 AND at > ?5)`)
    .bind(crypto.randomUUID(), new Date(at).toISOString(), actor, ACTION, new Date(at - REFRESH_WINDOW_MS).toISOString()).run();
  return r.meta.changes > 0;
}
/** Minutes until a refresh is allowed again, for the 429 message (at least 1). */
export const waitMinutes = (lastAt: string | null, at = Date.now()) => Math.max(1, Math.ceil(((lastAt ? Date.parse(lastAt) : at) + REFRESH_WINDOW_MS - at) / 60_000));

/** The one system collection, made on first use. */
export async function appsCollection(env: Env): Promise<KnowledgeCollection> {
  const get = () => env.DB.prepare('SELECT * FROM knowledge_collections WHERE system = 1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1').first<KnowledgeCollection>();
  let c = await get();
  if (!c) {
    const t = now();
    await env.DB.prepare(`INSERT INTO knowledge_collections (id, name, scope, boundary, system, created_at, updated_at, enc_v)
      SELECT ?1, ?2, 'personal', 'cloud', 1, ?3, ?3, 0 WHERE NOT EXISTS (SELECT 1 FROM knowledge_collections WHERE system = 1 AND deleted_at IS NULL)`).bind(crypto.randomUUID(), APPS_NAME, t).run();
    c = await get();
  }
  return c!;
}

/** Removes items with their passages: the rows in one atomic batch, then their vectors (a vector left behind is invisible to search, which re-checks D1, and is only logged). */
async function dropItems(env: Env, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const mark = ids.map((_, i) => `?${i + 1}`).join(',');
  const chunks = (await env.DB.prepare(`SELECT id FROM knowledge_chunks WHERE item_id IN (${mark})`).bind(...ids).all<{ id: string }>()).results.map((r) => r.id);
  await env.DB.batch([env.DB.prepare(`DELETE FROM knowledge_chunks WHERE item_id IN (${mark})`).bind(...ids), env.DB.prepare(`DELETE FROM knowledge_items WHERE id IN (${mark})`).bind(...ids)]);
  await remove(env, chunks).catch((e) => console.error(`[apps] vectors not removed: ${(e as Error).name}`));
}

/**
 * All or nothing: the new item must be stored with its passages (not failed) before any old item of that source goes; if the new one is empty, or
 * removing the old ones fails, the new one is taken back out and this throws, so yesterday's item stays (the caller shows the error on it).
 */
async function replaceItem(env: Env, coll: KnowledgeCollection, app: AppSource, text: string): Promise<void> {
  const source = `app:${app}` as KnowledgeSource;
  const item = await addItem(env, coll, { source, title: TITLE[app], document_id: null, passages: chunk(text, 'md') });
  try {
    if (item.state === 'failed' || item.chunk_count < 1) throw new Error('empty digest');
    const old = (await env.DB.prepare('SELECT id FROM knowledge_items WHERE collection_id = ?1 AND source = ?2 AND id != ?3').bind(coll.id, source, item.id).all<{ id: string }>()).results.map((r) => r.id);
    await dropItems(env, old);
  } catch (e) {
    await dropItems(env, [item.id]).catch(() => {}); // take the new one back out; the old stays
    throw e;
  }
}

/** A source that failed: yesterday's item stays with the reason on it; with no item yet, a failed one says why. */
async function failItem(env: Env, coll: KnowledgeCollection, app: AppSource, reason: string): Promise<void> {
  const source = `app:${app}` as KnowledgeSource;
  const r = await env.DB.prepare('UPDATE knowledge_items SET error = ?3 WHERE collection_id = ?1 AND source = ?2 AND deleted_at IS NULL').bind(coll.id, source, reason).run();
  if (!r.meta.changes) await addItem(env, coll, { source, title: TITLE[app], document_id: null, passages: [], error: reason });
}

/** The body as text, or null once it passes `max` bytes (checked on the header first, then as it streams, so a huge answer is never held whole). */
async function readCapped(r: Response, max: number): Promise<string | null> {
  if (Number(r.headers.get('content-length') ?? 0) > max) { await r.body?.cancel().catch(() => {}); return null; }
  const rd = r.body?.getReader();
  if (!rd) return '';
  const parts: Uint8Array[] = []; let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await rd.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(n); let o = 0;
  for (const x of parts) { all.set(x, o); o += x.byteLength; }
  return new TextDecoder().decode(all);
}
const parse = (t: string): unknown => { try { return JSON.parse(t); } catch { return null; } };

export interface RefreshResult { ok: AppSource[]; errors: Partial<Record<AppSource, string>> }

/**
 * Refreshes the five items. The caller has claimed the refresh (`claimRefresh`). Kelly-Cloud's four sections come through the shared relay helper
 * (its secret header, no redirects, 15 s); Compass's own part needs no relay. Embedding starts afterwards: `defer` hands it to the request's
 * waitUntil, otherwise (the cron) it is awaited. Never throws for a failing source; the result and an audit row carry the app names only.
 */
export async function refreshApps(env: Env, defer?: (p: Promise<unknown>) => void, actor: 'you' | 'cron' = 'you', only: AppSource[] | null = null): Promise<RefreshResult> {
  const coll = await appsCollection(env), texts: Partial<Record<AppSource, string>> = {}, errors: Partial<Record<AppSource, string>> = {};
  const want = (a: AppSource) => !only || only.includes(a); // a same-day retry touches only the sources that failed
  const g = relayOf(env);
  let relay: Record<(typeof RELAY_SOURCES)[number], string | null> | null = null, why = "Kelly-Cloud isn't connected.";
  if (g && RELAY_SOURCES.some(want)) {
    try {
      const r = await relayFetch(g, '/apps-digest', {}, RELAY_MS);
      if (r.ok) {
        const body = await readCapped(r, RELAY_MAX_BYTES);
        if (body === null) why = "Kelly-Cloud's answer was too large."; else relay = cleanRelay(parse(body));
      } else why = 'Kelly-Cloud answered with an error.';
    } catch { why = 'Kelly-Cloud could not be reached.'; }
  }
  for (const k of RELAY_SOURCES.filter(want)) { if (relay?.[k]) texts[k] = relay[k]!; else errors[k] = relay ? `${TITLE[k]} could not be read.` : why; }
  if (want('compass')) try { texts.compass = await compassDigest(env); } catch { errors.compass = 'Compass could not build its part.'; }
  for (const app of SOURCES.filter(want)) {
    try {
      if (texts[app]) await replaceItem(env, coll, app, texts[app]!); else await failItem(env, coll, app, errors[app]!);
    } catch (e) { console.error(`[apps] ${app} not stored: ${(e as Error).name}`); errors[app] = `${TITLE[app]} could not be stored.`; delete texts[app];
      await failItem(env, coll, app, errors[app]!).catch(() => {}); // yesterday's item stays, with the reason on it
    }
  }
  const embedding = embedPending(env, 500, { collection: coll.id }).catch((e) => console.error(`[apps] embed failed: ${(e as Error).name}`));
  if (defer) defer(embedding); else await embedding;
  const ok = SOURCES.filter((a) => want(a) && texts[a] && !errors[a]);
  await audit(env, actor, 'knowledge.apps.done', coll.id, { ok, failed: Object.keys(errors) });
  return { ok, errors };
}
