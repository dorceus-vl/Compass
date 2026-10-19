import { useState, type FormEvent } from 'react';
import type { Decision, Project } from '../../../../shared/types.ts';
import { useGov, govCreate, govTrash, useRowSaver } from '../../gov.ts';
import { Link } from '../../router.ts';
import { confirmAction, toast } from '../../ui/dialogs.tsx';
import { today } from '../../dates.ts';

function Row({ it, reload }: { it: Decision; reload: () => Promise<void> }) {
  const { save, k } = useRowSaver('decisions', it as never, reload, ['text', 'decided_at']);
  return (
    <div className="card gov-row" style={{ padding: 12 }}>
      <div className="row">
        <input className="field" style={{ flex: '0 1 160px', width: 'auto' }} type="date" key={k('decided_at')} aria-label="Decided on" defaultValue={it.decided_at} onBlur={(e) => void save('decided_at', e.target.value)} />
        {it.from_meeting_id && <Link to={`/meetings/${it.from_meeting_id}`} className="chip">From meeting{it.at_ref ? ` · ${it.at_ref}` : ''}</Link>}
        <button type="button" className="btn" style={{ marginLeft: 'auto', color: 'var(--danger)' }} onClick={async () => { if (await confirmAction('Move this decision to Trash?', { danger: true }) && await govTrash('decisions', it.id)) { toast('Moved to Trash'); await reload(); } }}>Trash</button>
      </div>
      <textarea className="field" rows={2} key={k('text')} aria-label="Decision" defaultValue={it.text} maxLength={2000} onBlur={(e) => void save('text', e.target.value)} />
    </div>
  );
}

export function Decisions({ project }: { project: Project }) {
  const { items, offline, reload } = useGov<Decision>(project.id, 'decisions');
  const [text, setText] = useState('');
  const [date, setDate] = useState(today());
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && await govCreate<Decision>(project.id, 'decisions', { text: text.trim(), decided_at: date || today() })) { setText(''); await reload(); }
  };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {offline && <div className="sub" role="status">Offline: showing the last copy. Changes need a connection.</div>}
      <form className="row" onSubmit={add}>
        <input className="field" style={{ flex: '1 1 240px', width: 'auto' }} aria-label="New decision" placeholder="What was decided…" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        <input className="field" style={{ flex: '0 1 160px', width: 'auto' }} type="date" aria-label="Decision date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn primary" disabled={!text.trim()}>Add</button>
      </form>
      {items.map((it) => <Row key={it.id} it={it} reload={reload} />)}
      {!items.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>No decisions logged yet.</p>}
    </div>
  );
}
