// v2.5 time tracking: limits and the timestamp clamp shared by the Worker and the device, so both give the same answer (T3).
export const MAX_RUNNING = 5; // running timers at once, across everything
export const MAX_ENTRY_MINUTES = 1440; // one entry is at most 24 h
export const MAX_NOTE = 500;
export const FUTURE_SLACK_MS = 300_000; // a device clock may run 5 min ahead
const FLOOR_MS = Date.parse('2020-01-01T00:00:00.000Z');

/** An ISO string within [2020-01-01, now + 5 min]; anything unparseable is now. */
export function clampTs(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  return new Date(Number.isNaN(t) ? nowMs : Math.min(Math.max(t, FLOOR_MS), nowMs + FUTURE_SLACK_MS)).toISOString();
}
