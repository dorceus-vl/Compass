// Stakeholder register (v2.2, C6 to C8): quadrants, when an update is due, the reminder text, the Athena seed and the input checks. Pure, so the Worker and the device agree.
export type Level = 'high' | 'low';
export type Attitude = 'supportive' | 'neutral' | 'resistant';
export type QuadrantId = 'manage' | 'satisfy' | 'inform' | 'monitor';
export const LEVELS: Level[] = ['high', 'low'];
export const ATTITUDES: Attitude[] = ['supportive', 'neutral', 'resistant'];
export const STAKEHOLDER_DAYS = { min: 1, max: 365 };
/** In grid order (top-left, top-right, bottom-left, bottom-right: power up, interest across). */
export const QUADRANTS: { id: QuadrantId; label: string; hint: string }[] = [
  { id: 'satisfy', label: 'Keep satisfied', hint: 'High power, low interest' },
  { id: 'manage', label: 'Manage closely', hint: 'High power, high interest' },
  { id: 'monitor', label: 'Monitor', hint: 'Low power, low interest' },
  { id: 'inform', label: 'Keep informed', hint: 'Low power, high interest' },
];
export const quadrant = (power: Level, interest: Level): QuadrantId => power === 'high' ? (interest === 'high' ? 'manage' : 'satisfy') : (interest === 'high' ? 'inform' : 'monitor');
export const quadrantLabel = (power: Level, interest: Level) => QUADRANTS.find((q) => q.id === quadrant(power, interest))!.label;

export interface Stakeholder {
  id: string; project_id: string; name: string; role: string | null; power: Level; interest: Level; attitude: Attitude; channel: string | null;
  cadence_days: number | null; last_contact_at: string | null; notes: string | null; sort: number; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number;
}

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
/** The calendar day of an ISO timestamp (or a plain date) in `tz`; UTC when none is given. */
const dayOf = (ts: string, tz?: string) => ts.length <= 10 ? ts : new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));

/** The day the next update is due: the last one plus the cadence, or `today` when never contacted. null when there is no cadence. */
export function nextDue(last: string | null, cadence: number | null, today: string, tz?: string): string | null {
  if (!cadence) return null;
  return last ? addDays(dayOf(last, tz), cadence) : today;
}
type Due = Pick<Stakeholder, 'last_contact_at' | 'cadence_days'>;
export const isDue = (s: Due, today: string, tz?: string) => { const d = nextDue(s.last_contact_at, s.cadence_days, today, tz); return d !== null && d <= today; };
export const dueCount = (list: Due[], today: string, tz?: string) => list.filter((s) => isDue(s, today, tz)).length;
/** "Due now" (today or overdue), "In 3 days", or "No cadence". */
export function dueText(due: string | null, today: string): string {
  if (!due) return 'No cadence';
  const n = Math.round((Date.parse(due) - Date.parse(today)) / DAY);
  return n <= 0 ? 'Due now' : `In ${n} day${n === 1 ? '' : 's'}`;
}

/** C7: the daily push. A count and nothing else: no name, not even a personal one. null when nothing is due. */
export function stakeholderPush(n: number, url: string | null): { title: string; body: string; url: string } | null {
  if (n <= 0) return null;
  return { title: `${n} stakeholder update${n === 1 ? '' : 's'} due`, body: 'Open Compass to see who', url: url ?? '/projects' };
}

const RAG: Record<string, string> = { green: 'Green', amber: 'Amber', red: 'Red' };
/** C8: what Athena is asked about. The role, attitude, channel, quadrant and the project's status line; the name only for a personal stakeholder; never the notes. */
export function draftSeed(s: Pick<Stakeholder, 'name' | 'role' | 'power' | 'interest' | 'attitude' | 'channel'>, p: { rag: string; rag_reason: string | null }, kind: 'work' | 'personal'): string {
  const status = `${RAG[p.rag] ?? 'Not set'}: ${p.rag_reason?.trim() || 'no reason given'}`;
  return [
    kind === 'work' ? 'Draft a short status update for a project stakeholder. I will add their name myself.' : `Draft a short status update for ${s.name}, a project stakeholder.`,
    `Role: ${s.role || 'not given'}`, `Attitude: ${s.attitude}`, `Priority: ${quadrantLabel(s.power, s.interest)}`, `Channel: ${s.channel || 'not given'}`,
    `Project status: ${status}`,
    'Keep it to a few lines, in a tone that suits their attitude. Do not invent facts.',
  ].join('\n');
}

type Out = { values: Record<string, unknown> } | { error: string };
/** Request body to column values. `create` fills the defaults; a patch returns only the keys sent (and can't blank the name). Numbers must be numbers. */
export function parseStakeholderInput(b: unknown, create: boolean): Out {
  const body = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const v: Record<string, unknown> = {};
  const has = (k: string) => k in body && body[k] !== undefined;
  const str = (k: string, max: number, required = false): string | null => {
    if (!has(k)) { if (create && required) return `${k} is required`; if (create) v[k] = null; return null; }
    const raw = body[k];
    if (raw !== null && typeof raw !== 'string') return `${k} must be text`;
    const t = (raw ?? '').trim();
    if (t.length > max) return `${k} is too long (${max} characters at most)`;
    if (required && !t) return `${k} is required`;
    v[k] = t || null; return null;
  };
  const pick = <T extends string>(k: string, allowed: T[], dflt: T): string | null => {
    if (!has(k)) { if (create) v[k] = dflt; return null; }
    if (typeof body[k] !== 'string' || !(allowed as string[]).includes(body[k] as string)) return `${k} must be one of: ${allowed.join(', ')}`;
    v[k] = body[k]; return null;
  };
  const errs = [
    str('name', 120, true), str('role', 120), pick('power', LEVELS, 'low'), pick('interest', LEVELS, 'low'), pick('attitude', ATTITUDES, 'neutral'), str('channel', 60), str('notes', 2000),
  ];
  if (has('cadence_days')) {
    const c = body.cadence_days;
    if (c !== null && (typeof c !== 'number' || !Number.isInteger(c) || c < STAKEHOLDER_DAYS.min || c > STAKEHOLDER_DAYS.max)) errs.push(`cadence_days must be a whole number from ${STAKEHOLDER_DAYS.min} to ${STAKEHOLDER_DAYS.max}, or empty`);
    else v.cadence_days = c;
  } else if (create) v.cadence_days = null;
  const error = errs.find((e) => e);
  return error ? { error } : { values: v };
}
