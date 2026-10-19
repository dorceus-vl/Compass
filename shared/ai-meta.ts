import type { Proposals, Horizon, RaidType } from './types.ts';

const BLOCK = /\n?```compass-meta[ \t]*\n([\s\S]*?)\n?```\s*$/;
const HORIZONS: Horizon[] = ['short', 'medium', 'long'];
const RAID: RaidType[] = ['risk', 'assumption', 'issue', 'dependency'];
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const level = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5 ? (v as number) : null);
const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, 20) : []);

export const isEmpty = (p: Proposals) => !p.tasks.length && !p.raid.length && !p.decisions.length;

/** Model output is data until checked: the trailing compass-meta block is parsed, every item validated, the rest dropped. */
export function splitAnswer(raw: string, known: Set<string>): { content: string; citations: string[]; proposals: Proposals } {
  const m = raw.match(BLOCK);
  const content = (m ? raw.slice(0, m.index) : raw).trim();
  let meta: Record<string, unknown> | null = null;
  try { const v = m ? JSON.parse(m[1]) : null; meta = v && typeof v === 'object' ? v : null; } catch { meta = null; }
  const p = (meta?.proposals && typeof meta.proposals === 'object' ? meta.proposals : {}) as Record<string, unknown>;
  const citations = [...new Set((Array.isArray(meta?.citations) ? meta.citations : []).filter((s): s is string => typeof s === 'string' && known.has(s)))].slice(0, 8);
  return {
    content,
    citations,
    proposals: {
      tasks: list(p.tasks).flatMap((t) => { const title = str(t.title, 120); return title ? [{ title, horizon: HORIZONS.includes(t.horizon as Horizon) ? (t.horizon as Horizon) : 'short', due_at: ymd(t.due_at) }] : []; }),
      raid: list(p.raid).flatMap((x) => { const text = str(x.text, 2000); return text && RAID.includes(x.type as RaidType) ? [{ type: x.type as RaidType, text, probability: level(x.probability), impact: level(x.impact) }] : []; }),
      decisions: list(p.decisions).flatMap((d) => { const text = str(d.text, 2000); return text ? [{ text }] : []; }),
    },
  };
}
