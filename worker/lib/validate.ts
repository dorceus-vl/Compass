// Small value checks for request bodies (audit S13). Column names in this app already come from allowlists; these
// make sure the VALUES are the right type and size before they're bound. Each returns { value } or { error }.
export type Checked = { value: unknown } | { error: string };
export type Check = (v: unknown, field: string) => Checked;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Free text, trimmed; empty becomes null. */
export const text = (max = 1000): Check => (v, f) => {
  if (v === null || v === undefined || v === '') return { value: null };
  if (typeof v !== 'string' && typeof v !== 'number') return { error: `${f} must be text` };
  const s = String(v).trim();
  if (s.length > max) return { error: `${f} is too long (${max} characters at most)` };
  return { value: s || null };
};

export const num = (min = -Infinity, max = Infinity, { nullable = true, integer = false } = {}): Check => (v, f) => {
  if ((v === null || v === '' || v === undefined) && nullable) return { value: null };
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return { error: `${f} must be a number` };
  if (integer && !Number.isInteger(n)) return { error: `${f} must be a whole number` };
  if (n < min || n > max) return { error: `${f} must be between ${min} and ${max}` };
  return { value: n };
};
export const int = (min = -Infinity, max = Infinity, opts: { nullable?: boolean } = {}) => num(min, max, { ...opts, integer: true });

export const date = ({ nullable = true } = {}): Check => (v, f) => {
  if ((v === null || v === '' || v === undefined) && nullable) return { value: null };
  return typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) ? { value: v } : { error: `${f} must be a date (YYYY-MM-DD)` };
};

export const dateTime = ({ nullable = true } = {}): Check => (v, f) => {
  if ((v === null || v === '' || v === undefined) && nullable) return { value: null };
  return typeof v === 'string' && DATETIME_RE.test(v) && !Number.isNaN(Date.parse(v)) ? { value: v } : { error: `${f} must be a date and time` };
};

export const oneOf = <T extends string>(...allowed: T[]): Check => (v, f) =>
  typeof v === 'string' && (allowed as string[]).includes(v) ? { value: v } : { error: `${f} must be one of: ${allowed.join(', ')}` };

export const bool = (): Check => (v) => ({ value: v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0 });

/** The one field a single-field PATCH carries, checked. null when the body names no allowed field. */
export function pickField(body: Record<string, unknown>, checks: Record<string, Check>): { field: string; value: unknown } | { error: string } | null {
  const field = Object.keys(body).find((k) => Object.prototype.hasOwnProperty.call(checks, k));
  if (!field) return null;
  const r = checks[field](body[field], field);
  return 'error' in r ? r : { field, value: r.value };
}

/** Checks every field the body carries that has a check; fields without one are left out. */
export function checkAll(body: Record<string, unknown>, checks: Record<string, Check>): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = {};
  for (const [f, check] of Object.entries(checks)) {
    if (body[f] === undefined) continue;
    const r = check(body[f], f);
    if ('error' in r) return r;
    values[f] = r.value;
  }
  return { values };
}
