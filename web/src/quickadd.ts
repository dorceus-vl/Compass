// Quick-add grammar (spec §6): title [#project] [@work|@personal] [!1-3] [+tag] [date words]
// Date words: today, tomorrow, mon…sun, next week, in N days, oct 24, 24/10, every day|week|month.
import type { Project } from '../../shared/types.ts';
// Whole words only: the 3-letter form or the full English name (plus tues/thur/thurs/sept).
const DOW = ['sun(?:day)?', 'mon(?:day)?', 'tue(?:s(?:day)?)?', 'wed(?:nesday)?', 'thu(?:r(?:s(?:day)?)?)?', 'fri(?:day)?', 'sat(?:urday)?'];
const MON = ['jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'june?', 'july?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?'];
const idx = (names: string[], w: string) => names.findIndex((n) => new RegExp(`^${n}$`, 'i').test(w));
const add = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');
/** Explicit month/day → the next such date on or after today (null if the date does not exist). */
function nextDate(today: string, month: number, day: number): string | null {
  for (let y = Number(today.slice(0, 4)); y <= Number(today.slice(0, 4)) + 1; y++) {
    const d = new Date(Date.UTC(y, month - 1, day));
    if (d.getUTCMonth() !== month - 1) return null;
    const ymd = `${y}-${pad(month)}-${pad(day)}`;
    if (ymd >= today) return ymd;
  }
  return null;
}

export function parseQuickAdd(text: string, projects: Pick<Project, 'id' | 'name' | 'kind'>[], today: string) {
  let s = ' ' + text.trim() + ' ';
  const out = { title: '', project_id: null as string | null, kind: 'personal' as 'personal' | 'work', priority: 0, due_at: null as string | null, recur: null as string | null, tags: [] as string[] };
  // f returns false to leave the match in the title
  const take = (re: RegExp, f: (m: RegExpMatchArray) => void | false) => { const m = s.match(re); if (m && f(m) !== false) s = s.replace(m[0], ' '); };
  take(/ #(\S+)/, (m) => { const p = projects.find((x) => x.name.toLowerCase().startsWith(m[1].toLowerCase())); if (p) { out.project_id = p.id; out.kind = p.kind; } });
  take(/ @(work|personal)/i, (m) => { if (!out.project_id) out.kind = m[1].toLowerCase() as 'work'; });
  take(/ !([1-3])/, (m) => { out.priority = Number(m[1]); });
  for (;;) { const m = s.match(/ \+(\S+)/); if (!m) break; out.tags.push(m[1]); s = s.replace(m[0], ' '); }
  take(/ every (weekday|day|week|month)s?(?= )/i, (m) => { const w = m[1].toLowerCase(); out.recur = w === 'weekday' ? '{"freq":"weekly","interval":1,"weekdays":[1,2,3,4,5]}' : `{"freq":"${w === 'day' ? 'daily' : w + 'ly'}","interval":1}`; });
  take(/ today /i, () => { out.due_at = today; });
  take(/ tomorrow /i, () => { out.due_at = add(today, 1); });
  take(/ next week /i, () => { out.due_at = add(today, 7 - ((new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7)); });
  take(/ in (\d+) days? /i, (m) => { out.due_at = add(today, Number(m[1])); });
  take(/ (\d{1,2})\/(\d{1,2}) /, (m) => { const d = nextDate(today, Number(m[2]), Number(m[1])); if (!d) return false; out.due_at = d; });
  take(new RegExp(` (${MON.join('|')}) (\\d{1,2}) `, 'i'), (m) => { const d = nextDate(today, idx(MON, m[1]) + 1, Number(m[2])); if (!d) return false; out.due_at = d; });
  take(new RegExp(` (${DOW.join('|')}) `, 'i'), (m) => { const cur = new Date(today + 'T00:00:00Z').getUTCDay(); out.due_at = add(today, ((idx(DOW, m[1]) - cur + 7) % 7) || 7); });
  out.title = s.replace(/\s+/g, ' ').trim();
  return out;
}
