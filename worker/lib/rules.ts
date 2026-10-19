import type { Rule, RuleMatch, RuleSet, InboxApp, InboxKind, Task } from '../../shared/types.ts';

type Row = { id: string; name: string; app: string; match: string; then_set: string; mode: string; dedupe: string; enabled: number; sort: number };
const json = <T>(s: string, bad: T): T => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : bad; } catch { return bad; } };

/** A rule whose JSON can't be read matches nothing (an impossible regex) rather than everything. */
export function parseRule(row: Row): Rule {
  return { ...row, app: row.app as Rule['app'], mode: row.mode as Rule['mode'], dedupe: row.dedupe as Rule['dedupe'],
    match: json<RuleMatch>(row.match, { title_regex: '(?!)' }), then_set: json<RuleSet>(row.then_set, {}) };
}

function regexHolds(src: string, title: string): boolean {
  try { return new RegExp(src, 'i').test(title); } catch { return false; }
}

export function matchRule(rules: Rule[], item: { app: InboxApp; kind: InboxKind; suggest: string | null; title: string }): Rule | null {
  for (const r of [...rules].sort((a, b) => a.sort - b.sort)) {
    if (!r.enabled || (r.app !== '*' && r.app !== item.app)) continue;
    const m = r.match;
    if (m.suggest !== undefined && m.suggest !== item.suggest) continue;
    if (m.kind !== undefined && m.kind !== item.kind) continue;
    if (m.title_regex !== undefined && !regexHolds(m.title_regex, item.title)) continue;
    return r;
  }
  return null;
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

export function taskFromRule(rule: Rule, item: { app: InboxApp; kind: InboxKind; title: string; from: string | null }, today: string, workDefault: boolean): Partial<Task> {
  const s = rule.then_set;
  const out: Partial<Task> = {
    horizon: s.horizon ?? 'short',
    kind: s.kind ?? (workDefault ? 'work' : 'personal'),
    priority: s.priority ?? 0,
    status: s.status ?? 'new',
    project_id: s.project_id ?? null,
    due_at: s.due_offset_days !== undefined ? addDays(today, s.due_offset_days) : null,
  };
  if (out.status === 'waiting' && item.kind === 'email' && item.from) out.waiting_on = item.from;
  return out;
}
