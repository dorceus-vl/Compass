import { Fragment, useState, type FormEvent } from 'react';
import type { Project, RaidItem, RaidType } from '../../../../shared/types.ts';
import { riskScore, scoreTone } from '../../../../shared/gov.ts';
import { useGov, govCreate, govPatch, govTrash, useRowSaver } from '../../gov.ts';
import { createTask } from '../../store/useStore.ts';
import { confirmAction, toast } from '../../ui/dialogs.tsx';
import { fmtDue } from '../../dates.ts';
import { accent } from '../../ui/colors.ts';

const TYPES: RaidType[] = ['risk', 'assumption', 'issue', 'dependency'];
const N15 = [1, 2, 3, 4, 5];

function Row({ it, project, reload }: { it: RaidItem; project: Project; reload: () => Promise<void> }) {
  const { save, k } = useRowSaver('raid', it as never, reload, ['text']);
  const score = riskScore(it.probability, it.impact);
  const lvl = (key: 'probability' | 'impact', label: string) => (
    <label className="sub">{label}<select className="field pi" aria-label={key === 'probability' ? 'Probability' : 'Impact'} value={it[key] ?? ''} onChange={(e) => void save(key, e.target.value ? Number(e.target.value) : null)}>
      <option value="">–</option>{N15.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
  );
  const txt = (key: 'owner' | 'response' | 'trigger', label: string) => (
    <input className="field" key={k(key)} aria-label={label} placeholder={label} defaultValue={it[key] ?? ''} maxLength={key === 'owner' ? 200 : 2000} onBlur={(e) => void save(key, e.target.value)} />
  );
  return (
    <div className="acard gov-row" style={{ ...accent(it.type !== 'risk' ? 'var(--text-dim)' : score >= 15 ? 'var(--danger)' : score >= 8 ? 'var(--warn)' : score > 0 ? 'var(--ok)' : 'var(--text-dim)'), opacity: it.status === 'closed' ? 0.65 : 1 }}>
      <div className="row"><span className="chip">{it.type}</span>
        {it.type === 'risk' && <span className={`chip ${scoreTone(score)}`} title="Probability × impact">score {score}</span>}
        {it.from_meeting_id && <span className="chip">from meeting</span>}</div>
      <textarea className="field" rows={2} key={k('text')} aria-label="Text" defaultValue={it.text} maxLength={2000} onBlur={(e) => void save('text', e.target.value)} />
      <div className="row">
        {it.type === 'risk' && lvl('probability', 'P')}{(it.type === 'risk' || it.type === 'issue') && lvl('impact', 'I')}
        {txt('owner', 'Owner')}{txt('response', 'Response')}{it.type === 'risk' && txt('trigger', 'Trigger')}
        <input className="field" style={{ flex: '0 1 160px' }} type="date" key={k('due_at')} aria-label="Due date" defaultValue={it.due_at ?? ''} onBlur={(e) => void save('due_at', e.target.value || null)} />
        {it.due_at && <span className={`chip ${fmtDue(it.due_at).tone}`}>{fmtDue(it.due_at).text}</span>}
      </div>
      <div className="row">
        <div className="seg" role="group" aria-label="Status">{(['open', 'closed'] as const).map((s) => <button type="button" key={s} className={it.status === s ? 'on' : ''} aria-pressed={it.status === s} onClick={() => void save('status', s)}>{s === 'open' ? 'Open' : 'Closed'}</button>)}</div>
        <button type="button" className="btn" onClick={async () => { await createTask({ title: it.text.slice(0, 120), project_id: project.id, kind: project.kind }); toast('Task added'); }}>Make a task</button>
        <button type="button" className="btn" style={{ color: 'var(--danger)' }} onClick={async () => { if (await confirmAction('Move this item to Trash?', { danger: true }) && await govTrash('raid', it.id)) { toast('Moved to Trash'); await reload(); } }}>Trash</button>
      </div>
    </div>
  );
}

export function Raid({ project }: { project: Project }) {
  const { items, offline, reload } = useGov<RaidItem>(project.id, 'raid');
  const [type, setType] = useState<RaidType>('risk');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<RaidType | ''>('');
  const [closed, setClosed] = useState(false);
  const [cell, setCell] = useState<{ p: number; i: number } | null>(null);
  const openRisks = items.filter((x) => x.type === 'risk' && x.status === 'open' && x.probability && x.impact);
  const shown = items.filter((x) => (!filter || x.type === filter) && (closed || x.status === 'open') && (!cell || (x.type === 'risk' && x.status === 'open' && x.probability === cell.p && x.impact === cell.i)));
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await govCreate<RaidItem>(project.id, 'raid', { type, text: text.trim() })) { setText(''); await reload(); }
  };
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {offline && <div className="sub" role="status">Offline: showing the last copy. Changes need a connection.</div>}
      <form className="row" onSubmit={add}>
        <select className="field" style={{ width: 'auto' }} aria-label="Type" value={type} onChange={(e) => setType(e.target.value as RaidType)}>{TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select>
        <input className="field" style={{ flex: '1 1 240px', width: 'auto' }} aria-label="New RAID item" placeholder="Describe the risk, assumption, issue or dependency…" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn primary" disabled={!text.trim()}>Add</button>
      </form>
      <div className="row">
        {(['', ...TYPES] as const).map((t) => <button type="button" key={t} className={`chip ${filter === t ? 'on' : ''}`} aria-pressed={filter === t} onClick={() => setFilter(t)}>{t || 'All'}</button>)}
        <label className="sub tap" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} style={{ accentColor: 'var(--accent)' }} /> Show closed</label>
      </div>
      <div className="two">
        <div style={{ display: 'grid', gap: 10 }}>
          {shown.map((it) => <Row key={it.id} it={it} project={project} reload={reload} />)}
          {!shown.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>{items.length ? 'Nothing matches.' : 'No RAID items yet.'}</p>}
        </div>
        <div className="card scroll-x"><b style={{ fontSize: 14 }}>Open risks</b>
          <div className="heat" role="group" aria-label="Risk heat grid" style={{ marginTop: 10 }}>
            {[5, 4, 3, 2, 1].map((p) => <Fragment key={p}>
              <span>P{p}</span>
              {N15.map((i) => { const n = openRisks.filter((x) => x.probability === p && x.impact === i).length, tone = scoreTone(p * i);
                return <button type="button" key={`${p}${i}`} className={`${tone === 'danger' ? 'd' : tone === 'warn' ? 'w' : ''}${n ? ' has' : ''}`} aria-pressed={cell?.p === p && cell?.i === i} aria-label={`Probability ${p}, impact ${i}: ${n} open`}
                  onClick={() => setCell(cell?.p === p && cell?.i === i ? null : { p, i })}>{n || ''}</button>; })}
            </Fragment>)}
            <span />{N15.map((i) => <span key={i} style={{ textAlign: 'center' }}>I{i}</span>)}
          </div>
          <div className="sub" style={{ marginTop: 8 }}>Impact across, probability up. Tap a cell to filter.</div>
        </div>
      </div>
    </div>
  );
}
