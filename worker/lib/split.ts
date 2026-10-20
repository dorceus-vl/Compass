import type { Horizon, SplitProposal } from '../../shared/types.ts';

export const MAX_PROPOSALS = 12;

const HORIZONS: readonly string[] = ['short', 'medium', 'long'];
const realDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // 2026-02-30 rolls over, so it fails the round trip
};
export const isDay = realDate;

/** The model's answer as a list of proposals: tolerant of a code fence or prose around the JSON; a bad date becomes null, a bad horizon "short", at most 12; anything unreadable is an empty list. */
export function parseSplit(text: string): SplitProposal[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text;
  let data: unknown;
  for (const [open, close] of [['', ''], ['[', ']'], ['{', '}']] as const) {
    const a = open ? fenced.indexOf(open) : 0, b = close ? fenced.lastIndexOf(close) : fenced.length;
    if (a < 0 || b < a) continue;
    try { data = JSON.parse(fenced.slice(a, b + (close ? 1 : 0))); break; } catch { /* try the next shape */ }
  }
  const list = Array.isArray(data) ? data : Array.isArray((data as { tasks?: unknown } | null)?.tasks) ? (data as { tasks: unknown[] }).tasks : [];
  const out: SplitProposal[] = [];
  for (const x of list) {
    const o = x as Record<string, unknown> | null;
    const title = typeof o?.title === 'string' ? o.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    if (!title) continue;
    const notes = typeof o?.notes === 'string' ? o.notes.trim().slice(0, 300) : '';
    out.push({ title, due_at: realDate(o?.due_at) ? o.due_at : null, horizon: HORIZONS.includes(o?.horizon as string) ? (o!.horizon as Horizon) : 'short', notes: notes || null });
    if (out.length === MAX_PROPOSALS) break;
  }
  return out;
}

type Access = { boundary: 'cloud' | 'offline'; kind: 'personal' | 'work' } | null;
export type SplitRefusal = 'pick_cloud_project' | 'offline_boundary' | 'unknown_project';

/**
 * Where an email may go. A work email is read by the model only inside a live cloud work project (its tasks are then sealed like the
 * project's); a personal email may go unfiled or into a live cloud project; an Offline-only project never gets it. null means allowed.
 */
export function splitRefusal(work: boolean, projectId: string | null, access: Access): SplitRefusal | null {
  if (work) return projectId && access && access.boundary === 'cloud' && access.kind === 'work' ? null : 'pick_cloud_project';
  if (!projectId) return null;
  return !access ? 'unknown_project' : access.boundary === 'offline' ? 'offline_boundary' : null;
}
