import { useEffect, useRef, useState } from 'react';
import type { Task } from '../../../shared/types.ts';
import { parseChecklist, MAX_CHECKLIST, MAX_CHECKLIST_TEXT, type ChecklistItem } from '../../../shared/deps.ts';
import { updateTask } from '../store/useStore.ts';

/** What gets saved: items with no text yet stay on the screen only. */
const persisted = (xs: ChecklistItem[]) => { const k = xs.filter((i) => i.text.trim()); return k.length ? JSON.stringify(k) : null; };

/**
 * The task sheet's Checklist (V1). Edits go through updateTask (the offline queue), one PATCH of the whole list per change;
 * typing is saved after a short pause. Keys: Enter adds the next item, Alt+Up/Down moves one (plain Up/Down move focus),
 * Backspace on an empty item removes it. Pointer and touch use the buttons.
 */
export function Checklist({ task }: { task: Task }) {
  const [items, setItems] = useState<ChecklistItem[]>(() => parseChecklist(task.checklist) ?? []);
  const live = useRef(items);
  const timer = useRef<number | null>(null);
  const focusId = useRef<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const sent = useRef(task.checklist || null); // the last value we queued, so two quick changes are never compared with a stale prop
  const send = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } const next = persisted(live.current); if (next !== sent.current) { sent.current = next; void updateTask(task.id, { checklist: next }); } };
  const sendRef = useRef(send); sendRef.current = send;
  const commit = (xs: ChecklistItem[], now = true) => {
    live.current = xs; setItems(xs);
    if (timer.current) clearTimeout(timer.current);
    if (now) sendRef.current(); else timer.current = window.setTimeout(() => sendRef.current(), 500);
  };
  // A change from another device arrives with the next pull; take it unless an edit of ours is waiting.
  useEffect(() => {
    if (timer.current) return;
    if (persisted(live.current) !== (task.checklist || null)) { live.current = parseChecklist(task.checklist) ?? []; sent.current = task.checklist || null; setItems(live.current); }
  }, [task.checklist]);
  useEffect(() => () => { if (timer.current) sendRef.current(); }, []); // closing the sheet saves what is waiting
  useEffect(() => { // move focus to the item an action asked for, after it has rendered
    if (!focusId.current) return;
    list.current?.querySelector<HTMLInputElement>(`[data-item="${focusId.current}"] input[type=text]`)?.focus();
    focusId.current = null;
  });

  const done = items.filter((i) => i.done).length;
  const patch = (id: string, p: Partial<ChecklistItem>, now: boolean) => commit(items.map((i) => (i.id === id ? { ...i, ...p } : i)), now);
  const addAfter = (idx: number) => {
    if (items.length >= MAX_CHECKLIST) return;
    const it: ChecklistItem = { id: crypto.randomUUID(), text: '', done: false };
    focusId.current = it.id;
    commit([...items.slice(0, idx + 1), it, ...items.slice(idx + 1)]);
  };
  const move = (idx: number, by: -1 | 1) => {
    const to = idx + by; if (to < 0 || to >= items.length) return;
    const xs = items.slice(); [xs[idx], xs[to]] = [xs[to], xs[idx]];
    focusId.current = items[idx].id;
    commit(xs);
  };
  const remove = (idx: number, focusPrev = false) => {
    const prev = items[idx - 1] ?? items[idx + 1];
    if (focusPrev && prev) focusId.current = prev.id;
    commit(items.filter((_, i) => i !== idx));
  };
  const focusSibling = (idx: number, by: -1 | 1) => {
    const t = items[idx + by]; if (t) list.current?.querySelector<HTMLInputElement>(`[data-item="${t.id}"] input[type=text]`)?.focus();
  };

  return (
    <section className="chk" aria-label="Checklist">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Checklist</span>
        {items.length > 0 && <span className="chk-count" aria-live="polite">{done}/{items.length} done</span>}
      </div>
      {items.length > 0 && <div className="chk-bar" aria-hidden="true"><i style={{ width: `${Math.round((100 * done) / items.length)}%` }} /></div>}
      <ul ref={list} className="chk-list">
        {items.map((it, idx) => (
          <li key={it.id} data-item={it.id} className={it.done ? 'done' : ''}>
            <label className="chk-hit"><input type="checkbox" className="chk-box" checked={it.done} aria-label={`Done: ${it.text || 'new item'}`} onChange={(e) => patch(it.id, { done: e.target.checked }, true)} /></label>
            <input type="text" className="field" value={it.text} maxLength={MAX_CHECKLIST_TEXT} aria-label={`Item ${idx + 1} of ${items.length}`} placeholder="Checklist item"
              onChange={(e) => patch(it.id, { text: e.target.value }, false)}
              onBlur={() => { if (timer.current) sendRef.current(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); if (it.text.trim()) addAfter(idx); }
                else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(idx, e.key === 'ArrowUp' ? -1 : 1); }
                else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); focusSibling(idx, e.key === 'ArrowUp' ? -1 : 1); }
                else if ((e.key === 'Backspace' || e.key === 'Delete') && !it.text) { e.preventDefault(); remove(idx, true); }
              }} />
            <span className="chk-act">
              <button type="button" aria-label={`Move up: ${it.text || 'item'}`} disabled={idx === 0} onClick={() => move(idx, -1)}>↑</button>
              <button type="button" aria-label={`Move down: ${it.text || 'item'}`} disabled={idx === items.length - 1} onClick={() => move(idx, 1)}>↓</button>
              <button type="button" aria-label={`Remove: ${it.text || 'item'}`} onClick={() => remove(idx)}>×</button>
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn chk-add" disabled={items.length >= MAX_CHECKLIST} onClick={() => addAfter(items.length - 1)}>
        {items.length >= MAX_CHECKLIST ? 'Fifty items at most' : '+ Add an item'}
      </button>
    </section>
  );
}
