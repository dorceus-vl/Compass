import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Settings, Status, PushType } from '../../../shared/types.ts';
import { api, logout, online } from '../api.ts';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import { Link } from '../router.ts';
import { idb } from '../store/db.ts';
import { replay } from '../store/sync.ts';
import { enablePush, disablePush, pushState, thisDeviceId, type PushState } from '../push.ts';
import { Rules } from './Rules.tsx';

type Patch = Partial<Omit<Settings, 'wip_limits' | 'push'>> & { wip_limits?: Partial<Settings['wip_limits']>; push?: Partial<Settings['push']> };
type Save = (patch: Patch) => Promise<void>;
const WIP_LABELS: Partial<Record<Status, string>> = { new: 'New', progress: 'In progress', hold: 'On hold', waiting: 'Waiting on' };

export function SettingsView({ onSignedOut }: { onSignedOut: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const latest = useRef(0); // only the newest request may write state
  useEffect(() => { api<Settings>('/settings').then(setS).catch(() => toast('Settings need a connection')); }, []);
  // Also shown while settings can't load (offline): on a phone this is the only way to the views that have no tab.
  const goTo = (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 6 }}>Go to</div>
      <div className="row"><Link to="/inbox" className="btn">Inbox</Link><Link to="/meetings" className="btn">Meetings</Link><Link to="/review" className="btn">Weekly review</Link><Link to="/list" className="btn">List</Link><Link to="/upcoming" className="btn">Upcoming</Link><Link to="/timeline" className="btn">Timeline</Link><Link to="/trash" className="btn">Trash</Link></div>
    </div>
  );
  if (!s) return goTo;
  // Optimistic: show the change now, send only the changed key (the server merges WIP per status), ignore replies older than the newest request.
  const save = async (patch: Patch) => {
    const n = ++latest.current;
    setS((cur) => cur && { ...cur, ...patch, wip_limits: { ...cur.wip_limits, ...patch.wip_limits }, push: { ...cur.push, ...patch.push } });
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
      {goTo}
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Day</div>
        {row('Day starts at', <select className="field" value={s.day_start_hour} onChange={(e) => save({ day_start_hour: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>{h}:00</option>)}</select>)}
        {row('Daily digest at', <select className="field" value={s.digest_hour} onChange={(e) => save({ digest_hour: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>{h}:00</option>)}</select>)}
        {row('Quiet hours (no notifications) from', <input key={s.quiet_from} className="field" type="time" defaultValue={s.quiet_from} onBlur={(e) => (e.target.value && e.target.value !== s.quiet_from ? save({ quiet_from: e.target.value }) : (e.target.value = s.quiet_from))} />)}
        {row('Quiet hours (no notifications) to', <input key={s.quiet_to} className="field" type="time" defaultValue={s.quiet_to} onBlur={(e) => (e.target.value && e.target.value !== s.quiet_to ? save({ quiet_to: e.target.value }) : (e.target.value = s.quiet_to))} />)}
        {row('Weekly review on', <select className="field" value={s.weekly_review_day} onChange={(e) => save({ weekly_review_day: Number(e.target.value) })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select>)}
        {row('Time zone', <input className="field" defaultValue={s.tz} onBlur={(e) => e.target.value !== s.tz && save({ tz: e.target.value })} />)}
      </div>
      <Notifications s={s} save={save} />
      <Rules />
      <Email s={s} save={save} />
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

const PUSH_LABELS: [PushType, string][] = [['digest', 'Daily digest'], ['overdue', 'Overdue'], ['nudge', 'Waiting-on nudges'], ['milestone', 'Milestones in a week'], ['weekly_review', 'Weekly review'], ['app_task', 'Tasks added by your apps'], ['meeting', 'Meeting notes ready']];
const STATUS_TEXT: Record<PushState, string> = {
  on: 'On for this device.', off: 'Off for this device.', blocked: 'Blocked by the browser. Allow notifications for Compass in the browser or system settings, then come back.',
  'home-screen': 'Add Compass to your Home Screen, then turn notifications on here.', unsupported: 'This browser can\'t receive notifications.',
};
type Device = { id: string; device_name: string | null; created_at: string; last_ok_at: string | null };

function Notifications({ s, save }: { s: Settings; save: Save }) {
  const [state, setState] = useState<PushState | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void pushState().then(setState).catch(() => setState('unsupported'));
    api<{ subscriptions: Device[] }>('/push').then((d) => setDevices(d.subscriptions)).catch(() => {});
  };
  useEffect(refresh, []);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast((e as Error).message || 'Notifications need a connection'); } finally { setBusy(false); refresh(); } };
  const turnOn = () => run(async () => {
    const r = await enablePush();
    toast(r === 'enabled' ? 'Notifications are on' : r === 'denied' ? 'Notifications were not allowed' : 'This device can\'t receive notifications');
  });
  const turnOff = () => run(async () => { await disablePush(); toast('Notifications are off'); });
  const test = () => run(async () => { const { sent } = await api<{ sent: number }>('/push/test', { method: 'POST' }); toast(sent > 0 ? 'Test sent' : 'No device received it'); });
  const remove = (d: Device) => run(async () => {
    if (d.id === thisDeviceId()) await disablePush(); else await api(`/push/${d.id}`, { method: 'DELETE' });
    toast('Device removed');
  });
  const canAsk = state === 'off' || state === 'on';
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 6 }}>Notifications</div>
      <p style={{ margin: '0 0 10px' }} role="status">{state ? STATUS_TEXT[state] : 'Checking...'}</p>
      <div className="row">
        {canAsk && (state === 'on'
          ? <button type="button" className="btn" disabled={busy} onClick={turnOff}>Turn off</button>
          : <button type="button" className="btn primary" disabled={busy} onClick={turnOn}>Turn on</button>)}
        <button type="button" className="btn" disabled={busy || devices.length === 0} onClick={test}>Send a test</button>
      </div>
      {devices.length > 0 && <div style={{ marginTop: 10 }}>
        <div className="eyebrow" style={{ margin: '4px 0' }}>Devices</div>
        {devices.map((d) => (
          <div key={d.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border-soft)', fontSize: 14 }}>
            <span>{d.device_name || 'Unnamed device'}{d.id === thisDeviceId() ? ' (this device)' : ''}</span>
            <button type="button" className="btn" disabled={busy} onClick={() => remove(d)}>Remove</button>
          </div>))}
      </div>}
      <div className="eyebrow" style={{ margin: '14px 0 4px' }}>Send me</div>
      {PUSH_LABELS.map(([k, label]) => (
        <label key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-soft)', fontSize: 14 }}>
          {label}<input type="checkbox" checked={s.push[k]} onChange={(e) => save({ push: { [k]: e.target.checked } })} style={{ width: 20, height: 20, accentColor: 'var(--accent)' }} />
        </label>))}
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>Quiet hours above hold back everything except the test.</p>
    </div>
  );
}

function Email({ s, save }: { s: Settings; save: Save }) {
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  useEffect(() => { api<{ address: string | null }>('/email/address').then((d) => setAddress(d.address)).catch(() => setAddress(undefined)); }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(address!); toast('Copied'); } catch { toast('Copy failed. Select the address and copy it.'); } };
  const add = () => {
    const d = draft.trim().toLowerCase();
    if (!d) return;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) { toast('Use a domain like example.com'); return; }
    if (s.work_email_domains.includes(d)) { setDraft(''); return; }
    if (s.work_email_domains.length >= 10) { toast('Up to 10 domains'); return; }
    setDraft(''); void save({ work_email_domains: [...s.work_email_domains, d] });
  };
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 6 }}>Email</div>
      <div style={{ fontSize: 14, marginBottom: 4 }}>Forward emails to this address to turn them into tasks:</div>
      {address === undefined ? <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Needs a connection.</p>
        : address === null ? <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Not set up yet</p>
        : <>
          <div className="row"><code style={{ fontFamily: 'var(--mono)', fontSize: 13, overflowWrap: 'anywhere' }}>{address}</code><button type="button" className="btn" onClick={copy}>Copy</button></div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>Keep this address private: anyone who knows it and sends from an allowed address can add tasks.</p>
        </>}
      <div style={{ fontSize: 14, margin: '12px 0 0' }}>Allowed senders: <span style={{ color: 'var(--text-dim)' }}>Set in your Compass setup</span></div>
      <div className="eyebrow" style={{ margin: '14px 0 6px' }}>Work email domains</div>
      <div className="row" style={{ marginBottom: 8 }}>
        {s.work_email_domains.length === 0 && <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>None. Email from every domain is personal.</span>}
        {s.work_email_domains.map((d) => <span key={d} className="chip work" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{d}<button type="button" aria-label={`Remove ${d}`} onClick={() => save({ work_email_domains: s.work_email_domains.filter((x) => x !== d) })} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit' }}>x</button></span>)}
      </div>
      <div className="row"><input className="field" style={{ maxWidth: 240 }} placeholder="example.com" value={draft} aria-label="Add a work email domain" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /><button type="button" className="btn" onClick={add}>Add domain</button></div>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>Email from these domains becomes a work task.</p>
    </div>
  );
}
