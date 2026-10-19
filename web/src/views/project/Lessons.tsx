import { useState, type FormEvent } from 'react';
import type { Lesson, Project } from '../../../../shared/types.ts';
import { useGov, govCreate, govTrash, rowSaver } from '../../gov.ts';
import { confirmAction, toast } from '../../ui/dialogs.tsx';

function Row({ it, reload }: { it: Lesson; reload: () => Promise<void> }) {
  const save = rowSaver('lessons', it as never, reload, ['text']);
  return (
    <div className="card gov-row" style={{ padding: 12 }}>
      <textarea className="field" rows={2} key={`t:${it.updated_at}`} aria-label="Lesson" defaultValue={it.text} maxLength={4000} onBlur={(e) => void save('text', e.target.value)} />
      <div className="row">
        <input className="field" style={{ flex: '0 1 220px' }} key={`c:${it.updated_at}`} aria-label="Category" placeholder="Category" defaultValue={it.category ?? ''} maxLength={60} onBlur={(e) => void save('category', e.target.value)} />
        <button type="button" className="btn" style={{ marginLeft: 'auto', color: 'var(--danger)' }} onClick={async () => { if (await confirmAction('Move this lesson to Trash?', { danger: true }) && await govTrash('lessons', it.id)) { toast('Moved to Trash'); await reload(); } }}>Trash</button>
      </div>
    </div>
  );
}

export function Lessons({ project }: { project: Project }) {
  const { items, offline, reload } = useGov<Lesson>(project.id, 'lessons');
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && await govCreate<Lesson>(project.id, 'lessons', { text: text.trim(), category: category.trim() || null })) { setText(''); setCategory(''); await reload(); }
  };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="sub">Lessons from personal projects are searchable in the library; the copilot reads a project's lessons when it answers about that project.</div>
      {offline && <div className="sub" role="status">Offline: showing the last copy. Changes need a connection.</div>}
      <form className="row" onSubmit={add}>
        <input className="field" style={{ flex: '1 1 240px', width: 'auto' }} aria-label="New lesson" placeholder="What did you learn…" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
        <input className="field" style={{ flex: '0 1 180px', width: 'auto' }} aria-label="Category" placeholder="Category" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} />
        <button className="btn primary" disabled={!text.trim()}>Add</button>
      </form>
      {items.map((it) => <Row key={it.id} it={it} reload={reload} />)}
      {!items.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>No lessons yet.</p>}
    </div>
  );
}
