const parse = (ymd: string): [number, number, number] => { const [y, m, d] = ymd.split('-').map(Number); return [y, m, d]; };
const fmt = (d: Date) => `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const utcDays = (ymd: string) => { const [y, m, d] = parse(ymd); return Date.UTC(y, m - 1, d) / 86_400_000; };
export const today = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const addDays = (ymd: string, n: number) => { const [y, m, d] = parse(ymd); return fmt(new Date(y, m - 1, d + n)); };
export const startOfWeek = (ymd: string) => { const [y, m, d] = parse(ymd); return addDays(ymd, -((new Date(y, m - 1, d).getDay() + 6) % 7)); };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtDue(ymd: string | null, t = today()): { text: string; tone: 'over' | 'due' | '' } {
  if (!ymd) return { text: '', tone: '' };
  const diff = utcDays(ymd) - utcDays(t);
  const [y, m, d] = parse(ymd);
  const date = new Date(y, m - 1, d);
  if (diff < 0) return { text: diff === -1 ? 'Yesterday' : `${-diff}d late`, tone: 'over' };
  if (diff === 0) return { text: 'Today', tone: 'due' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'due' };
  if (diff < 7) return { text: DOW[date.getDay()], tone: '' };
  return { text: date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }), tone: '' };
}
/** Whole local days since an ISO timestamp. */
export const daysSince = (iso: string, t = today()) => utcDays(t) - utcDays(new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)));
