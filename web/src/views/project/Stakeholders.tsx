import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Project } from '../../../../shared/types.ts';
import { ATTITUDES, QUADRANTS, STAKEHOLDER_DAYS, draftSeed, dueText, nextDue, quadrant, quadrantLabel, type Attitude, type Level, type Stakeholder } from '../../../../shared/stakeholders.ts';
import { useGov, govCreate, govPatch, govTrash, markContacted } from '../../gov.ts';
import { confirmAction, toast } from '../../ui/dialogs.tsx';
import { navigate } from '../../router.ts';
import { todayIn } from '../../dates.ts';
import { ASK_KEY } from '../Athena.tsx';
import { useTz } from './Report.tsx';

const ATT: Record<Attitude, string> = { supportive: 'Supportive', neutral: 'Neutral', resistant: 'Resistant' };
// A word and a shape, so the attitude is never colour alone: a tick, a dash, a cross in a circle.
const ATT_PATH: Record<Attitude, string> = { supportive: 'M8 12.5l2.7 2.7L16 9.5', neutral: 'M8.5 12h7', resistant: 'M9 9l6 6M15 9l-6 6' };
const ATT_COLOR: Record<Attitude, string> = { supportive: 'var(--ok)', neutral: 'var(--text-dim)', resistant: 'var(--danger)' };
function AttIcon({ a }: { a: Attitude }) {
  return <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d={ATT_PATH[a]} /></svg>;
}
const Att = ({ a }: { a: Attitude }) => <span className="sh-att" style={{ color: ATT_COLOR[a] }}><AttIcon a={a} />{ATT[a]}</span>;
const LEVEL = (l: Level) => (l === 'high' ? 'High' : 'Low');

/** Add or edit one stakeholder in a dialog. The server checks everything again; the same limits are on the inputs. */
function Edit({ project, item, onClose, onSaved }: { project: Project; item: Stakeholder | null; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState({ name: item?.name ?? '', role: item?.role ?? '', power: item?.power ?? 'low', interest: item?.interest ?? 'low', attitude: item?.attitude ?? 'neutral', channel: item?.channel ?? '', cadence: item?.cadence_days ? String(item.cadence_days) : '', notes: item?.notes ?? '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || busy) return;
    setBusy(true);
    const body = { name: f.name.trim(), role: f.role.trim() || null, power: f.power, interest: f.interest, attitude: f.attitude, channel: f.channel.trim() || null, cadence_days: f.cadence.trim() ? Number(f.cadence) : null, notes: f.notes.trim() || null };
    const ok = item ? await govPatch('stakeholders', item.id, body) : await govCreate(project.id, 'stakeholders', body);
    setBusy(false);
    if (!ok) return;
    toast(item ? 'Saved' : 'Stakeholder added');
    onSaved();
    ref.current?.close();
  };
  const seg = <K extends 'power' | 'interest'>(k: K, label: string) => (
    <div className="qf" role="group" aria-label={label}>{label}
      <div className="seg">{(['high', 'low'] as const).map((l) => <button type="button" key={l} className={f[k] === l ? 'on' : ''} aria-pressed={f[k] === l} onClick={() => set(k, l)}>{LEVEL(l)}</button>)}</div></div>
  );
  return (
    <dialog ref={ref} className="tpl-dlg" aria-labelledby="sh-dlg-h" onClose={onClose}>
      <form onSubmit={submit} className="tpl-form sh-form">
        <b id="sh-dlg-h">{item ? 'Edit stakeholder' : 'Add stakeholder'}</b>
        <label className="qf">Name<input className="field" autoFocus required maxLength={120} value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="qf">Role<input className="field" maxLength={120} value={f.role} onChange={(e) => set('role', e.target.value)} /></label>
        <div className="row sh-segs">{seg('power', 'Power')}{seg('interest', 'Interest')}</div>
        <div className="qf" role="group" aria-label="Attitude">Attitude
          <div className="seg">{ATTITUDES.map((a) => <button type="button" key={a} className={f.attitude === a ? 'on' : ''} aria-pressed={f.attitude === a} onClick={() => set('attitude', a)}>{ATT[a]}</button>)}</div></div>
        <div className="row sh-segs">
          <label className="qf" style={{ flex: '1 1 160px' }}>Channel<input className="field" maxLength={60} placeholder="Email, call, weekly sync" value={f.channel} onChange={(e) => set('channel', e.target.value)} /></label>
          <label className="qf" style={{ flex: '1 1 160px' }}>Update every (days)<input className="field" type="number" inputMode="numeric" min={STAKEHOLDER_DAYS.min} max={STAKEHOLDER_DAYS.max} step={1} placeholder="No plan" value={f.cadence} onChange={(e) => set('cadence', e.target.value)} /></label>
        </div>
        <label className="qf">Notes<textarea className="field" rows={3} maxLength={2000} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn primary" disabled={busy || !f.name.trim()}>Save</button>
        </div>
      </form>
    </dialog>
  );
}

export function Stakeholders({ project }: { project: Project }) {
  const { items, athena, offline, loaded, reload } = useGov<Stakeholder>(project.id, 'stakeholders');
  const tz = useTz(), today = todayIn(tz);
  const [view, setView] = useState<'grid' | 'list'>(() => (matchMedia('(max-width:760px)').matches ? 'list' : 'grid')); // a phone gets the list first
  const [edit, setEdit] = useState<Stakeholder | 'new' | null>(null);
  const due = (s: Stakeholder) => nextDue(s.last_contact_at, s.cadence_days, today, tz);
  const sent = async (s: Stakeholder) => { if (await markContacted(s.id)) { toast('Marked as sent'); await reload(); } };
  const trash = async (s: Stakeholder) => { if (await confirmAction(`Move ${s.name} to Trash?`, { danger: true }) && await govTrash('stakeholders', s.id)) { toast('Moved to Trash'); await reload(); } };
  const draft = (s: Stakeholder) => {
    try { sessionStorage.setItem(ASK_KEY, draftSeed(s, project, project.kind)); } catch { /* storage off: Athena opens with an empty box */ }
    navigate(`/athena?agenda=${encodeURIComponent(project.id)}`); // the question rides in sessionStorage, never the URL
  };
  const lastText = (s: Stakeholder) => (s.last_contact_at ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(s.last_contact_at)) : 'Never');
  const draftCell = (s: Stakeholder) => athena ? <button type="button" className="btn" onClick={() => draft(s)}>Draft update</button> : <span className="sub">Offline only: write it yourself</span>;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {offline && <div className="sub" role="status">Offline: showing the last copy. Changes need a connection.</div>}
      <div className="row">
        <div className="seg" role="group" aria-label="View">{(['grid', 'list'] as const).map((v) => <button type="button" key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'grid' ? 'Grid' : 'List'}</button>)}</div>
        <button type="button" className="btn primary" style={{ marginLeft: 'auto' }} disabled={offline} onClick={() => setEdit('new')}>Add stakeholder</button>
      </div>
      {loaded && !items.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>No stakeholders yet. Add the people who care about this project, how much say they have and how often they need an update.</p>}
      {view === 'grid' && items.length > 0 && (
        <div className="sh-grid">
          <div className="sh-axis" aria-hidden="true">Power up · Interest across</div>
          {QUADRANTS.map((q) => {
            const mine = items.filter((s) => quadrant(s.power, s.interest) === q.id);
            return (
              <section key={q.id} className="card sh-quad" aria-label={`${q.label}, ${mine.length}`}>
                <div className="sh-qh"><b>{q.label}</b><span className="sub">{q.hint}</span></div>
                <div className="sh-chips">
                  {mine.map((s) => <button type="button" key={s.id} className="sh-chip" disabled={offline} onClick={() => setEdit(s)} aria-label={`${s.name}, ${s.role ? `${s.role}, ` : ''}${ATT[s.attitude]}. Edit`}>
                    <span className="sh-nm">{s.name}</span><Att a={s.attitude} /></button>)}
                  {!mine.length && <span className="sub">Nobody here.</span>}
                </div>
              </section>);
          })}
        </div>
      )}
      {view === 'list' && items.length > 0 && (
        <div className="scroll-x"><table className="sh-table">
          <thead><tr><th>Name</th><th>Role</th><th>Priority</th><th>Channel</th><th>Cadence</th><th>Last contact</th><th>Next due</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{items.map((s) => { const d = due(s), t = dueText(d, today); return (
            <tr key={s.id}>
              <th scope="row" data-label="Name"><span className="sh-nm">{s.name}</span><Att a={s.attitude} /></th>
              <td data-label="Role">{s.role || '–'}</td>
              <td data-label="Priority">{quadrantLabel(s.power, s.interest)}</td>
              <td data-label="Channel">{s.channel || '–'}</td>
              <td data-label="Cadence">{s.cadence_days ? `Every ${s.cadence_days} day${s.cadence_days === 1 ? '' : 's'}` : 'No plan'}</td>
              <td data-label="Last contact">{lastText(s)}</td>
              <td data-label="Next due"><span className={`chip ${t === 'Due now' ? 'over' : ''}`}>{t}</span></td>
              <td className="sh-acts"><button type="button" className="btn" disabled={offline} onClick={() => void sent(s)}>Mark sent</button>{draftCell(s)}
                <button type="button" className="btn" disabled={offline} onClick={() => setEdit(s)}>Edit</button>
                <button type="button" className="btn" style={{ color: 'var(--danger)' }} disabled={offline} onClick={() => void trash(s)}>Trash</button></td>
            </tr>); })}</tbody>
        </table></div>
      )}
      {edit && <Edit key={edit === 'new' ? 'new' : edit.id} project={project} item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => void reload()} />}
    </div>
  );
}
