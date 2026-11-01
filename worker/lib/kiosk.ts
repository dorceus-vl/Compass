// Pure shape of the wall tablet's "today" card (v2.14). No Worker imports, so scripts/kiosk.test.ts runs it directly.
export const KIOSK_MAX_ITEMS = 8;
export const KIOSK_MAX_TOKENS = 3;
/** A token may be used at most once in this many ms (a wall clock polls every few minutes). */
export const KIOSK_MIN_GAP_MS = 10_000;
const TITLE_MAX = 120;

export type KioskTask = { title: string; due_at: string | null };
export type KioskCard = { date: string; items: { title: string; due: string | null; overdue: boolean }[]; more: number; work: number };

/** Personal tasks (already due today or earlier, soonest first) cut to the card; `work` is a count only, never a title. */
export function kioskCard(date: string, personal: KioskTask[], work: number): KioskCard {
  const items = personal.slice(0, KIOSK_MAX_ITEMS).map((t) => {
    const due = t.due_at ? t.due_at.slice(0, 10) : null;
    return { title: t.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX), due, overdue: !!due && due < date };
  });
  return { date, items, more: Math.max(0, personal.length - KIOSK_MAX_ITEMS), work };
}
/** True when the token was used less than the gap ago. */
export const tooSoon = (lastUsed: string | null, at: number): boolean => !!lastUsed && at - Date.parse(lastUsed) < KIOSK_MIN_GAP_MS;
/** The display's label: trimmed, 1 to 60 characters; anything else is the default. */
export const kioskLabel = (v: unknown): string => (typeof v === 'string' && v.trim() && v.trim().length <= 60 ? v.trim() : 'Wall tablet');
