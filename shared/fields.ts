// Custom fields per project (v2.7). `projects.fields` is a JSON array of FieldDef; `tasks.field_values` a JSON object keyed by field id.
// A person is a name typed in (Compass has one user); a choice keeps its value even when the option is later renamed or removed.
export const FIELD_TYPES = ['number', 'text', 'choice', 'date', 'person'] as const;
export type FieldType = typeof FIELD_TYPES[number];
export type FieldDef = { id: string; name: string; type: FieldType; options?: string[] };
export type FieldValues = Record<string, string | number>;
export const MAX_FIELDS = 20;
export const MAX_OPTIONS = 30;
export const MAX_FIELD_TEXT = 500;

const json = (v: unknown): unknown => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return undefined; } };

/** The definitions in a `fields` value (JSON text, an array or empty): [] when none, null when not valid (over 20, a repeated id, a name empty or over 60, a choice without 1 to 30 options of 1 to 60 characters). */
export function parseFieldDefs(v: unknown): FieldDef[] | null {
  if (v === null || v === undefined || v === '') return [];
  const a = json(v);
  if (!Array.isArray(a) || a.length > MAX_FIELDS) return null;
  const ids = new Set<string>();
  const out: FieldDef[] = [];
  for (const x of a) {
    if (!x || typeof x !== 'object') return null;
    const { id, name, type, options } = x as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || id.length > 64 || ids.has(id)) return null;
    if (typeof name !== 'string' || name.trim() === '' || name.length > 60) return null;
    if (!FIELD_TYPES.includes(type as FieldType)) return null;
    ids.add(id);
    if (type !== 'choice') { out.push({ id, name, type: type as FieldType }); continue; }
    if (!Array.isArray(options) || options.length < 1 || options.length > MAX_OPTIONS
      || options.some((o) => typeof o !== 'string' || o.trim() === '' || o.length > 60)) return null;
    out.push({ id, name, type: 'choice', options: options as string[] });
  }
  return out;
}

/** The values in a `field_values` value: {} when none, null when not valid (over 20 keys, a value not a finite number or a string of 1 to 500). */
export function parseFieldValues(v: unknown): FieldValues | null {
  if (v === null || v === undefined || v === '') return {};
  const o = json(v);
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const e = Object.entries(o as Record<string, unknown>);
  if (e.length > MAX_FIELDS) return null;
  for (const [k, x] of e) {
    if (k === '' || k.length > 64) return null;
    if (typeof x === 'number' ? !Number.isFinite(x) : typeof x !== 'string' || x === '' || x.length > MAX_FIELD_TEXT) return null;
  }
  return o as FieldValues;
}

/** A typed-in value for one field, cleaned: undefined for empty (clear it), null when it does not fit the type. */
export function fieldValue(def: FieldDef, raw: string): string | number | undefined | null {
  const s = raw.trim();
  if (s === '') return undefined;
  if (def.type === 'number') { const n = Number(s); return Number.isFinite(n) ? n : null; }
  if (def.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  if (s.length > MAX_FIELD_TEXT) return null;
  return def.type === 'choice' && !def.options?.includes(s) ? null : s;
}

/** The stored `field_values` after setting one field: only the project's current fields are kept (a moved task or a removed field drops its old values); empty is null. */
export function setFieldValue(defs: FieldDef[], stored: unknown, id: string, value: string | number | undefined): string | null {
  const cur = parseFieldValues(stored) ?? {};
  const next: FieldValues = {};
  for (const d of defs) { const x = d.id === id ? value : cur[d.id]; if (x !== undefined) next[d.id] = x; }
  return Object.keys(next).length ? JSON.stringify(next) : null;
}
