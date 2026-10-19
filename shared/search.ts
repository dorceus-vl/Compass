export interface SearchDoc { id: string; title: string; body: string; section?: string }
export interface SearchIndex<D extends SearchDoc = SearchDoc> { docs: D[]; post: Map<string, Map<number, number>>; len: number[]; avg: number }

const STOP = new Set(('a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who why will with ' +
  'au aux ce ces dans de des du elle en est et il la le les ne par pas pour que qui sa se ses son sur un une').split(' '));
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// ponytail: plural-s strip only (EN and FR); add a real stemmer if recall disappoints.
const stem = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
export const tokens = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);

export function buildIndex<D extends SearchDoc>(docs: D[]): SearchIndex<D> {
  const post = new Map<string, Map<number, number>>(), len: number[] = [];
  docs.forEach((d, i) => {
    const title = tokens(d.title);
    const all = [...title, ...title, ...title, ...tokens(d.section ?? ''), ...tokens(d.body)]; // title counts three times
    len.push(all.length);
    for (const t of all) { let m = post.get(t); if (!m) post.set(t, (m = new Map())); m.set(i, (m.get(i) ?? 0) + 1); }
  });
  return { docs, post, len, avg: len.reduce((a, b) => a + b, 0) / (len.length || 1) };
}

/** BM25 (k1 1.2, b 0.75). The last query word also matches as a prefix unless the query ends with a space. */
export function search<D extends SearchDoc>(ix: SearchIndex<D>, q: string, limit = 10): { doc: D; score: number }[] {
  const words = [...new Set(tokens(q))];
  if (!words.length) return [];
  const N = ix.docs.length, score = new Map<number, number>();
  words.forEach((w, k) => {
    const prefix = k === words.length - 1 && !/\s$/.test(q);
    const terms = prefix ? [...ix.post.keys()].filter((t) => t.startsWith(w)) : ix.post.has(w) ? [w] : [];
    for (const t of terms) {
      const m = ix.post.get(t)!, idf = Math.log(1 + (N - m.size + 0.5) / (m.size + 0.5));
      for (const [i, f] of m) score.set(i, (score.get(i) ?? 0) + idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * ix.len[i] / ix.avg)));
    }
  });
  return [...score].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([i, s]) => ({ doc: ix.docs[i], score: s }));
}

/** The sentence holding most query words, cut to max characters. */
export function snippet(body: string, q: string, max = 180): string {
  const want = new Set(tokens(q));
  const sentences = body.replace(/[#>*_`|]/g, ' ').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  let best = sentences[0] ?? '', most = -1;
  for (const s of sentences) { const n = tokens(s).filter((t) => want.has(t)).length; if (n > most) { best = s; most = n; } }
  return best.length > max ? best.slice(0, max - 1) + '…' : best;
}
