import { useEffect, useRef, useState, Fragment, type ReactElement } from 'react';
import { strToU8, zipSync } from 'fflate';
import type { AgentScope, ExportBundle, Provider, Settings, Status, PushType } from '../../../shared/types.ts';
import { api, logout, online } from '../api.ts';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import { Link } from '../router.ts';
import { idb } from '../store/db.ts';
import { replay } from '../store/sync.ts';
import { shell, nativeDevice, setWidgetToken, inWidgetShell } from '../native.ts';
import { clearWidgets, revokeWidgetToken, widgetDeviceName, writeWidgets } from '../widgets.ts';
import { enablePush, disablePush, pushState, thisDeviceId, type PushState } from '../push.ts';
import { Rules } from './Rules.tsx';
import { AthenaCard } from './AthenaCard.tsx';
import { TemplatesCard } from './TemplatesCard.tsx';
import { CardHead } from '../ui/CardHead.tsx';
import { Icon } from '../ui/Shell.tsx';
import { Documents } from './project/Documents.tsx';
import { loadUsage, providerReady, spend, type Usage } from '../copilot.ts';
import { saveBytes } from '../docs/download.ts';
import { exportMarkdown } from '../docs/export-md.ts';
import { SCOPE_LABEL } from '../../../shared/kelly-log.ts';
import { parseEstimate, formatEstimate } from '../../../shared/workload.ts';

type Patch = Partial<Omit<Settings, 'wip_limits' | 'push' | 'workload'>> & { wip_limits?: Partial<Settings['wip_limits']>; push?: Partial<Settings['push']>; workload?: Partial<Omit<Settings['workload'], 'overrides'>> };
type Save = (patch: Patch) => Promise<void>;
const MORE = [['inbox', '/inbox', 'Inbox'], ['meetings', '/meetings', 'Meetings'], ['review', '/review', 'Weekly review'], ['library', '/library', 'Library'], ['knowledge', '/knowledge', 'Knowledge'], ['athena', '/athena', 'Athena'],
  ['list', '/list', 'List'], ['upcoming', '/upcoming', 'Upcoming'], ['calendar', '/calendar', 'Calendar'], ['bars', '/workload', 'Workload'], ['timeline', '/timeline', 'Timeline'], ['trash', '/trash', 'Trash']] as const;
const WIP_LABELS: Partial<Record<Status, string>> = { new: 'New', progress: 'In progress', hold: 'On hold', waiting: 'Waiting on' };

export function SettingsView({ onSignedOut }: { onSignedOut: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const latest = useRef(0); // only the newest request may write state
  useEffect(() => { api<Settings>('/settings').then(setS).catch(() => toast('Settings need a connection')); }, []);
  // Also shown while settings can't load (offline): on a phone this is the only way to the views that have no tab.
  const goTo = (
    <nav className="more-list" aria-label="More">
      {MORE.map(([icon, to, label]) => <Link key={to} to={to} className="more-row"><span className="secico"><Icon name={icon} /></span><span>{label}</span><span className="chev"><Icon name="chevron" /></span></Link>)}
    </nav>
  );
  if (!s) return goTo;
  // Optimistic: show the change now, send only the changed key (the server merges WIP per status), ignore replies older than the newest request.
  const save = async (patch: Patch) => {
    const n = ++latest.current;
    setS((cur) => cur && { ...cur, ...patch, wip_limits: { ...cur.wip_limits, ...patch.wip_limits }, push: { ...cur.push, ...patch.push }, workload: { ...cur.workload, ...patch.workload } });
    try {
      const next = await api<Settings>('/settings', { method: 'PATCH', json: patch });
      if (n === latest.current) { setS(next); toast('Saved'); }
      if (patch.widgets) void writeWidgets().catch(() => {}); // the privacy switch reaches the widgets now, not at the next foreground
    } catch (e) {
      toast((e as Error).message || 'Settings need a connection');
      if (n === latest.current) api<Settings>('/settings').then(setS).catch(() => {}); // drop the optimistic value
    }
  };
  const signOut = async () => {
    if (online()) await replay().catch(() => {});
    const left = (await idb.all('queue')).length;
    if (left > 0 && !(await confirmAction(`${left === 1 ? '1 change hasn\'t' : `${left} changes haven't`} synced yet. Sign out and discard them?`, { danger: true }))) return;
    await revokeWidgetToken(); // before the session ends; the Settings switch is derived from the server's list, so it reads off after the next sign-in
    await logout().catch(() => {});
    await clearWidgets();
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
        <CardHead icon="today" title="Day" desc="When your day starts, the digest goes out and the week gets reviewed." />
        {row('Day starts at', <select className="field" value={s.day_start_hour} onChange={(e) => save({ day_start_hour: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>{h}:00</option>)}</select>)}
        {row('Daily digest at', <select className="field" value={s.digest_hour} onChange={(e) => save({ digest_hour: Number(e.target.value) })}>{hours.map((h) => <option key={h} value={h}>{h}:00</option>)}</select>)}
        {row('Quiet hours (no notifications) from', <input key={s.quiet_from} className="field" type="time" defaultValue={s.quiet_from} onBlur={(e) => (e.target.value && e.target.value !== s.quiet_from ? save({ quiet_from: e.target.value }) : (e.target.value = s.quiet_from))} />)}
        {row('Quiet hours (no notifications) to', <input key={s.quiet_to} className="field" type="time" defaultValue={s.quiet_to} onBlur={(e) => (e.target.value && e.target.value !== s.quiet_to ? save({ quiet_to: e.target.value }) : (e.target.value = s.quiet_to))} />)}
        {row('Weekly review on', <select className="field" value={s.weekly_review_day} onChange={(e) => save({ weekly_review_day: Number(e.target.value) })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select>)}
        {row('Time zone', <input className="field" defaultValue={s.tz} onBlur={(e) => e.target.value !== s.tz && save({ tz: e.target.value })} />)}
      </div>
      <WorkloadCard s={s} save={save} />
      <Notifications s={s} save={save} />
      <Rules />
      <Email s={s} save={save} />
      <Ai s={s} save={save} />
      <AthenaCard s={s} save={save} />
      {inWidgetShell() && <WidgetsCard s={s} save={save} />}
      <KellyCard />
      <TemplatesCard />
      <ExportCard />
      <div className="card">
        <CardHead icon="doc" title="Documents" desc="Unfiled files that are not in a project. Project files live on the project's Documents tab." />
        <Documents project={null} />
      </div>
      <div className="card">
        <CardHead icon="board" title="Board limits" desc="Work in progress: how many cards each column may hold." />
        {(['new', 'progress', 'hold', 'waiting'] as Status[]).map((k) => row(WIP_LABELS[k]!, <input key={`${k}:${s.wip_limits[k]}`} className="field" type="number" min={1} max={99} placeholder="none" defaultValue={s.wip_limits[k] ?? ''} onBlur={(e) => {
          const v = e.target.value === '' ? null : Number(e.target.value);
          if (v === (s.wip_limits[k] ?? null)) return;
          if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 99)) { toast('Use a whole number from 1 to 99'); e.target.value = String(s.wip_limits[k] ?? ''); return; }
          void save({ wip_limits: { [k]: v } });
        }} />))}
      </div>
      <div className="card">
        <CardHead icon="list" title="Saved views" desc="Filters you saved from List." />
        {s.saved_views.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Save one from List.</p>}
        {s.saved_views.map((v) => row(`${v.name} · ${v.query}`, <button type="button" className="btn" onClick={() => save({ saved_views: s.saved_views.filter((x) => x.name !== v.name) })}>Remove</button>))}
      </div>
    </>
  );
}

const PUSH_LABELS: [PushType, string][] = [['digest', 'Daily digest'], ['overdue', 'Overdue'], ['nudge', 'Waiting-on nudges'], ['milestone', 'Milestones in a week'], ['weekly_review', 'Weekly review'], ['app_task', 'Tasks added by your apps'], ['meeting', 'Meeting notes ready'], ['unblocked', 'A task is unblocked'], ['stakeholder', 'Stakeholder updates due']];
const STATUS_TEXT: Record<PushState, string> = {
  on: 'On for this device.', off: 'Off for this device.', blocked: 'Blocked by the browser. Allow notifications for Compass in the browser or system settings, then come back.',
  'home-screen': 'Add Compass to your Home Screen, then turn notifications on here.', unsupported: 'This browser can\'t receive notifications.',
};
type Device = { id: string; device_name: string | null; kind?: string; platform?: string; created_at: string; last_ok_at: string | null };

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
  const app = nativeDevice(); // "This iPhone", "This Mac": in an app shell only
  const status = !state ? 'Checking...' : app && (state === 'on' || state === 'off') ? `${state === 'on' ? 'On' : 'Off'} for this ${app.label}.` : app && state === 'unsupported' ? `This ${app.label} can't receive notifications yet.` : STATUS_TEXT[state];
  return (
    <div className="card">
      <CardHead icon="bell" title="Notifications" desc="What reaches this device, and when it stays quiet." />
      <p style={{ margin: '0 0 10px' }} role="status">{status}</p>
      <div className="row">
        {canAsk && (state === 'on'
          ? <button type="button" className="btn" disabled={busy} onClick={turnOff}>Turn off</button>
          : <button type="button" className="btn primary" disabled={busy} onClick={turnOn}>Turn on</button>)}
        <button type="button" className="btn" disabled={busy || (devices.length === 0 && shell() !== 'mac')} onClick={test}>Send a test</button>
      </div>
      {devices.length > 0 && <div style={{ marginTop: 10 }}>
        <div className="eyebrow" style={{ margin: '4px 0' }}>Devices</div>
        {devices.map((d) => (
          <div key={d.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border-soft)', fontSize: 14 }}>
            <span>{d.device_name || (d.kind === 'apns' ? 'iPhone or iPad app' : d.kind === 'fcm' ? 'Android app' : 'Unnamed device')}{d.id === thisDeviceId() ? ' (this device)' : ''}</span>
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

/** Settings → Widgets (v2.3, W8): the iPhone, iPad and Android apps. Android has no Lock Screen widgets, so its hide switch says it is for iPhone and iPad (A2). */
type WidgetToken = { id: string; device_name: string; created_at: string; last_used_at: string | null };
function WidgetsCard({ s, save }: { s: Settings; save: Save }) {
  const me = widgetDeviceName(); // the name its token carries; ponytail: two iPhones share one name, so turning it on in one replaces the other's token
  const [tokens, setTokens] = useState<WidgetToken[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<{ tokens: WidgetToken[] }>('/widget/tokens').then((d) => setTokens(d.tokens)).catch(() => setTokens(null));
  useEffect(() => { void load(); }, []);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast((e as Error).message || 'Needs a connection'); } finally { setBusy(false); void load(); } };
  const on = !!tokens?.some((t) => t.device_name === me);
  // On: the server makes the token (passkey), the app keeps it in the Keychain the widgets read; the page never stores it. Off: revoke and delete the Keychain item.
  const turnOn = () => run(async () => {
    const r = await api<{ id: string; token: string }>('/widget/token', { method: 'POST', json: { device_name: me } });
    try { await setWidgetToken(r.token); } catch (e) { await api(`/widget/token/${r.id}`, { method: 'DELETE' }).catch(() => {}); throw e; }
    toast('Widgets can tick tasks now');
  });
  const revoke = (t: WidgetToken) => run(async () => {
    await api(`/widget/token/${t.id}`, { method: 'DELETE' });
    if (t.device_name === me) await setWidgetToken(null);
    toast('Widget access removed');
  });
  const turnOff = () => run(async () => {
    for (const t of tokens?.filter((x) => x.device_name === me) ?? []) { await api(`/widget/token/${t.id}`, { method: 'DELETE' }); }
    await setWidgetToken(null);
    toast('Widgets can no longer tick tasks');
  });
  const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-soft)', fontSize: 14 } as const;
  return (
    <div className="card">
      <CardHead icon="today" title="Widgets" desc={shell() === 'android' ? 'What the Home Screen widgets show. Widgets are filled each time the app syncs.' : 'What the Home Screen and Lock Screen widgets show. Widgets are filled each time the app syncs.'} />
      <label style={row}>
        <span>Hide work titles on the Lock Screen{shell() === 'android' && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>iPhone and iPad</span>}</span>
        <input type="checkbox" checked={s.widgets.hide_work_on_lock} onChange={(e) => save({ widgets: { hide_work_on_lock: e.target.checked } })} style={{ width: 20, height: 20, accentColor: 'var(--accent)' }} />
      </label>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>On, a work task shows as “Work task” on the Lock Screen, where anyone can glance at it. On the Home Screen it shows its title. Tasks in Offline-only projects never show a title in a widget.</p>
      <label style={{ ...row, marginTop: 10 }}>
        Tick tasks from widgets
        <input type="checkbox" checked={on} disabled={busy || tokens === null} onChange={(e) => (e.target.checked ? turnOn() : turnOff())} style={{ width: 20, height: 20, accentColor: 'var(--accent)' }} />
      </label>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>Turning it on asks for your passkey and gives this device a key that can do one thing: mark a task done. Without it, a tick is sent the next time you open Compass.</p>
      {tokens !== null && tokens.length > 0 && <div style={{ marginTop: 10 }}>
        <div className="eyebrow" style={{ margin: '4px 0' }}>Devices that can tick</div>
        {tokens.map((t) => (
          <div key={t.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border-soft)', fontSize: 14 }}>
            <span>{t.device_name}{t.device_name === me ? ' (this device)' : ''}<span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>{t.last_used_at ? `Last used ${new Date(t.last_used_at).toLocaleString()}` : 'Not used yet'}</span></span>
            <button type="button" className="btn" disabled={busy} onClick={() => revoke(t)}>Revoke</button>
          </div>))}
      </div>}
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
      <CardHead icon="mail" title="Email" desc="Forward email to Compass and it becomes tasks." />
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
        {s.work_email_domains.map((d) => <span key={d} className="chip work" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{d}<button type="button" className="x" aria-label={`Remove ${d}`} onClick={() => save({ work_email_domains: s.work_email_domains.filter((x) => x !== d) })}>x</button></span>)}
      </div>
      <div className="row"><input className="field" style={{ maxWidth: 240 }} placeholder="example.com" value={draft} aria-label="Add a work email domain" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /><button type="button" className="btn" onClick={add}>Add domain</button></div>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>Email from these domains becomes a work task.</p>
    </div>
  );
}

const KEY_NAME: Record<Provider, string> = { claude: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY' };
const PROVIDER_NAME: Record<Provider, string> = { claude: 'Claude', gemini: 'Gemini' };

function Ai({ s, save }: { s: Settings; save: Save }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => { loadUsage().then(setUsage).catch(() => {}); }, [s.ai_monthly_cap_micro]);
  const dollars = +(s.ai_monthly_cap_micro / 1e6).toFixed(2);
  const row = (label: string, el: ReactElement) => <label key={label} className="ai-row">{label}{el}</label>;
  return (
    <div className="card ai-card">
      <CardHead icon="copilot" title="AI" desc="Which model answers, and the monthly budget." />
      {row('Default provider', <select className="field" value={s.default_provider} onChange={(e) => void save({ default_provider: e.target.value as Provider })}>
        {(['claude', 'gemini'] as Provider[]).map((p) => <option key={p} value={p}>{PROVIDER_NAME[p]}</option>)}</select>)}
      {row('Monthly budget (US dollars)', <input key={dollars} className="field" type="number" min={0} max={1000} step={1} defaultValue={dollars} onBlur={(e) => {
        const v = Math.round(Number(e.target.value) * 1e6);
        if (e.target.value === '' || !Number.isFinite(v) || v < 0 || v > 1e9) { toast('Use an amount from $0 to $1000'); e.target.value = String(dollars); return; }
        if (v !== s.ai_monthly_cap_micro) void save({ ai_monthly_cap_micro: v });
      }} />)}
      <div className="ai-row"><span>Spent this month</span><span>{usage ? spend(usage) : 'Needs a connection'}</span></div>
      {(['claude', 'gemini'] as Provider[]).map((p) => (
        <div key={p} className="ai-row"><span>{PROVIDER_NAME[p]}{usage && <span style={{ color: 'var(--text-faint)', fontSize: 12 }}> · {usage.models[p]}</span>}</span>
          <span>{!usage ? '…' : providerReady(usage, p) ? 'Set up' : <>Not set up: run <code>npx wrangler secret put {KEY_NAME[p]}</code> in the Compass folder</>}</span></div>))}
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>Work projects are Offline only until you switch them on the project page.</p>
    </div>
  );
}

type KellyState = { enabled: boolean; scopes: AgentScope[]; last_call_at: string | null; calls_today: number; relay: boolean };
const SCOPES = Object.keys(SCOPE_LABEL) as AgentScope[];

function KellyCard() {
  const [k, setK] = useState<KellyState | null | undefined>(undefined); // undefined: loading, null: no connection
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<KellyState>('/kelly').then(setK).catch(() => setK(null)); }, []);
  // Every change is a passkey step-up: api() asks, then retries. The screen shows what the server kept, never a guess.
  const put = async (body: { enabled?: boolean; scopes?: AgentScope[] }) => {
    setBusy(true);
    try { const r = await api<Pick<KellyState, 'enabled' | 'scopes'>>('/kelly', { method: 'PUT', json: body }); setK((cur) => cur && { ...cur, ...r }); toast('Saved'); }
    catch (e) { toast((e as Error).message || 'Kelly needs a connection'); }
    finally { setBusy(false); }
  };
  const sw = (label: string, checked: boolean, on: (v: boolean) => void, disabled: boolean) => (
    <label key={label} className="kelly-row"><span>{label}</span><span className="tog"><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => on(e.target.checked)} /><i /></span></label>);
  return (
    <div className="card kelly-card">
      <CardHead icon="kelly" title="Kelly" desc="Let your assistant read and add to your tasks. Off until you say so." />
      {k === undefined ? null : k === null ? <p className="hint">Needs a connection.</p> : <>
        {sw('Kelly may use Compass', k.enabled, (v) => void put({ enabled: v }), busy)}
        <div className="kelly-perms" data-off={k.enabled ? undefined : ''}>
          {SCOPES.map((sc) => <Fragment key={sc}>
            {sw(SCOPE_LABEL[sc], k.scopes.includes(sc), (v) => void put({ scopes: v ? [...k.scopes, sc] : k.scopes.filter((x) => x !== sc) }), busy || !k.enabled)}
            {sc === 'compass:read.knowledge' && <p className="kelly-note">Only personal collections; never work.</p>}
          </Fragment>)}
        </div>
        <p className="kelly-note">“Shared” means personal tasks, and projects whose data may go to the cloud. Offline-only projects and their tasks stay private; Kelly never sees them, and she can't delete or edit anything.</p>
        <div className="kelly-row"><span>Last call</span><span>{k.last_call_at ? new Date(k.last_call_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'None yet'}</span></div>
        <div className="kelly-row"><span>Calls today</span><span>{k.calls_today}</span></div>
        {!k.relay && <p className="kelly-note">Kelly's brief on Today needs the relay secret: run <code>npx wrangler secret put KELLY_RELAY_SECRET</code> in the Compass folder.</p>}
        <Link to="/kelly/log" className="btn">See Kelly's activity</Link>
      </>}
    </div>
  );
}

function ExportCard() {
  const [busy, setBusy] = useState(false);
  const run = (kind: 'json' | 'zip') => async () => {
    setBusy(true);
    try {
      const bundle = await api<ExportBundle>('/export'); // api() asks for the passkey and retries
      const day = bundle.exported_at.slice(0, 10);
      if (kind === 'json') saveBytes(strToU8(JSON.stringify(bundle, null, 1)), `compass-export-${day}.json`, 'application/json');
      else saveBytes(zipSync(Object.fromEntries(Object.entries(exportMarkdown(bundle)).map(([name, md]) => [name, strToU8(md)]))), `compass-export-${day}.zip`, 'application/zip');
      toast('Export saved');
    } catch (e) { toast((e as Error).message || 'Export needs a connection'); }
    finally { setBusy(false); }
  };
  return (
    <div className="card export-card">
      <CardHead icon="download" title="Export" desc="A readable copy of everything you have written." />
      <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-dim)' }}>Everything you have written, readable, with your passkey. The JSON also holds what is in Trash; the Markdown zip has one file per project.</p>
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={run('json')}>Export everything (JSON)</button>
        <button type="button" className="btn" disabled={busy} onClick={run('zip')}>Export as Markdown (zip)</button>
      </div>
    </div>
  );
}

/** Settings → Workload (v2.4, P9): weekly capacity, the hours in a day ("1d" in an estimate) and what a task with no estimate counts as. Week overrides live on the Workload screen. */
function WorkloadCard({ s, save }: { s: Settings; save: Save }) {
  const w = s.workload;
  const row = (label: string, el: ReactElement) => <label key={label} className="ai-row">{label}{el}</label>;
  const num = (k: 'work_hours' | 'personal_hours' | 'day_hours', lo: number, hi: number) => (
    <input key={`${k}:${w[k]}`} className="field" type="number" min={lo} max={hi} step="any" defaultValue={w[k]} onBlur={(e) => {
      const v = Number(e.target.value);
      if (e.target.value === '' || !Number.isFinite(v) || v < lo || v > hi) { toast(`Use a number from ${lo} to ${hi}`); e.target.value = String(w[k]); return; }
      if (v !== w[k]) void save({ workload: { [k]: v } });
    }} />);
  return (
    <div className="card ai-card">
      <CardHead icon="bars" title="Workload" desc="How many hours a week you have, so Workload can show the weeks that are over." />
      {row('Work hours a week', num('work_hours', 0, 168))}
      {row('Personal hours a week', num('personal_hours', 0, 168))}
      {row('Hours in a day (for 1d)', num('day_hours', 1, 24))}
      {row('A task with no estimate counts as', <input key={`def:${w.default_estimate_minutes}`} className="field" placeholder="1h" defaultValue={formatEstimate(w.default_estimate_minutes)} onBlur={(e) => {
        const v = parseEstimate(e.target.value, w.day_hours);
        if (v == null || v > 2400) { toast('Use minutes or hours up to 40h, like 1h'); e.target.value = formatEstimate(w.default_estimate_minutes); return; }
        if (v !== w.default_estimate_minutes) void save({ workload: { default_estimate_minutes: v } });
      }} />)}
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>Set a lighter week (leave, travel) on the <Link to="/workload">Workload</Link> screen.</p>
    </div>
  );
}
