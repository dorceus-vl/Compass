import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useStore, createTask } from '../store/useStore.ts';
import { parseQuickAdd } from '../quickadd.ts';
import { today } from '../dates.ts';
import { navigate } from '../router.ts';
import { toast } from './dialogs.tsx';
import { TaskSheet } from './TaskSheet.tsx';

const JUMPS: [string, string][] = [['/', 'Today'], ['/board', 'Board'], ['/list', 'List'], ['/upcoming', 'Upcoming'], ['/timeline', 'Timeline'], ['/projects', 'Projects'], ['/settings', 'Settings'], ['/trash', 'Trash']];

export function Palette({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { tasks, projects } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const jump = q.startsWith('/');
  const needle = q.replace(/^\//, '').toLowerCase();
  const parsed = parseQuickAdd(q, projects, today());
  const hint = [parsed.project_id && projects.find((x) => x.id === parsed.project_id)?.name, parsed.kind === 'work' && 'work', parsed.due_at, parsed.priority && `!${parsed.priority}`, parsed.recur && 'repeats', ...parsed.tags.map((t) => `+${t}`)].filter(Boolean).join(' · ') || 'personal · short';
  const items: { label: string; hint: string; run: () => void | Promise<void> }[] = jump
    ? JUMPS.filter(([, l]) => l.toLowerCase().includes(needle)).map(([to, l]) => ({ label: l, hint: 'Go', run: () => { navigate(to); ref.current?.close(); } }))
    : [
        ...(q.trim() ? [{ label: `Add "${parsed.title}"`, hint, run: async () => { setQ(''); setSel(0); await createTask({ ...parsed, tags: JSON.stringify(parsed.tags) }); toast('Added'); } }] : []),
        ...projects.filter((p) => needle && p.name.toLowerCase().includes(needle)).slice(0, 3).map((p) => ({ label: p.name, hint: 'Project', run: () => { navigate(`/projects/${p.id}`); ref.current?.close(); } })),
        ...tasks.filter((t) => needle && !t.deleted_at && t.status !== 'done' && t.title.toLowerCase().includes(needle)).slice(0, 6).map((t) => ({ label: t.title, hint: 'Task', run: () => setOpen(t.id) })),
      ];
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void items[sel]?.run(); }
  };
  return (
    <>
      <dialog ref={ref} aria-label="Command palette" onClose={onClose} style={{ width: 'min(640px, calc(100vw - 32px))', padding: 10, marginTop: '12vh' }}>
        <input className="field" autoFocus placeholder="Add a task… (#project @work !3 +tag fri) or / to jump" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey}
          aria-label="Command" role="combobox" aria-expanded={items.length > 0} aria-controls="palette-list" aria-activedescendant={items[sel] ? `palette-opt-${sel}` : undefined} />
        <div id="palette-list" role="listbox" aria-label="Results" style={{ marginTop: 8 }}>
          {items.map((it, i) => <div key={i} id={`palette-opt-${i}`} className="task" style={i === sel ? { borderColor: 'var(--accent)' } : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => void it.run()} role="option" aria-selected={i === sel}><div className="tt" style={{ flex: 1 }}>{it.label}</div><span className="chip">{it.hint}</span></div>)}
        </div>
      </dialog>
      {open && <TaskSheet taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
