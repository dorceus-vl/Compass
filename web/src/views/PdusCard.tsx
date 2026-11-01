import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { CardHead } from '../ui/CardHead.tsx';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import type { CertRow, PduRow } from '../../../shared/types.ts';

const CATEGORIES = ['Ways of Working', 'Power Skills', 'Business Acumen', 'Giving Back', 'Education'];
const today = () => new Date().toLocaleDateString('en-CA');
const daysLeft = (end: string) => Math.ceil((Date.parse(end) - Date.parse(today())) / 86_400_000);

/** Settings → PDUs: each certification cycle with the PDUs earned inside it. Add and remove in place; needs a connection. */
export function PdusCard() {
  const [data, setData] = useState<{ certs: CertRow[]; pdus: PduRow[] } | null | undefined>(undefined); // undefined: loading, null: no connection
  const [cert, setCert] = useState({ name: '', cycle_start: today(), cycle_end: '', required: '60' });
  const [pdu, setPdu] = useState({ title: '', category: CATEGORIES[0], hours: '1', earned_on: today() });
  const load = () => api<{ certs: CertRow[]; pdus: PduRow[] }>('/pdus').then(setData).catch(() => setData(null));
  useEffect(() => { void load(); }, []);
  const send = async (path: string, json: unknown, ok: string) => {
    try { await api(path, { method: 'POST', json }); toast(ok); await load(); return true; }
    catch (e) { toast((e as Error).message === 'pdu_limit' ? 'You have 1000 PDUs; delete some first' : (e as Error).message || 'Could not save'); return false; }
  };
  const remove = async (path: string, what: string) => {
    if (!(await confirmAction(`Delete ${what}? It stays in Trash for 30 days.`, { danger: true }))) return;
    try { await api(path, { method: 'DELETE' }); toast('Deleted'); await load(); } catch (e) { toast((e as Error).message || 'Could not delete'); }
  };
  if (data === undefined) return null;
  if (data === null) return <div className="card"><CardHead icon="doc" title="PDUs" desc="Certification renewal." /><small className="sub">Needs a connection.</small></div>;
  return (
    <div className="card">
      <CardHead icon="doc" title="PDUs" desc="Hours earned toward each certification renewal cycle." />
      {data.certs.map((c) => {
        const mine = data.pdus.filter((p) => p.cert_id === c.id), got = mine.filter((p) => p.earned_on >= c.cycle_start && p.earned_on <= c.cycle_end).reduce((n, p) => n + p.hours, 0);
        const left = daysLeft(c.cycle_end);
        return (
          <section key={c.id} className="stack" aria-label={c.name}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{c.name}</b>
              <button type="button" className="btn" style={{ color: 'var(--danger)', minHeight: 44 }} onClick={() => remove(`/pdus/certs/${c.id}`, `${c.name} and its PDUs`)}>Delete</button>
            </div>
            <progress max={c.required} value={Math.min(got, c.required)} aria-label={`${got} of ${c.required} PDUs`} style={{ width: '100%' }} />
            <small className="sub">{got} of {c.required} PDUs · {left >= 0 ? `${left} days left (ends ${c.cycle_end})` : `cycle ended ${c.cycle_end}`}{got >= c.required ? ' · done' : ''}</small>
            {mine.map((p) => (
              <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{p.title} <small className="sub">{p.category} · {p.hours} h · {p.earned_on}</small></span>
                <button type="button" className="btn" style={{ minHeight: 44, minWidth: 44 }} aria-label={`Delete ${p.title}`} onClick={() => remove(`/pdus/${p.id}`, `"${p.title}"`)}>✕</button>
              </div>))}
            <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await send('/pdus', { ...pdu, cert_id: c.id, hours: Number(pdu.hours) }, 'PDU added')) setPdu({ ...pdu, title: '' }); }}>
              <input className="field" aria-label="PDU title" placeholder="What you did" maxLength={160} required value={pdu.title} onChange={(e) => setPdu({ ...pdu, title: e.target.value })} />
              <input className="field" aria-label="Category" list="pdu-cats" maxLength={60} required value={pdu.category} onChange={(e) => setPdu({ ...pdu, category: e.target.value })} />
              <input className="field" aria-label="Hours" type="number" min="0.25" max="100" step="0.25" required value={pdu.hours} onChange={(e) => setPdu({ ...pdu, hours: e.target.value })} style={{ width: 80 }} />
              <input className="field" aria-label="Date earned" type="date" required value={pdu.earned_on} onChange={(e) => setPdu({ ...pdu, earned_on: e.target.value })} />
              <button className="btn primary" style={{ minHeight: 44 }}>Add PDU</button>
            </form>
          </section>);
      })}
      <datalist id="pdu-cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await send('/pdus/certs', { ...cert, required: Number(cert.required) }, 'Certification added')) setCert({ ...cert, name: '', cycle_end: '' }); }}>
        <input className="field" aria-label="Certification" placeholder="Certification (PMP)" maxLength={80} required value={cert.name} onChange={(e) => setCert({ ...cert, name: e.target.value })} />
        <input className="field" aria-label="Cycle start" type="date" required value={cert.cycle_start} onChange={(e) => setCert({ ...cert, cycle_start: e.target.value })} />
        <input className="field" aria-label="Cycle end" type="date" required value={cert.cycle_end} onChange={(e) => setCert({ ...cert, cycle_end: e.target.value })} />
        <input className="field" aria-label="PDUs required" type="number" min="1" max="1000" step="0.25" required value={cert.required} onChange={(e) => setCert({ ...cert, required: e.target.value })} style={{ width: 80 }} />
        <button className="btn primary" style={{ minHeight: 44 }}>Add certification</button>
      </form>
    </div>
  );
}
