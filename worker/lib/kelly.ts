// What comes back from Kelly-Cloud's relay is data: plain text, trimmed and capped. No Worker imports, so scripts/kelly.test.ts runs it directly.
export const BRIEF_MAX = 1200;

/** `{ text, generated_at }` from the relay body, or null when it has no usable text. Control characters (except newlines) go; HTML is left alone because it is only ever rendered as text. */
export function cleanBrief(body: unknown, nowIso: string): { text: string; generated_at: string } | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.text !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = b.text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, BRIEF_MAX).trim();
  if (!text) return null;
  const at = typeof b.generated_at === 'string' && !Number.isNaN(Date.parse(b.generated_at)) ? new Date(b.generated_at).toISOString() : nowIso;
  return { text, generated_at: at };
}

/** A real calendar date written YYYY-MM-DD (not 2026-02-30). */
export const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toJSON()?.slice(0, 10) === s;

export const CAL_MAX_DAYS = 62, CAL_MAX_EVENTS = 500;
/** What is wrong with a `from`/`to` pair, or null when it is fine: both real YYYY-MM-DD dates, from <= to, at most 62 days (inclusive). */
export function rangeError(from: unknown, to: unknown): string | null {
  if (!isYmd(from) || !isYmd(to)) return 'from and to must be dates like 2026-10-20';
  if (from > to) return 'from must not be after to';
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1 > CAL_MAX_DAYS) return `The range is at most ${CAL_MAX_DAYS} days`;
  return null;
}

export interface CalEvent { title: string; start: string; end: string; all_day: boolean; location: string | null; source: string }
// eslint-disable-next-line no-control-regex
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const when = (v: unknown) => (typeof v === 'string' && v.length <= 40 && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

/** `{ events }` from the relay as plain, capped data: at most 500, text trimmed and capped, a bad date drops the event, anything unknown is ignored. */
export function cleanEvents(body: unknown): CalEvent[] | null {
  const list = body && typeof body === 'object' ? (body as { events?: unknown }).events : null;
  if (!Array.isArray(list)) return null;
  const out: CalEvent[] = [];
  for (const e of list) {
    if (out.length >= CAL_MAX_EVENTS) break;
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>, start = when(r.start), end = when(r.end) ?? start, title = text(r.title, 200);
    if (!start || !end || !title) continue;
    out.push({ title, start, end, all_day: r.all_day === true, location: text(r.location, 200) || null, source: text(r.source, 40) || 'google' });
  }
  return out;
}
