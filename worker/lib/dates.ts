// Dates in the user's zone (settings.tz) as YYYY-MM-DD. Anything "today"-shaped uses these, never the UTC date.
export function localDate(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
export const addDays = (ymd: string, n: number) => new Date(new Date(ymd + 'T00:00:00Z').getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** Monday of the week containing the given YYYY-MM-DD. */
export const weekStart = (ymd: string) => addDays(ymd, -((new Date(ymd + 'T00:00:00Z').getUTCDay() + 6) % 7));
