import { useState, type FormEvent } from 'react';
import type { ChangeRequest, Project } from '../../../../shared/types.ts';
import { useGov, govCreate, govPatch, govTrash, useRowSaver } from '../../gov.ts';
import { confirmAction, toast } from '../../ui/dialogs.tsx';
import { today } from '../../dates.ts';
import { accent } from '../../ui/colors.ts';

function Row({ it, reload }: { it: ChangeRequest; reload: () => Promise<void> }) {
  const { save, k } = useRowSaver('changes', it as never, reload, ['title']);
  const [more, setMore] = useState(false);
  const area = (key: 'description' | 'impact_scope' | 'impact_time' | 'impact_cost', label: string) => (
    <label className="sub" style={{ display: 'grid', gap: 4 }}>{label}
      <textarea className="field" rows={2} key={k(key)} defaultValue={it[key] ?? ''} maxLength={key === 'description' ? 5000 : 2000} onBlur={(e) => void save(key, e.target.value)} /></label>
  );
  return (
    <div className="acard gov-row" style={accent(it.decision === 'approved' ? 'var(--ok)' : it.decision === 'rejected' ? 'var(--danger)' : 'var(--warn)')}>
      <input className="field" key={k('title')} aria-label="Title" defaultValue={it.title} maxLength={200} onBlur={(e) => void save('title', e.target.value)} />
      <div className="row">
        <select className="field" aria-label="Decision" value={it.decision} onChange={async (e) => {
          // A decision stamps its date when the change is approved or rejected; back to pending clears it.
          const decision = e.target.value;
          if (await govPatch('changes', it.id, { decision, decided_at: decision === 'pending' ? null : it.decided_at ?? today() })) await reload();
        }}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
        {it.decision !== 'pending' && <input className="field" type="date" key={k('decided_at')} aria-label="Decided on" defaultValue={it.decided_at ?? ''} onBlur={(e) => void save('decided_at', e.target.value || null)} />}
        <input className="field" key={k('approver')} aria-label="Approver" placeholder="Approver" defaultValue={it.approver ?? ''} maxLength={200} onBlur={(e) => void save('approver', e.target.value)} />
      </div>
      <div className="row">
        <button type="button" className="btn" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Hide details' : 'Details and impact'}</button>
        <button type="button" className="btn" style={{ color: 'var(--danger)' }} onClick={async () => { if (await confirmAction('Move this change to Trash?', { danger: true }) && await govTrash('changes', it.id)) { toast('Moved to Trash'); await reload(); } }}>Trash</button>
      </div>
      {more && <div className="gov-row">{area('description', 'Description')}{area('impact_scope', 'Impact on scope')}{area('impact_time', 'Impact on time')}{area('impact_cost', 'Impact on cost')}</div>}
    </div>
  );
}

export function Changes({ project }: { project: Project }) {
  const { items, offline, reload } = useGov<ChangeRequest>(project.id, 'changes');
  const [title, setTitle] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim() && await govCreate<ChangeRequest>(project.id, 'changes', { title: title.trim() })) { setTitle(''); await reload(); }
  };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {offline && <div className="sub" role="status">Offline: showing the last copy. Changes need a connection.</div>}
      <form className="row" onSubmit={add}>
        <input className="field" style={{ flex: '1 1 240px', width: 'auto' }} aria-label="New change request" placeholder="Change request title…" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn primary" disabled={!title.trim()}>Add</button>
      </form>
      {items.map((it) => <Row key={it.id} it={it} reload={reload} />)}
      {!items.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>No change requests yet.</p>}
    </div>
  );
}
