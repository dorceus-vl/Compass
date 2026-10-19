/** True when `hhmm` ("HH:MM", 24 h) falls in [from, to). The window may wrap midnight (22:00 to 07:00); from === to means never quiet. */
export function inQuietHours(hhmm: string, from: string, to: string): boolean {
  if (from === to) return false;
  return from < to ? hhmm >= from && hhmm < to : hhmm >= from || hhmm < to;
}
