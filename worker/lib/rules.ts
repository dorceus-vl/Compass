import type { Rule, RuleMatch, RuleSet, InboxApp, InboxKind, Task } from '../../shared/types.ts';

type Row = { id: string; name: string; app: string; match: string; then_set: string; mode: string; dedupe: string; enabled: number; sort: number };
const json = <T>(s: string, bad: T): T => { try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : bad; } catch { return bad; } };

/** A rule whose JSON can't be read matches nothing (an impossible regex) rather than everything. */
export function parseRule(row: Row): Rule {
  return { ...row, app: row.app as Rule['app'], mode: row.mode as Rule['mode'], dedupe: row.dedupe as Rule['dedupe'],
    match: json<RuleMatch>(row.match, { title_regex: '(?!)' }), then_set: json<RuleSet>(row.then_set, {}) };
}

// ponytail: a group containing a quantifier and followed by another quantifier (catastrophic backtracking shape) is rejected by pattern, not by timing; the length cap bounds the rest.
const NESTED = /\((?:[^()\\]|\\.)*[+*{][^()]*\)\s*[+*?{]/;

/** Compile a user-typed title regex (case-insensitive), or null when it is too long, invalid, or nests quantifiers. */
export function safeRegex(src: string): RegExp | null {
  if (src.length > 100 || NESTED.test(src)) return null;
  try { return new RegExp(src, 'i'); } catch { return null; }
}

function regexHolds(src: string, title: string): boolean {
  const re = safeRegex(src);
  return re !== null && re.test(title.slice(0, 120));
}

export function matchRule(rules: Rule[], item: { app: InboxApp; kind: InboxKind; suggest: string | null; title: string }): Rule | null {
  for (const r of [...rules].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!r.enabled || (r.app !== '*' && r.app !== item.app)) continue;
    const m = r.match;
    if (m.suggest !== undefined && m.suggest !== item.suggest) continue;
    if (m.kind !== undefined && m.kind !== item.kind) continue;
    if (m.title_regex !== undefined && !regexHolds(m.title_regex, item.title)) continue;
    return r;
  }
  return null;
}

/** YYYY-MM-DD plus n days, or null when today is not a real calendar date. */
const addDays = (ymd: string, n: number): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const ms = Date.parse(ymd + 'T00:00:00Z');
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== ymd) return null;
  return new Date(ms + n * 86_400_000).toISOString().slice(0, 10);
};

export function taskFromRule(rule: Rule, item: { app: InboxApp; kind: InboxKind; title: string; from: string | null }, today: string, workDefault: boolean): Partial<Task> {
  const s = rule.then_set;
  const off: unknown = s.due_offset_days;
  const offsetOk = typeof off === 'number' && Number.isInteger(off) && off >= 0 && off <= 365;
  const out: Partial<Task> = {
    horizon: s.horizon ?? 'short',
    kind: s.kind ?? (workDefault ? 'work' : 'personal'),
    priority: s.priority ?? 0,
    status: s.status ?? 'new',
    project_id: s.project_id ?? null,
    due_at: offsetOk ? addDays(today, off as number) : null,
  };
  if (out.status === 'waiting' && item.kind === 'email' && item.from) out.waiting_on = item.from;
  return out;
}
