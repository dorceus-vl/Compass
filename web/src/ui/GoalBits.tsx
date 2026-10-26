import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { Confidence, KeyResult, Kind, KrType } from '../../../shared/types.ts';
import { currentQuarter, quarterRange, isBehind, MAX_NOTE, MAX_TITLE } from '../../../shared/goals.ts';
import { addGoal, addKr, checkIn } from '../store/useStore.ts';
import { navigate } from '../router.ts';
import { toast } from './dialogs.tsx';

// v2.6 goals: the bar, the confidence dot, the trend line and the three dialogs (create goal, add key result, check in).
export const CONF_LABEL: Record<Confidence, string> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
type Q = { year: number; q: 1 | 2 | 3 | 4 };
/** The quarter `n` steps from `c` (negative goes back). */
export function shiftQuarter(c: Q, n: number): Q {
  const i = c.year * 4 + (c.q - 1) + n;
  return { year: Math.floor(i / 4), q: ((i % 4) + 1) as Q['q'] };
}

/** Progress with the expected marker (G10). `exp` null (a closed goal): no marker and never "Behind". The word, not colour alone, says behind. */
export function GoalBar({ progress, exp, label }: { progress: number; exp: number | null; label: string }) {
  const pct = Math.round(progress * 100), e = exp === null ? null : Math.round(exp * 100), behind = exp !== null && isBehind(progress, exp);
  return (
    <div className="gl-barrow">
      <div className="gl-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-valuetext={`${pct}% done${e === null ? '' : `, ${e}% expected by today`}${behind ? ', behind' : ''}`}>
        <i style={{ '--p': progress } as CSSProperties} />
        {e !== null && <b aria-hidden="true" style={{ left: `${e}%` }} />}
      </div>
      <span className="mono gl-pct">{pct}%</span>
      {behind && <span className="chip warn">Behind</span>}
    </div>
  );
}

export function ConfDot({ c, title }: { c: Confidence | null; title: string }) {
  const text = `${title}: ${c ? CONF_LABEL[c] : 'no check-in yet'}`;
  return <span className={`gl-dot ${c ?? 'none'}`} role="img" aria-label={text} title={text} />;
}

/** Plain SVG polyline of `trend()` points; nothing under two points. */
export function TrendLine({ points, label }: { points: { at: string; value: number }[]; label: string }) {
  if (points.length < 2) return null;
  const W = 240, H = 48, P = 4;
  const xs = points.map((p) => Date.parse(p.at)), ys = points.map((p) => p.value);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const x = (t: number) => P + (x1 === x0 ? 0 : ((t - x0) / (x1 - x0)) * (W - 2 * P));
  const y = (v: number) => (y1 === y0 ? H / 2 : H - P - ((v - y0) / (y1 - y0)) * (H - 2 * P));
  const pts = points.map((p, i) => `${x(xs[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg className="gl-trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${points.length} check-ins, from ${ys[0]} to ${ys.at(-1)}`}>
      <polyline points={pts} />
    </svg>
  );
}

/** Mounted while open; `onClose` runs on Cancel, Escape or after saving. */
function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return ref;
}
const Actions = ({ close, busy, label }: { close: () => void; busy: boolean; label: string }) => (
  <div className="row gl-acts"><button type="button" className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={busy}>{label}</button></div>
);

export function CheckInDialog({ kr, last, onClose }: { kr: KeyResult; last: Confidence | null; onClose: () => void }) {
  const ref = useModal(), close = () => ref.current?.close();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const raw = String(f.get('value') ?? '');
    const value = kr.type === 'tasks' ? null : kr.type === 'done' ? (f.get('done') ? 1 : 0) : Number(raw);
    if (value !== null && (!Number.isFinite(value) || (kr.type !== 'done' && raw.trim() === ''))) { toast('Enter a value'); return; }
    setBusy(true);
    try { await checkIn(kr.id, { value, confidence: f.get('confidence') as Confidence, note: String(f.get('note') ?? '').trim() || null }); close(); }
    finally { setBusy(false); }
  };
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="ci-h" className="gl-dlg">
      <form onSubmit={submit} className="gl-form"><b id="ci-h">Check in: {kr.title}</b>
        {kr.type === 'number' && <label className="qf">Value{kr.unit ? ` (${kr.unit})` : ''}<input className="field" name="value" type="number" step="any" required defaultValue={kr.current_value ?? ''} autoFocus /></label>}
        {kr.type === 'percent' && <label className="qf">Percent done<input className="field" name="value" type="number" min={0} max={100} step="any" required defaultValue={kr.current_value ?? 0} autoFocus /></label>}
        {kr.type === 'done' && <label className="tap"><input type="checkbox" name="done" defaultChecked={kr.current_value === 1} /> Done</label>}
        {kr.type === 'tasks' && <p className="hint">Progress comes from the linked tasks; this check-in records confidence and a note.</p>}
        <fieldset className="gl-conf"><legend className="qf">Confidence</legend>
          {(Object.keys(CONF_LABEL) as Confidence[]).map((c) => <label key={c} className="tap"><input type="radio" name="confidence" value={c} defaultChecked={c === (last ?? 'on_track')} /> <span className={`gl-dot ${c}`} aria-hidden="true" />{CONF_LABEL[c]}</label>)}
        </fieldset>
        <label className="qf">Note (optional)<textarea className="field" name="note" rows={3} maxLength={MAX_NOTE} /></label>
        <Actions close={close} busy={busy} label="Check in" />
      </form>
    </dialog>
  );
}

export function NewGoalDialog({ today, onClose }: { today: string; onClose: () => void }) {
  const ref = useModal(), close = () => ref.current?.close();
  const quarters = [0, 1, 2, 3].map((n) => shiftQuarter(currentQuarter(today), n));
  const [range, setRange] = useState(quarterRange(quarters[0].year, quarters[0].q));
  const [busy, setBusy] = useState(false);
  const ok = YMD.test(range.starts_on) && YMD.test(range.ends_on) && range.starts_on <= range.ends_on;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!ok) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const id = await addGoal({ kind: (f.get('kind') === 'work' ? 'work' : 'personal') as Kind, title: String(f.get('title')).trim(), ...range });
      close(); navigate(`/goals/${id}`);
    } finally { setBusy(false); }
  };
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="ng-h" className="gl-dlg">
      <form onSubmit={submit} className="gl-form"><b id="ng-h">New goal</b>
        <input className="field" name="title" placeholder="What do you want to achieve?" aria-label="Title" required maxLength={MAX_TITLE} autoFocus />
        <select className="field" name="kind" aria-label="Kind"><option value="personal">Personal</option><option value="work">Work (encrypted)</option></select>
        <label className="qf">Quarter<select className="field" defaultValue="0" onChange={(e) => { const c = quarters[+e.target.value]; if (c) setRange(quarterRange(c.year, c.q)); }}>
          {quarters.map((c, i) => <option key={i} value={i}>Q{c.q} {c.year}</option>)}</select></label>
        <div className="row gl-dates">
          <label className="qf">Starts<input className="field" type="date" required value={range.starts_on} onChange={(e) => setRange({ ...range, starts_on: e.target.value })} /></label>
          <label className="qf">Ends<input className="field" type="date" required value={range.ends_on} onChange={(e) => setRange({ ...range, ends_on: e.target.value })} /></label>
        </div>
        {!ok && <p className="sub" role="note">Pick a start date on or before the end date.</p>}
        <Actions close={close} busy={busy || !ok} label="Create" />
      </form>
    </dialog>
  );
}

const TYPE_LABEL: Record<KrType, string> = { number: 'A number (from → to)', percent: 'A percentage', done: 'Done or not', tasks: 'Linked tasks done' };
export function NewKrDialog({ goalId, onClose }: { goalId: string; onClose: () => void }) {
  const ref = useModal(), close = () => ref.current?.close();
  const [type, setType] = useState<KrType>('number');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const title = String(f.get('title')).trim();
    if (type === 'number') {
      const s = Number(f.get('start')), t = Number(f.get('target'));
      if (!Number.isFinite(s) || !Number.isFinite(t) || s === t) { toast('Start and target must be different numbers'); return; }
      setBusy(true);
      try { await addKr(goalId, { title, type, start_value: s, target_value: t, unit: String(f.get('unit') ?? '').trim() || null }); close(); } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try { await addKr(goalId, { title, type }); close(); } finally { setBusy(false); }
  };
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="nk-h" className="gl-dlg">
      <form onSubmit={submit} className="gl-form"><b id="nk-h">Add key result</b>
        <input className="field" name="title" placeholder="How will you measure it?" aria-label="Title" required maxLength={MAX_TITLE} autoFocus />
        <label className="qf">Measured as<select className="field" value={type} onChange={(e) => setType(e.target.value as KrType)}>
          {(Object.keys(TYPE_LABEL) as KrType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
        {type === 'number' && <div className="row gl-dates">
          <label className="qf">Start<input className="field" name="start" type="number" step="any" required defaultValue={0} /></label>
          <label className="qf">Target<input className="field" name="target" type="number" step="any" required /></label>
          <label className="qf">Unit<input className="field" name="unit" maxLength={20} placeholder="km, €, books" /></label>
        </div>}
        <Actions close={close} busy={busy} label="Add" />
      </form>
    </dialog>
  );
}
