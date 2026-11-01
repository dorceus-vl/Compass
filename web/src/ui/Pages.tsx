import { useEffect, useState, type FormEvent } from 'react';
import type { Project, Task } from '../../../shared/types.ts';
import { parsePages, storedPages, agendaMins, agendaMarkdown, MAX_PAGES, MAX_PAGE_TITLE, MAX_PAGE_BODY, MAX_PAGE_TASKS, MAX_AGENDA_ITEMS, MAX_ITEM_TEXT, MAX_ITEM_MINS, type Page } from '../../../shared/pages.ts';
import { updateProject } from '../store/useStore.ts';
import { useLatest } from './CustomFields.tsx';
import { Markdown } from './Markdown.tsx';
import { confirmAction, toast } from './dialogs.tsx';

type Patch = Partial<Page> | ((cur: Page) => Partial<Page>);
const newId = () => crypto.randomUUID().slice(0, 8);

/** Project Pages tab (v2.10): wiki pages (Markdown, linked to tasks) and agendas (time-boxed items, copied as Markdown). */
export function PagesTab({ project, tasks, onOpen }: { project: Project; tasks: Task[]; onOpen: (id: string) => void }) {
  const latest = useLatest(project.pages);
  const parsed = parsePages(project.pages);
  const list = parsed ?? [];
  const cur = () => parsePages(latest.get()) ?? [];
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Page['kind']>('page');
  const [openId, setOpenId] = useState<string | null>(null);
  const put = (next: Page[]) => { if (parsePages(latest.get()) === null) { toast('Pages could not be read'); return; } const v = storedPages(next); latest.set(v); void updateProject(project.id, { pages: v }); };
  // The patch is built from the latest queued page, so two quick taps do not undo each other.
  const edit = (id: string, patch: Patch) => put(cur().map((p) => (p.id === id ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch), updated: new Date().toISOString() } : p)));
  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    if (cur().length >= MAX_PAGES) { toast(`${MAX_PAGES} pages at most`); return; }
    const id = newId();
    put([...cur(), { id, title: t, kind, body: '', tasks: [], items: [], updated: new Date().toISOString() }]);
    setTitle('');
    setOpenId(id);
  };
  return (
    <div className="pages" style={{ display: 'grid', gap: 10 }}>
      <div className="sub">Wiki pages for this project, and agendas with time boxes. Link tasks to a page; copy an agenda as Markdown to share it.</div>
      {parsed === null && <p style={{ color: 'var(--danger, #c0392b)', margin: 0 }}>Saved pages could not be read; edits are paused.</p>}
      {list.map((p) => (
        <PageCard key={p.id} page={p} tasks={tasks} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)}
          onEdit={(patch) => edit(p.id, patch)} onOpenTask={onOpen}
          onRemove={async () => { if (await confirmAction(`Remove "${p.title}"?`)) put(cur().filter((x) => x.id !== p.id)); }} />
      ))}
      {!list.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>No pages yet.</p>}
      <form className="row" onSubmit={add}>
        <input className="field" style={{ flex: '1 1 200px', width: 'auto', minHeight: 44 }} aria-label="New page title" placeholder="New page or agenda…" maxLength={MAX_PAGE_TITLE} value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="field" style={{ width: 'auto', minHeight: 44 }} aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as Page['kind'])}>
          <option value="page">Page</option><option value="agenda">Agenda</option>
        </select>
        <button className="btn primary" style={{ minHeight: 44 }} disabled={!title.trim()}>Add</button>
      </form>
    </div>
  );
}

function PageCard({ page: p, tasks, open, onToggle, onEdit, onOpenTask, onRemove }: {
  page: Page; tasks: Task[]; open: boolean; onToggle: () => void; onEdit: (patch: Patch) => void; onOpenTask: (id: string) => void; onRemove: () => void;
}) {
  const [body, setBody] = useState(p.body);
  useEffect(() => setBody(p.body), [p.body]); // another device's change shows; typing is local until blur
  const [text, setText] = useState('');
  const [mins, setMins] = useState('10');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const linked = p.tasks.filter((id) => byId.has(id)); // a task moved or deleted since drops out of view
  const free = tasks.filter((t) => !p.tasks.includes(t.id));
  const addItem = (e: FormEvent) => {
    e.preventDefault();
    const m = Math.round(Number(mins));
    if (!text.trim() || !(m >= 0 && m <= MAX_ITEM_MINS)) { toast(`Minutes: 0 to ${MAX_ITEM_MINS}`); return; }
    if (p.items.length >= MAX_AGENDA_ITEMS) { toast(`${MAX_AGENDA_ITEMS} items at most`); return; }
    onEdit((c) => ({ items: [...c.items, { id: newId(), text: text.trim(), mins: m }] }));
    setText('');
  };
  const swap = (id: string, d: number) => onEdit((c) => { const a = [...c.items]; const i = a.findIndex((x) => x.id === id), j = i + d; if (i < 0 || j < 0 || j >= a.length) return {}; [a[i], a[j]] = [a[j], a[i]]; return { items: a }; });
  const copy = () => { navigator.clipboard.writeText(agendaMarkdown({ ...p, body })).then(() => toast('Agenda copied'), () => toast('Could not copy')); };
  return (
    <div className="card page">
      <button type="button" className="wbs-task" aria-expanded={open} onClick={onToggle}>
        <strong>{p.title}</strong> <span style={{ color: 'var(--text-faint)' }}>{p.kind === 'agenda' ? `Agenda · ${agendaMins(p.items)} min` : 'Page'}{linked.length ? ` · ${linked.length} task${linked.length === 1 ? '' : 's'}` : ''}</span>
      </button>
      {open && (
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <input key={p.title} className="field" style={{ minHeight: 44 }} aria-label="Title" maxLength={MAX_PAGE_TITLE} defaultValue={p.title} onBlur={(e) => { const t = e.target.value.trim(); if (t && t !== p.title) onEdit({ title: t }); else e.target.value = p.title; }} />
          {p.kind === 'agenda' && (
            <>
              {p.items.map((it, i) => (
                <div key={it.id} className="row" style={{ flexWrap: 'nowrap' }}>
                  <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{i + 1}. {it.text}</span>
                  <input key={`${it.id}:${it.mins}`} className="field" style={{ width: 64, minHeight: 44 }} type="number" min={0} max={MAX_ITEM_MINS} aria-label={`Minutes for ${it.text}`} defaultValue={it.mins}
                    onBlur={(e) => { const m = Math.round(Number(e.target.value)); if (m >= 0 && m <= MAX_ITEM_MINS && m !== it.mins) onEdit((c) => ({ items: c.items.map((x) => (x.id === it.id ? { ...x, mins: m } : x)) })); else e.target.value = String(it.mins); }} />
                  <button type="button" className="btn" style={{ minHeight: 44, minWidth: 44 }} aria-label={`Move ${it.text} up`} disabled={i === 0} onClick={() => swap(it.id, -1)}>↑</button>
                  <button type="button" className="btn" style={{ minHeight: 44, minWidth: 44 }} aria-label={`Move ${it.text} down`} disabled={i === p.items.length - 1} onClick={() => swap(it.id, 1)}>↓</button>
                  <button type="button" className="btn" style={{ minHeight: 44, minWidth: 44 }} aria-label={`Remove ${it.text}`} onClick={() => onEdit((c) => ({ items: c.items.filter((x) => x.id !== it.id) }))}>×</button>
                </div>
              ))}
              <form className="row" onSubmit={addItem}>
                <input className="field" style={{ flex: '1 1 160px', width: 'auto', minHeight: 44 }} aria-label="New agenda item" placeholder="Agenda item…" maxLength={MAX_ITEM_TEXT} value={text} onChange={(e) => setText(e.target.value)} />
                <input className="field" style={{ width: 64, minHeight: 44 }} type="number" min={0} max={MAX_ITEM_MINS} aria-label="Minutes" value={mins} onChange={(e) => setMins(e.target.value)} />
                <button className="btn primary" style={{ minHeight: 44 }} disabled={!text.trim()}>Add</button>
              </form>
              <div className="qnote">Total {agendaMins(p.items)} min</div>
            </>
          )}
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-faint)' }}>{p.kind === 'agenda' ? 'Notes (Markdown)' : 'Page (Markdown)'}
            <textarea className="field" rows={8} maxLength={MAX_PAGE_BODY} value={body} onChange={(e) => setBody(e.target.value)} onBlur={() => { if (body !== p.body) onEdit({ body }); }} />
          </label>
          {body.trim() && body === p.body && <Markdown text={p.body} />}
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Linked tasks</div>
          {linked.map((id) => (
            <div key={id} className="row" style={{ flexWrap: 'nowrap' }}>
              <button type="button" className="wbs-task" style={{ flex: 1, borderTop: 0 }} onClick={() => onOpenTask(id)}>{byId.get(id)!.title}</button>
              <button type="button" className="btn" style={{ minHeight: 44, minWidth: 44 }} aria-label={`Unlink ${byId.get(id)!.title}`} onClick={() => onEdit((c) => ({ tasks: c.tasks.filter((x) => x !== id) }))}>×</button>
            </div>
          ))}
          {free.length > 0 && (
            <select className="field" style={{ minHeight: 44 }} aria-label="Link a task" value="" onChange={(e) => { if (!e.target.value) return; const id = e.target.value; if (linked.length >= MAX_PAGE_TASKS) { toast(`${MAX_PAGE_TASKS} links at most`); return; } onEdit((c) => ({ tasks: [...new Set([...c.tasks.filter((x) => byId.has(x)), id])] })); }}>
              <option value="">Link a task…</option>
              {free.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          )}
          <div className="row">
            {p.kind === 'agenda' && <button type="button" className="btn" style={{ minHeight: 44 }} onClick={copy}>Copy as Markdown</button>}
            <button type="button" className="btn" style={{ minHeight: 44 }} onClick={onRemove}>Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}
