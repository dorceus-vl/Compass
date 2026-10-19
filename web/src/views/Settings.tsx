import { useEffect, useState, type ReactElement } from 'react';
import type { Settings, Status } from '../../../shared/types.ts';
import { api, logout, online } from '../api.ts';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import { Link } from '../router.ts';
import { idb } from '../store/db.ts';
import { replay } from '../store/sync.ts';

export function SettingsView({ onSignedOut }: { onSignedOut: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { api<Settings>('/settings').then(setS).catch(() => toast('Settings need a connection')); }, []);
  if (!s) return null;
  const save = async (patch: Partial<Settings>) => {
    try { setS(await api<Settings>('/settings', { method: 'PATCH', json: patch })); toast('Saved'); }
    catch (e) { toast((e as Error).message || 'Settings need a connection'); }
  };
  const signOut = async () => {
    if (online()) await replay().catch(() => {});
    const left = (await idb.all('queue')).length;
    if (left > 0 && !(await confirmAction(`${left} changes haven't synced yet. Sign out and discard them?`, { danger: true }))) return;
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
        {row('Quiet hours from', <input className="field" type="time" value={s.quiet_from} onChange={(e) => save({ quiet_from: e.target.value })} />)}
        {row('Quiet hours to', <input className="field" type="time" value={s.quiet_to} onChange={(e) => save({ quiet_to: e.target.value })} />)}
        {row('Weekly review on', <select className="field" value={s.weekly_review_day} onChange={(e) => save({ weekly_review_day: Number(e.target.value) })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select>)}
        {row('Time zone', <input className="field" defaultValue={s.tz} onBlur={(e) => e.target.value !== s.tz && save({ tz: e.target.value })} />)}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Board limits (work in progress)</div>
        {(['new', 'progress', 'hold', 'waiting'] as Status[]).map((k) => row(k, <input className="field" type="number" min={1} max={99} placeholder="none" value={s.wip_limits[k] ?? ''} onChange={(e) => save({ wip_limits: { ...s.wip_limits, [k]: e.target.value === '' ? null : Number(e.target.value) } })} />))}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Saved views</div>
        {s.saved_views.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Save one from List.</p>}
        {s.saved_views.map((v) => row(`${v.name} · ${v.query}`, <button type="button" className="btn" onClick={() => save({ saved_views: s.saved_views.filter((x) => x.name !== v.name) })}>Remove</button>))}
      </div>
    </>
  );
}
