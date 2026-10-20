// Phase 6 knowledge search (KN4, KN5): embeddings (Workers AI bge-m3, or hash vectors locally), the vector store (Vectorize, or an
// in-memory stand-in locally), the embedder, the stale-vector sweep and the hybrid search. Locked passages never come near any of it:
// every pick and search goes through LIVE / vectorWanted (worker/lib/knowledge.ts).
import type { Env } from '../types.ts';
import { AiRefused, isStub, meter } from './ai.ts';
import { open, seal } from './enc.ts';
import { now } from './db.ts';
import { buildIndex, search, tokens } from '../../shared/search.ts';
import { HOME, HOME_COLS, LIVE, vectorWanted, type PassageHome } from './knowledge.ts';

const DIMS = 1024, MODEL = '@cf/baai/bge-m3', BATCH = 50, TOP = 40;
const ph = (n: number) => Array.from({ length: n }, (_, i) => `?${i + 1}`).join(',');
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

/** The local and stub embedding: each folded word hashed (FNV-1a) into one of 1,024 signed buckets, normalized. Deterministic, and texts sharing words land close. */
export function hashVector(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0), words = tokens(text);
  for (const w of words.length ? words : [text]) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[(h >>> 0) % DIMS] += (h >>> 11) & 1 ? 1 : -1;
  }
  const n = Math.sqrt(dot(v, v));
  if (!n) { v[0] = 1; return v; }
  return v.map((x) => x / n);
}

/** Embeddings for texts: Workers AI bge-m3, or hash vectors without the AI binding or under the local stub (KN1). Not metered: callers go through `embedMetered`. */
export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  if (isStub(env) || (!env.AI && !index(env))) return texts.map(hashVector); // never hash vectors into a real index
  if (!env.AI) throw new AiRefused('provider_error', 'Workers AI is not set up.');
  try {
    const r = (await env.AI.run(MODEL, { text: texts })) as { data?: number[][]; response?: number[][] };
    const data = r?.data ?? r?.response;
    if (Array.isArray(data) && data.length === texts.length && data.every((x) => Array.isArray(x) && x.length)) return data;
  } catch { /* status only below: the error can echo the text */ }
  throw new AiRefused('provider_error', 'Workers AI could not read the passages.');
}

type KnowledgePrices = { embed_per_1k_tokens: number };
const DEFAULT_PRICES: KnowledgePrices = { embed_per_1k_tokens: 0.000012 };
export function parseKnowledgePrices(raw?: string): KnowledgePrices {
  try {
    const n = JSON.parse(raw ?? '')?.embed_per_1k_tokens;
    return typeof n === 'number' && n > 0 && Number.isFinite(n) ? { embed_per_1k_tokens: n } : DEFAULT_PRICES;
  } catch { return DEFAULT_PRICES; }
}
// ponytail: Workers AI reports no token count for embeddings; 4 characters a token is the estimate (input_tokens holds it).
const tokensOf = (chars: number) => Math.ceil(chars / 4);
/** USD per 1,000 tokens × estimated tokens = micro-dollars (rounded up). */
export const embedCostMicro = (chars: number, p: KnowledgePrices) => Math.ceil(tokensOf(chars) * p.embed_per_1k_tokens * 1000 - 1e-9);

/**
 * One metered embedding call (feature knowledge_embed): the cap first, the usage row only once Workers AI answered. A query uses the 120/h
 * knowledge bucket; a background ingest batch skips it (KN14) and marks its row with the passage count in output_tokens (worker/lib/ai.ts).
 */
export async function embedMetered(env: Env, texts: string[], ingest: boolean): Promise<number[][]> {
  const chars = texts.reduce((n, t) => n + t.length, 0), cost_micro = embedCostMicro(chars, parseKnowledgePrices(env.KNOWLEDGE_PRICES));
  const record = await meter(env, 'knowledge_embed', cost_micro, { hourly: !ingest });
  const vectors = await embed(env, texts);
  await record({ provider: 'workers_ai', input_tokens: tokensOf(chars), output_tokens: ingest ? texts.length : 0, cost_micro });
  return vectors;
}

// KN10: the local stand-in for Vectorize, used without the binding or under the local stub (`wrangler dev --local` still defines VECTORIZE, as a
// proxy that throws). Local only: vectors live in this isolate's memory and are gone when the server restarts (the smoke embeds its own passages each run).
const local = new Map<string, { values: number[]; collection_id: string }>();
const index = (env: Env) => (isStub(env) ? undefined : env.VECTORIZE);

/** Stores vectors with the collection id as their only metadata (no text). */
export async function upsert(env: Env, rows: { id: string; values: number[]; collection_id: string }[]): Promise<void> {
  if (!rows.length) return;
  const vz = index(env);
  if (vz) await vz.upsert(rows.map((r) => ({ id: r.id, values: r.values, metadata: { collection_id: r.collection_id } })));
  else for (const r of rows) local.set(r.id, { values: r.values, collection_id: r.collection_id });
}

/** Deletes vectors by passage id (ids with no vector are fine), 1,000 at a time. */
export async function remove(env: Env, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 1000) {
    const part = ids.slice(i, i + 1000);
    const vz = index(env);
    if (vz) await vz.deleteByIds(part);
    else for (const id of part) local.delete(id);
  }
}

/**
 * The topK nearest passages within these collections (null = no filter: callers re-check every match in D1), best first.
 * ponytail: Vectorize filters are about 2 KB of JSON (~50 ids in $in); hybridSearch sends null when every live collection is allowed.
 */
export async function query(env: Env, vector: number[], collectionIds: string[] | null, topK: number): Promise<{ id: string; score: number }[]> {
  if (collectionIds && !collectionIds.length) return [];
  const vz = index(env);
  if (vz) {
    const r = await vz.query(vector, { topK, returnMetadata: 'none', ...(collectionIds ? { filter: { collection_id: { $in: collectionIds } } } : {}) });
    return r.matches.map((m) => ({ id: m.id, score: m.score }));
  }
  const allowed = collectionIds && new Set(collectionIds);
  return [...local].filter(([, v]) => !allowed || allowed.has(v.collection_id)).map(([id, v]) => ({ id, score: dot(vector, v.values) }))
    .sort((a, b) => b.score - a.score).slice(0, topK);
}

/** KN4 rerank (pure): the vector score plus up to 0.5 for keywords (BM25 over the passages, the item title counting as a title), best first. */
export function rerank<P extends { id: string; text: string; item_title: string }>(q: string, passages: P[], vectorScores: Record<string, number>): (P & { score: number })[] {
  const kw = new Map(search(buildIndex(passages.map((p) => ({ id: p.id, title: p.item_title, body: p.text }))), q, passages.length).map((r) => [r.doc.id, r.score]));
  const top = Math.max(0, ...kw.values());
  return passages.map((p) => ({ ...p, score: (vectorScores[p.id] ?? 0) + (top ? (0.5 * (kw.get(p.id) ?? 0)) / top : 0) })).sort((a, b) => b.score - a.score);
}

export interface FoundPassage { id: string; item_id: string; document_id: string | null; text: string; locator: string; item_title: string; collection: { id: string; name: string; scope: 'work' | 'personal' }; score: number }

/**
 * KN4: the one meaning-and-keyword search over Cloud AI and personal collections. `collectionIds` narrows it (null = every live Cloud AI collection);
 * Locked and trashed collections are always left out. One metered query embedding; the passages come back opened (work text too: callers decide where it may go).
 */
export async function hybridSearch(env: Env, q: string, collectionIds: string[] | null, k: number): Promise<FoundPassage[]> {
  const live = (await env.DB.prepare("SELECT id FROM knowledge_collections WHERE deleted_at IS NULL AND boundary = 'cloud'").all<{ id: string }>()).results.map((r) => r.id);
  const allowed = collectionIds ? live.filter((id) => collectionIds.includes(id)) : live;
  if (!allowed.length || !q.trim()) return [];
  const [vector] = await embedMetered(env, [q], false);
  const matches = await query(env, vector, allowed.length === live.length ? null : allowed, TOP); // D1 below keeps only `allowed`
  if (!matches.length) return [];
  const { results } = await env.DB.prepare(`SELECT c.id, c.text, c.locator, c.enc_v, c.collection_id, c.item_id, i.document_id, i.title AS item_title, i.enc_v AS item_enc_v,
      k.name AS collection_name, k.enc_v AS collection_enc_v, k.scope FROM ${HOME} WHERE c.id IN (${ph(matches.length)}) AND c.embedded = 1 AND ${LIVE}`)
    .bind(...matches.map((m) => m.id)).all<{ id: string; text: string; locator: string; enc_v: number; collection_id: string; item_id: string; document_id: string | null; item_title: string; item_enc_v: number; collection_name: string; collection_enc_v: number; scope: 'work' | 'personal' }>();
  const passages = await Promise.all(results.filter((r) => allowed.includes(r.collection_id)).map(async (r) => {
    const c = await open(env, 'knowledge_chunks', { text: r.text, locator: r.locator, enc_v: r.enc_v });
    const i = await open(env, 'knowledge_items', { title: r.item_title, enc_v: r.item_enc_v });
    const kc = await open(env, 'knowledge_collections', { name: r.collection_name, enc_v: r.collection_enc_v });
    return { id: r.id, item_id: r.item_id, document_id: r.document_id, text: c.text, locator: c.locator, item_title: i.title, collection: { id: r.collection_id, name: kc.name, scope: r.scope } };
  }));
  return rerank(q, passages, Object.fromEntries(matches.map((m) => [m.id, m.score]))).slice(0, k);
}

/**
 * KN5: embeds up to `limit` waiting passages (embedded = 0) that may hold a vector (LIVE), 50 a batch with one meter call per batch; `only` narrows it
 * to one item or collection (an ingest or a boundary change, so two runs don't embed the same rows). Stops quietly at the cap or the hourly limit; the
 * cron finishes the rest. Then items whose passages are all embedded are `ready`. Returns how many passages were embedded.
 */
export async function embedPending(env: Env, limit: number, only: { item?: string; collection?: string } = {}): Promise<number> {
  let done = 0;
  while (done < limit) {
    const { results } = await env.DB.prepare(`SELECT c.id, c.text, c.enc_v, c.collection_id FROM ${HOME} WHERE c.embedded = 0 AND ${LIVE}
      AND (?2 IS NULL OR c.item_id = ?2) AND (?3 IS NULL OR c.collection_id = ?3) ORDER BY c.created_at, c.ord LIMIT ?1`)
      .bind(Math.min(BATCH, limit - done), only.item ?? null, only.collection ?? null).all<{ id: string; text: string; enc_v: number; collection_id: string }>();
    if (!results.length) break;
    const texts = await Promise.all(results.map(async (r) => (await open(env, 'knowledge_chunks', { text: r.text, enc_v: r.enc_v })).text));
    let vectors: number[][];
    try { vectors = await embedMetered(env, texts, true); } catch (e) {
      if (!(e instanceof AiRefused)) throw e;
      console.warn(`[knowledge] embedding paused: ${e.code}`); // ponytail: a passage Workers AI always refuses blocks the queue head; mark its item failed if that shows up
      break;
    }
    const ids = results.map((r) => r.id);
    await upsert(env, results.map((r, i) => ({ id: r.id, values: vectors[i], collection_id: r.collection_id })));
    // Marked only where the passage may still hold a vector: a boundary change or a Trash since the pick un-embeds it, so its vector goes again.
    const kept = new Set((await env.DB.prepare(`UPDATE knowledge_chunks SET embedded = 1 WHERE id IN (${ph(ids.length)}) AND id IN (SELECT c.id FROM ${HOME} WHERE ${LIVE}) RETURNING id`)
      .bind(...ids).all<{ id: string }>()).results.map((r) => r.id));
    const lost = ids.filter((id) => !kept.has(id));
    if (lost.length) await remove(env, lost);
    done += ids.length;
  }
  await env.DB.prepare(`UPDATE knowledge_items SET state = 'ready', updated_at = ?1 WHERE state = 'indexing' AND deleted_at IS NULL
    AND collection_id IN (SELECT id FROM knowledge_collections WHERE boundary = 'cloud') AND NOT EXISTS (SELECT 1 FROM knowledge_chunks c WHERE c.item_id = knowledge_items.id AND c.embedded = 0)`).bind(now()).run();
  return done;
}

/**
 * Removes the vectors of passages that may no longer hold one (vectorWanted): a project gone Offline-only or to Trash, a collection made Locked,
 * an item, document or collection in Trash; they go back to embedded = 0 (and are embedded again if that changes back). Called where those
 * changes happen and by the 15-minute cron as a safety sweep. Returns how many were removed.
 */
export async function unembedStale(env: Env): Promise<number> {
  await sealTurnedWork(env);
  // ponytail: scans every embedded passage; fine at one user, add an embedded = 1 index or a per-project filter if it grows.
  const { results } = await env.DB.prepare(`SELECT c.id, ${HOME_COLS} FROM ${HOME} WHERE c.embedded = 1`).all<PassageHome & { id: string }>();
  const stale = results.filter((r) => !vectorWanted(r)).map((r) => r.id);
  await remove(env, stale);
  for (let i = 0; i < stale.length; i += 90) {
    const part = stale.slice(i, i + 90);
    await env.DB.prepare(`UPDATE knowledge_chunks SET embedded = 0 WHERE id IN (${ph(part.length)})`).bind(...part).run();
  }
  return stale.length;
}

/**
 * Rule 5: an email saved to a personal collection that later turned work (kept into a work task) is already out of search (LIVE); here its title
 * and passages are sealed in place with the work key (per row, enc_v = 2), so work content never sits plain. Run first by every sweep. Idempotent;
 * returns how many items it sealed.
 */
export async function sealTurnedWork(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT i.id, i.title, i.enc_v FROM knowledge_items i JOIN knowledge_collections k ON k.id = i.collection_id
    JOIN inbox_items ib ON i.source = 'email' AND ib.id = i.source_id
    WHERE k.scope = 'personal' AND ib.work = 1 AND (i.enc_v = 0 OR EXISTS (SELECT 1 FROM knowledge_chunks c WHERE c.item_id = i.id AND c.enc_v = 0))`).all<{ id: string; title: string; enc_v: number }>();
  // ponytail: one UPDATE per passage; an email is a handful of passages, batch it if this ever covers big items.
  for (const it of results) {
    if (!it.enc_v) {
      const s = await seal(env, 'knowledge_items', { title: it.title, enc_v: 0 }, 'work');
      await env.DB.prepare('UPDATE knowledge_items SET title = ?2, enc_v = ?3 WHERE id = ?1 AND enc_v = 0').bind(it.id, s.title, s.enc_v).run();
    }
    const cs = (await env.DB.prepare('SELECT id, text, locator FROM knowledge_chunks WHERE item_id = ?1 AND enc_v = 0').bind(it.id).all<{ id: string; text: string; locator: string }>()).results;
    for (const c of cs) {
      const s = await seal(env, 'knowledge_chunks', { text: c.text, locator: c.locator, enc_v: 0 }, 'work');
      await env.DB.prepare('UPDATE knowledge_chunks SET text = ?2, locator = ?3, enc_v = ?4 WHERE id = ?1 AND enc_v = 0').bind(c.id, s.text, s.locator, s.enc_v).run();
    }
  }
  return results.length;
}
