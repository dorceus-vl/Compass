import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useStore, createTask } from '../store/useStore.ts';
import { parseQuickAdd } from '../quickadd.ts';
import { today } from '../dates.ts';
import { navigate } from '../router.ts';
import { toast } from './dialogs.tsx';
import { TaskSheet } from './TaskSheet.tsx';
import { useLibrary } from '../library.ts';
import { useDocs } from '../views/project/Documents.tsx';
import { askCopilot } from '../views/Athena.tsx';
import { taskColor, projectColor } from './colors.ts';
import { NewFromTemplate } from './Templates.tsx';

const JUMPS: [string, string][] = [['/', 'Today'], ['/board', 'Board'], ['/list', 'List'], ['/upcoming', 'Upcoming'], ['/calendar', 'Calendar'], ['/workload', 'Workload'], ['/time', 'Time'], ['/timeline', 'Timeline'], ['/projects', 'Projects'], ['/programs', 'Programs'], ['/library', 'Library'], ['/knowledge', 'Knowledge'], ['/settings', 'Settings'], ['/trash', 'Trash']];

export function Palette({ onClose, prefill, onAdded }: { onClose: () => void; prefill?: { title: string; notes: string | null }; onAdded?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { tasks, projects } = useStore();
  const [q, setQ] = useState(prefill?.title ?? '');
  const [notes, setNotes] = useState(prefill?.notes ?? null); // from a shared text: kept for the next Add only
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [tpl, setTpl] = useState(false);
  const { find } = useLibrary();
  const { docs } = useDocs(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const jump = q.startsWith('/');
  const needle = q.replace(/^\//, '').toLowerCase();
  const parsed = parseQuickAdd(q, projects, today());
  const hint = [parsed.project_id && projects.find((x) => x.id === parsed.project_id)?.name, parsed.kind === 'work' && 'work', parsed.due_at, parsed.priority && `!${parsed.priority}`, parsed.recur && 'repeats', ...parsed.tags.map((t) => `+${t}`)].filter(Boolean).join(' · ') || 'personal · short';
  const items: { label: string; hint: string; color: string; run: () => void | Promise<void> }[] = jump
    ? JUMPS.filter(([, l]) => l.toLowerCase().includes(needle)).map(([to, l]) => ({ label: l, hint: 'Go', color: 'var(--accent-dim)', run: () => { navigate(to); ref.current?.close(); } }))
    : [
        ...(parsed.title ? [{ label: `Add "${parsed.title}"`, hint, color: 'var(--accent)', run: async () => { setQ(''); setSel(0); await createTask({ ...parsed, notes, tags: JSON.stringify(parsed.tags) }); setNotes(null); toast('Added'); onAdded?.(); } }] : []),
        ...(!onAdded && (!needle || 'new from template'.startsWith(needle)) ? [{ label: 'New from template…', hint: 'Template', color: 'var(--accent-dim)', run: () => setTpl(true) }] : []),
        ...projects.filter((p) => needle && p.name.toLowerCase().includes(needle)).slice(0, 3).map((p) => ({ label: p.name, hint: 'Project', color: projectColor(p), run: () => { navigate(`/projects/${p.id}`); ref.current?.close(); } })),
        ...tasks.filter((t) => needle && !t.deleted_at && t.status !== 'done' && t.title.toLowerCase().includes(needle)).slice(0, 6).map((t) => ({ label: t.title, hint: 'Task', color: taskColor(t, projects), run: () => setOpen(t.id) })),
        ...(needle ? find(needle, 5) : []).map(({ page }) => ({ label: `Library · ${page.title}`, hint: 'Library', color: 'var(--accent)', run: () => { navigate(`/library/${page.slug}`); ref.current?.close(); } })),
        ...docs.filter((d) => needle && d.name.toLowerCase().includes(needle)).slice(0, 5).map((d) => ({ label: d.name, hint: 'Document', color: 'var(--text-dim)', run: () => { navigate(d.project_id ? `/projects/${d.project_id}/documents` : '/settings'); ref.current?.close(); } })),
        ...(q.trim() ? [{ label: `Ask Athena: ${q.trim()}`, hint: 'Athena', color: 'var(--accent-dim)', run: () => { askCopilot(q.trim()); ref.current?.close(); } }] : []),
      ];
  useEffect(() => { document.getElementById(`palette-opt-${sel}`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void items[sel]?.run(); }
  };
  return (
    <>
      <dialog ref={ref} className="pal" aria-label="Command palette" onClose={onClose}>
        <input className="field" autoFocus placeholder="Add a task… (#project @work !3 +tag fri) or / to jump" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey}
          aria-label="Command" role="combobox" aria-expanded={items.length > 0} aria-controls="palette-list" aria-activedescendant={items[sel] ? `palette-opt-${sel}` : undefined} />
        <div id="palette-list" className="pal-list" role="listbox" aria-label="Results">
          {items.map((it, i) => <div key={i} id={`palette-opt-${i}`} className="pal-row" onMouseDown={(e) => e.preventDefault()} onClick={() => void it.run()} role="option" aria-selected={i === sel}><i className="pal-dot" style={{ '--c': it.color } as CSSProperties} /><div className="tt">{it.label}</div><span className="kind">{it.hint}</span></div>)}
        </div>
      </dialog>
      {tpl && <NewFromTemplate onClose={() => setTpl(false)} onCreated={() => ref.current?.close()} />}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
