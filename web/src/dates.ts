export const today = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const addDays = (ymd: string, n: number) => new Date(new Date(ymd + 'T00:00:00').getTime() + n * 86_400_000).toLocaleDateString('en-CA');
export const startOfWeek = (ymd: string) => addDays(ymd, -((new Date(ymd + 'T00:00:00').getDay() + 6) % 7));
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtDue(ymd: string | null, t = today()): { text: string; tone: 'over' | 'due' | '' } {
  if (!ymd) return { text: '', tone: '' };
  const diff = Math.round((new Date(ymd + 'T00:00:00').getTime() - new Date(t + 'T00:00:00').getTime()) / 86_400_000);
  if (diff < 0) return { text: diff === -1 ? 'Yesterday' : `${-diff}d late`, tone: 'over' };
  if (diff === 0) return { text: 'Today', tone: 'due' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'due' };
  if (diff < 7) return { text: DOW[new Date(ymd + 'T00:00:00').getDay()], tone: '' };
  return { text: new Date(ymd + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }), tone: '' };
}
