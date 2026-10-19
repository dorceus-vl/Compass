import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { Rule, RuleMode, Horizon, Kind } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { confirmAction, toast } from '../ui/dialogs.tsx';

const APPS: [string, string][] = [['*', 'Any app'], ['finance', 'Finance'], ['health', 'Health'], ['home', 'Home'], ['nightowl', 'Night Owl'], ['kelly', 'Kelly'], ['sonarflow', 'SonarFlow'], ['hollow', 'Hollow'], ['email', 'Email']];
const MODES: [RuleMode, string][] = [['task', 'Task'], ['inbox', 'Wait in inbox'], ['ignore', 'Ignore']];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const msg = (e: unknown) => (e as Error).message || 'Rules need a connection';
const field: CSSProperties = { display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-faint)' };

function matchText(r: Rule): string {
  const m = r.match, bits = [m.suggest && `suggest "${m.suggest}"`, m.kind && `kind ${m.kind}`, m.title_regex && `title /${m.title_regex}/`].filter(Boolean);
  return bits.length ? `Matches ${bits.join(', ')}` : 'Matches every item from this app';
}

export function Rules() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [rev, setRev] = useState(0); // bumped on a failed edit so inputs show the saved value again
  const load = () => api<{ rules: Rule[] }>('/rules').then((d) => { setRules(d.rules); setRev((n) => n + 1); }).catch(() => toast('Rules need a connection'));
  useEffect(() => { void load(); }, []);
  if (!rules) return null;

  const patch = async (r: Rule, body: Record<string, unknown>) => {
    try {
      const { rule } = await api<{ rule: Rule }>(`/rules/${r.id}`, { method: 'PATCH', json: body });
      setRules((xs) => xs && xs.map((x) => (x.id === rule.id ? rule : x)));
      toast('Saved');
    } catch (e) { toast(msg(e)); void load(); }
  };
  const remove = async (r: Rule) => {
    if (!(await confirmAction(`Delete the rule "${r.name}"? Items it would have handled go to the inbox instead.`, { danger: true }))) return;
    try { await api(`/rules/${r.id}`, { method: 'DELETE' }); setRules((xs) => xs && xs.filter((x) => x.id !== r.id)); toast('Rule deleted'); } catch (e) { toast(msg(e)); }
  };
  const offset = (r: Rule, raw: string) => {
    const set = { ...r.then_set }, v = raw.trim() === '' ? null : Number(raw);
    if (v === (set.due_offset_days ?? null)) return;
    if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= 365)) { toast('Use a whole number of days from 0 to 365'); setRev((n) => n + 1); return; }
    if (v === null) delete set.due_offset_days; else set.due_offset_days = v;
    void patch(r, { then_set: set });
  };

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 6 }}>Sources and rules</div>
      <p style={{ margin: '0 0 6px' }}>Rules run in this order on what your other apps send. The first one that matches decides: add a task, wait in the inbox, or ignore it.</p>
      {rules.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No rules yet.</p>}
      {rules.map((r) => (
        <div key={r.id} style={{ borderTop: '1px solid var(--border-soft)', padding: '12px 0', display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <label style={field}>Name<input key={`${rev}:${r.name}`} className="field" defaultValue={r.name} maxLength={80} onBlur={(e) => { const v = e.target.value.trim(); if (!v) { toast('A rule needs a name'); e.target.value = r.name; } else if (v !== r.name) void patch(r, { name: v }); }} /></label>
            <label style={field}>App<select className="field" value={r.app} onChange={(e) => patch(r, { app: e.target.value })}>{APPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label style={field}>What to do<select className="field" value={r.mode} onChange={(e) => patch(r, { mode: e.target.value })}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label style={field}>Due in (days)<input key={`${rev}:${r.then_set.due_offset_days ?? ''}`} className="field" type="number" min={0} max={365} placeholder="none" defaultValue={r.then_set.due_offset_days ?? ''} onBlur={(e) => offset(r, e.target.value)} /></label>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--text-faint)', overflowWrap: 'anywhere' }}>{matchText(r)}</span>
            <span className="row">
              <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={!!r.enabled} onChange={(e) => patch(r, { enabled: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />Enabled</label>
              <button type="button" className="btn" style={{ color: 'var(--danger)' }} onClick={() => remove(r)}>Delete</button>
            </span>
          </div>
        </div>
      ))}
      <AddRule onAdded={(r) => setRules((xs) => xs && [...xs, r])} />
    </div>
  );
}

function AddRule({ onAdded }: { onAdded: (r: Rule) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), get = (k: string) => String(f.get(k) ?? '').trim();
    const match: Record<string, string> = {};
    if (get('suggest')) match.suggest = get('suggest');
    const re = get('regex') || (get('words') ? escapeRe(get('words')) : '');
    if (re) match.title_regex = re;
    const then_set: Record<string, unknown> = { horizon: get('horizon') as Horizon, kind: get('kind') as Kind };
    if (get('offset') !== '') {
      const n = Number(get('offset'));
      if (!(Number.isInteger(n) && n >= 0 && n <= 365)) { setErr('Due in: use a whole number of days from 0 to 365'); return; }
      then_set.due_offset_days = n;
    }
    setBusy(true); setErr('');
    try {
      const { rule } = await api<{ rule: Rule }>('/rules', { method: 'POST', json: { name: get('name'), app: get('app'), mode: get('mode'), match, then_set } });
      onAdded(rule); setOpen(false); toast('Rule added');
    } catch (x) { setErr(msg(x)); } finally { setBusy(false); }
  };
  if (!open) return <div style={{ marginTop: 6 }}><button type="button" className="btn" onClick={() => setOpen(true)}>Add rule</button></div>;
  const f = (label: string, el: ReactNode) => <label style={field}>{label}{el}</label>;
  return (
    <form onSubmit={submit} style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12, display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {f('Name', <input name="name" className="field" required maxLength={80} />)}
        {f('App', <select name="app" className="field">{APPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>)}
        {f('Suggest (optional)', <input name="suggest" className="field" maxLength={40} />)}
        {f('Title contains (optional)', <input name="words" className="field" maxLength={60} />)}
        {f('What to do', <select name="mode" className="field">{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>)}
        {f('Horizon', <select name="horizon" className="field"><option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option></select>)}
        {f('Kind', <select name="kind" className="field"><option value="personal">Personal</option><option value="work">Work</option></select>)}
        {f('Due in (days)', <input name="offset" className="field" type="number" min={0} max={365} placeholder="none" />)}
      </div>
      <details><summary style={{ cursor: 'pointer', fontSize: 13 }}>Advanced</summary>
        <div style={{ marginTop: 8 }}>{f('Title pattern (a regular expression; replaces "Title contains")', <input name="regex" className="field" maxLength={100} spellCheck={false} />)}</div></details>
      {err && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
      <div className="row"><button className="btn primary" disabled={busy}>Add rule</button><button type="button" className="btn" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button></div>
    </form>
  );
}
