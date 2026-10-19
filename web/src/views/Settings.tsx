import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Settings, Status } from '../../../shared/types.ts';
import { api, logout, online } from '../api.ts';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import { Link } from '../router.ts';
import { idb } from '../store/db.ts';
import { replay } from '../store/sync.ts';

type Patch = Partial<Omit<Settings, 'wip_limits'>> & { wip_limits?: Partial<Settings['wip_limits']> };
const WIP_LABELS: Partial<Record<Status, string>> = { new: 'New', progress: 'In progress', hold: 'On hold', waiting: 'Waiting on' };

export function SettingsView({ onSignedOut }: { onSignedOut: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const latest = useRef(0); // only the newest request may write state
  useEffect(() => { api<Settings>('/settings').then(setS).catch(() => toast('Settings need a connection')); }, []);
  if (!s) return null;
  // Optimistic: show the change now, send only the changed key (the server merges WIP per status), ignore replies older than the newest request.
  const save = async (patch: Patch) => {
    const n = ++latest.current;
    setS((cur) => cur && { ...cur, ...patch, wip_limits: { ...cur.wip_limits, ...patch.wip_limits } });
    try {
      const next = await api<Settings>('/settings', { method: 'PATCH', json: patch });
      if (n === latest.current) { setS(next); toast('Saved'); }
    } catch (e) {
      toast((e as Error).message || 'Settings need a connection');
      if (n === latest.current) api<Settings>('/settings').then(setS).catch(() => {}); // drop the optimistic value
    }
  };
  const signOut = async () => {
    if (online()) await replay().catch(() => {});
    const left = (await idb.all('queue')).length;
    if (left > 0 && !(await confirmAction(`${left === 1 ? '1 change hasn\'t' : `${left} changes haven't`} synced yet. Sign out and discard them?`, { danger: true }))) return;
    await logout().catch(() => {});
    await Promise.all((['tasks', 'projects', 'milestones', 'meta', 'queue'] as const).map((st) => idb.clear(st)));
    onSignedOut();
  };
  const row = (label: string, el: ReactElement) => <label key={label} style={{ display: 'grid', gridTemplateColumns: '1fr 200px', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-soft)', fontSize: 14 }}>{label}{el}</label>;
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return (
    <>
      <div className="head"><div><div className="eyebrow">Settings</div><h1 style={{ marginTop: 6 }}>Make it <b>yours</b></h1></div>
        <div className="row"><a className="btn" href="https://id.knocturnlabs.com/" target="_blank" rel="noopener">Manage your Knocturn ID ↗</a><Link to="/trash" className="btn">Trash</Link>
          <button type="button" className="btn" onClick={signOut}>Sign out</button></div></div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Day</div>
        {row('Day starts at', <select className="field" value={s.day_start_hour} onChange={(e) => save({ day_start_hour: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>{h}:00</option>)}</select>)}
        {row('Daily digest at (Phase 2)', <select className="field" value={s.digest_hour} onChange={(e) => save({ digest_hour: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>{h}:00</option>)}</select>)}
        {row('Quiet hours from', <input key={s.quiet_from} className="field" type="time" defaultValue={s.quiet_from} onBlur={(e) => (e.target.value && e.target.value !== s.quiet_from ? save({ quiet_from: e.target.value }) : (e.target.value = s.quiet_from))} />)}
        {row('Quiet hours to', <input key={s.quiet_to} className="field" type="time" defaultValue={s.quiet_to} onBlur={(e) => (e.target.value && e.target.value !== s.quiet_to ? save({ quiet_to: e.target.value }) : (e.target.value = s.quiet_to))} />)}
        {row('Weekly review on', <select className="field" value={s.weekly_review_day} onChange={(e) => save({ weekly_review_day: Number(e.target.value) })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select>)}
        {row('Time zone', <input className="field" defaultValue={s.tz} onBlur={(e) => e.target.value !== s.tz && save({ tz: e.target.value })} />)}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Board limits (work in progress)</div>
        {(['new', 'progress', 'hold', 'waiting'] as Status[]).map((k) => row(WIP_LABELS[k]!, <input key={`${k}:${s.wip_limits[k]}`} className="field" type="number" min={1} max={99} placeholder="none" defaultValue={s.wip_limits[k] ?? ''} onBlur={(e) => {
          const v = e.target.value === '' ? null : Number(e.target.value);
          if (v === (s.wip_limits[k] ?? null)) return;
          if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 99)) { toast('Use a whole number from 1 to 99'); e.target.value = String(s.wip_limits[k] ?? ''); return; }
          void save({ wip_limits: { [k]: v } });
        }} />))}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Saved views</div>
        {s.saved_views.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Save one from List.</p>}
        {s.saved_views.map((v) => row(`${v.name} · ${v.query}`, <button type="button" className="btn" onClick={() => save({ saved_views: s.saved_views.filter((x) => x.name !== v.name) })}>Remove</button>))}
      </div>
    </>
  );
}
