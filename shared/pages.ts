// Project wiki pages and agendas (v2.10). `projects.pages` is a JSON array of Page. A page is Markdown linked to tasks;
// an agenda is a list of time-boxed items (minutes) with optional Markdown notes, shared as Markdown text.
export type AgendaItem = { id: string; text: string; mins: number };
export type Page = { id: string; title: string; kind: 'page' | 'agenda'; body: string; tasks: string[]; items: AgendaItem[]; updated: string };
export const MAX_PAGES = 100;
export const MAX_PAGE_TITLE = 120;
export const MAX_PAGE_BODY = 20000;
export const MAX_PAGE_TASKS = 50;
export const MAX_AGENDA_ITEMS = 50;
export const MAX_ITEM_TEXT = 200;
export const MAX_ITEM_MINS = 480;

const json = (v: unknown): unknown => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return undefined; } };
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= 64;

/** The pages in a `pages` value (JSON text, an array or empty): [] when none, null when not valid (over 100, a repeated id, a title empty or over 120,
 *  a body over 20000, an unknown kind, over 50 task links or 50 agenda items, an item text empty or over 200, minutes not a whole number of 0 to 480). */
export function parsePages(v: unknown): Page[] | null {
  if (v === null || v === undefined || v === '') return [];
  const a = json(v);
  if (!Array.isArray(a) || a.length > MAX_PAGES) return null;
  const ids = new Set<string>();
  const out: Page[] = [];
  for (const x of a) {
    if (!x || typeof x !== 'object') return null;
    const { id: pid, title, kind, body, tasks, items, updated } = x as Record<string, unknown>;
    if (!id(pid) || ids.has(pid)) return null;
    if (typeof title !== 'string' || title.trim() === '' || title.length > MAX_PAGE_TITLE) return null;
    if (kind !== 'page' && kind !== 'agenda') return null;
    if (!str(body, MAX_PAGE_BODY) || !str(updated, 40)) return null;
    if (!Array.isArray(tasks) || tasks.length > MAX_PAGE_TASKS || !tasks.every(id) || new Set(tasks).size !== tasks.length) return null;
    if (!Array.isArray(items) || items.length > MAX_AGENDA_ITEMS) return null;
    const iids = new Set<string>();
    for (const it of items) {
      if (!it || typeof it !== 'object') return null;
      const { id: iid, text, mins } = it as Record<string, unknown>;
      if (!id(iid) || iids.has(iid) || typeof text !== 'string' || text.trim() === '' || text.length > MAX_ITEM_TEXT) return null;
      if (!Number.isInteger(mins) || (mins as number) < 0 || (mins as number) > MAX_ITEM_MINS) return null;
      iids.add(iid);
    }
    ids.add(pid);
    out.push({ id: pid, title, kind, body, tasks: tasks as string[], items: items as AgendaItem[], updated });
  }
  return out;
}

export const storedPages = (p: Page[]) => (p.length ? JSON.stringify(p) : null);

/** Minutes the agenda's items add up to. */
export const agendaMins = (items: AgendaItem[]) => items.reduce((a, i) => a + i.mins, 0);

/** An agenda as Markdown to paste or send: a numbered list with each item's start offset and length, then the notes. */
export function agendaMarkdown(p: Pick<Page, 'title' | 'body' | 'items'>): string {
  let at = 0;
  const lines = p.items.map((it, i) => { const s = `${i + 1}. ${it.text} (${it.mins} min, +${at})`; at += it.mins; return s; });
  return [`# ${p.title}`, '', ...lines, '', `Total: ${at} min`, ...(p.body.trim() ? ['', p.body.trim()] : [])].join('\n') + '\n';
}
