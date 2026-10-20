// Locked search on the device: built once per collection, dropped after 10 minutes hidden and on sign-out, never persisted.
import assert from 'node:assert/strict';
import { createLockedSearch, HIDDEN_LIMIT_MS, type LockedPassage } from '../web/src/knowledge-search.ts';

const P = (id: string, title: string, text: string): LockedPassage => ({ id, item_id: `i-${id}`, document_id: `d-${id}`, ord: 0, locator: 'part 1', text, item_title: title });
const data: Record<string, LockedPassage[]> = {
  a: [P('1', 'Vendor contract', 'The vendor agrees to a termination notice of ninety days.'), P('2', 'Budget', 'Travel costs stay under the approved ceiling.')],
  b: [P('3', 'Risk log', 'Termination of the supplier would stop delivery.')],
};
let fetches: string[] = [];
const timers = { fns: [] as { f: () => void; ms: number; id: number }[], n: 0, set(f: () => void, ms: number) { const id = ++this.n; this.fns.push({ f, ms, id }); return id; }, clear(id: unknown) { this.fns = this.fns.filter((x) => x.id !== id); } };
const mk = () => createLockedSearch(async (id) => { fetches.push(id); if (id === 'bad') throw new Error('boom'); return data[id]; }, timers as never);

const s = mk();
let r = await s.search(['a', 'b'], 'termination notice');
assert.equal(r.failed.length, 0);
assert.equal(r.hits[0].item_title, 'Vendor contract');          // best match first, across collections
assert.equal(r.hits[0].collection_id, 'a');
assert.ok(r.hits.some((h) => h.collection_id === 'b'));
assert.ok(r.hits[0].snippet.toLowerCase().includes('termination'));
assert.equal(r.hits[0].document_id, 'd-1');
await s.search(['a'], 'budget'); await s.search(['a', 'b'], 'travel');
assert.deepEqual(fetches.sort(), ['a', 'b']);                    // fetched once per collection per session
await Promise.all([mk().search(['a'], 'x'), mk().search(['a'], 'y')]);

r = await s.search(['a', 'bad'], 'budget');
assert.deepEqual(r.failed, ['bad']);                              // one failure doesn't hide the other collection
assert.equal(r.hits.length, 1);

// Hidden 10 minutes: dropped; hidden less: kept; sign-out drops too.
const t0 = 1_000_000;
s.hidden(t0); s.visible(t0 + HIDDEN_LIMIT_MS - 1000);
assert.deepEqual(s.loaded().sort(), ['a', 'b']);
s.hidden(t0); s.visible(t0 + HIDDEN_LIMIT_MS);
assert.deepEqual(s.loaded(), []);
fetches = []; await s.search(['a'], 'budget'); assert.deepEqual(fetches, ['a']); // loaded again after the drop
s.hidden(t0); assert.equal(timers.fns.at(-1)!.ms, HIDDEN_LIMIT_MS); timers.fns.at(-1)!.f(); // the timer drops it while hidden
assert.deepEqual(s.loaded(), []);
await s.search(['b'], 'supplier'); s.drop(); assert.deepEqual(s.loaded(), []);

// A drop while a load is in flight: the answer is used once, not kept.
let release!: () => void;
const slow = createLockedSearch(() => new Promise((res) => { release = () => res(data.a); }), timers as never);
const pending = slow.search(['a'], 'budget'); slow.drop(); release();
assert.equal((await pending).hits.length, 1); assert.deepEqual(slow.loaded(), []);

// Nothing here writes to a store.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../web/src/knowledge-search.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
assert.ok(!/indexedDB|idb\.|localStorage|sessionStorage|caches\./.test(src));
console.log('knowledge-search: ok');
