import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentRow, Project, ReportInput, ReportModel, Settings } from '../../../../shared/types.ts';
import { DEFAULT_SETTINGS } from '../../../../shared/types.ts';
import { buildReportModel } from '../../../../shared/report-model.ts';
import { api, online, SignedOut } from '../../api.ts';
import { addDays, startOfWeek, todayIn } from '../../dates.ts';
import { BUILTINS } from '../../docs/templates.ts';
import type { TemplateDoc } from '../../../../shared/doc-model.ts';
import { toMarkdown } from '../../../../shared/to-md.ts';
import { DOCX_TYPE, fileName, saveBytes, saveText } from '../../docs/download.ts';
import { idb } from '../../store/db.ts';
import { Link } from '../../router.ts';
import { PrintDoc } from '../../ui/PrintDoc.tsx';
import { toast } from '../../ui/dialogs.tsx';
import { accent, projectColor } from '../../ui/colors.ts';
import { useDocs } from './Documents.tsx';

type Preset = 'week' | 'two' | 'month' | 'custom';
const PRESETS: [Preset, string][] = [['week', 'This week'], ['two', 'Last 2 weeks'], ['month', 'This month'], ['custom', 'Custom']];
const REFUSED: Record<string, string> = {
  offline_boundary: 'Offline only: Athena never sends this project to Claude or Gemini.',
  no_key: "That provider isn't set up yet. See Settings.", cap_reached: "This month's AI budget is used up. Raise it in Settings.",
  rate_limited: 'Too many questions this hour. Try again in a few minutes.', provider_error: 'The provider could not answer. Try again.',
};

/** settings.tz decides what "today" and "this week" mean; the last copy is kept for offline use. */
function useTz() {
  const [tz, set] = useState(DEFAULT_SETTINGS.tz);
  useEffect(() => {
    let live = true;
    void idb.get<{ tz: string }>('meta', 'settings:tz').then((c) => { if (live && c) set(c.tz); }).catch(() => {});
    api<Settings>('/settings').then((s) => { if (live) { set(s.tz); void idb.put('meta', { id: 'settings:tz', tz: s.tz }).catch(() => {}); } }).catch(() => {});
    return () => { live = false; };
  }, []);
  return tz;
}

const rangeOf = (preset: Preset, today: string, custom: { from: string; to: string }) => {
  const mon = startOfWeek(today);
  if (preset === 'week') return { from: mon, to: addDays(mon, 6) };
  if (preset === 'two') return { from: addDays(mon, -7), to: addDays(mon, 6) };
  if (preset === 'month') return { from: today.slice(0, 8) + '01', to: addDays(addDays(today.slice(0, 8) + '01', 32).slice(0, 8) + '01', -1) };
  return custom;
};

type Cached = { id: string; input: ReportInput; at: string };

export function Report({ project }: { project: Project }) {
  const tz = useTz();
  const today = todayIn(tz);
  const [preset, setPreset] = useState<Preset>('week');
  const [custom, setCustom] = useState({ from: addDays(today, -7), to: today });
  const [input, setInput] = useState<Cached | null>(null);
  const [offline, setOffline] = useState(false);
  const [summary, setSummary] = useState<{ key: string; text: string } | null>(null);
  const [ai, setAi] = useState<{ busy: boolean; note: string }>({ busy: false, note: '' });
  const [live, setLive] = useState('');
  const [toPrint, setToPrint] = useState<TemplateDoc | null>(null);
  const [changeId, setChangeId] = useState('');
  const [fillErr, setFillErr] = useState<{ id: string; msg: string } | null>(null);
  const { docs, offline: docsOffline } = useDocs(null);
  const range = rangeOf(preset, today, custom);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= range.to;
  const key = `${range.from}|${range.to}`;
  const cacheId = `report:${project.id}`;
  const seq = useRef(0);
  const synced = !project.id.startsWith('tmp-');

  // One fetch per visit (and on Refresh): the range only changes how the model is built on this device.
  const fetchInput = useCallback(async (withAi: boolean) => {
    const mine = ++seq.current;
    const r = await api<{ input: ReportInput; ai_summary: string | null; ai_refused: string | null }>('/reports/status', { method: 'POST', json: { project_id: project.id, from: range.from, to: range.to, ...(withAi ? { ai: true } : {}) } });
    const c: Cached = { id: cacheId, input: r.input, at: new Date().toISOString() };
    await idb.put('meta', c).catch(() => {});
    if (mine === seq.current) { setInput(c); setOffline(false); }
    return r;
  }, [project.id, cacheId, range.from, range.to]);
  useEffect(() => {
    if (!synced) return;
    let live = true;
    void (async () => {
      const cached = await idb.get<Cached>('meta', cacheId).catch(() => undefined);
      if (live && cached) setInput(cached);
      try { await fetchInput(false); }
      catch (e) { if (live && !(e instanceof SignedOut)) setOffline(true); }
    })();
    return () => { live = false; seq.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per project; a range change does not refetch
  }, [project.id]);

  const model = useMemo<ReportModel | null>(() => {
    if (!input || !valid) return null;
    const m = buildReportModel(input.input, range, today, new Date().toISOString(), tz);
    if (summary?.key === key && summary.text) m.ai.summary = summary.text;
    return m;
  }, [input, valid, key, today, tz, summary]); // eslint-disable-line react-hooks/exhaustive-deps
  const statusMake = BUILTINS.find((b) => b.id === 'status_report')!;
  const doc = model ? statusMake.make(model) : null;

  // iOS Safari's print() doesn't block: keep the print copy mounted until afterprint (timeout in case it never fires).
  useEffect(() => {
    if (!toPrint) return;
    const done = () => setToPrint(null);
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    const timer = window.setTimeout(done, 60_000);
    return () => { window.removeEventListener('afterprint', done); window.clearTimeout(timer); };
  }, [toPrint]);

  const name = (what: string) => fileName(project.name, what, range.to);
  const word = async (d: TemplateDoc, what: string) => {
    try { const { toDocx } = await import('../../docs/to-docx.ts'); saveBytes(await toDocx(d), `${name(what)}.docx`, DOCX_TYPE); }
    catch (e) { toast((e as Error).message); }
  };
  const markdown = (d: TemplateDoc, what: string) => saveText(toMarkdown(d), `${name(what)}.md`);

  const writeSummary = async () => {
    setAi({ busy: true, note: '' }); setLive('Athena is writing the summary…');
    try {
      const r = await fetchInput(true);
      if (r.ai_summary) { setSummary({ key, text: r.ai_summary }); setAi({ busy: false, note: '' }); setLive('Summary ready. The preview is updated.'); }
      else { const note = REFUSED[r.ai_refused ?? ''] ?? 'No summary was written.'; setAi({ busy: false, note }); setLive(note); }
    } catch (e) { if (!(e instanceof SignedOut)) { const note = (e as Error).message; setAi({ busy: false, note }); setLive(note); } else setAi({ busy: false, note: '' }); }
  };
  const refresh = async () => {
    try { await fetchInput(false); toast('Report data refreshed'); } catch (e) { if (!(e instanceof SignedOut)) { setOffline(true); toast('Refreshing needs a connection'); } }
  };

  const fill = async (t: DocumentRow) => {
    if (!model) return;
    setFillErr(null);
    try {
      const r = await fetch(`/api/documents/${t.id}/file`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`The template could not be downloaded (${r.status}).`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const { fillTemplate } = await import('../../docs/fill.ts');
      saveBytes(fillTemplate(bytes, model), `${fileName(project.name, t.name.replace(/\.docx$/i, ''), range.to)}.docx`, DOCX_TYPE);
    } catch (e) { setFillErr({ id: t.id, msg: (e as Error).message }); }
  };

  const off = offline || docsOffline || !online();
  const templates = docs.filter((d) => d.is_template && d.kind === 'docx');
  const cloud = project.data_boundary !== 'offline';
  const btn = (label: string, onClick: () => void, extra?: { disabled?: boolean; primary?: boolean; label?: string }) =>
    <button type="button" className={`btn ${extra?.primary ? 'primary' : ''}`} disabled={!model || extra?.disabled} aria-label={extra?.label} onClick={onClick}>{label}</button>;

  if (!synced) return <p style={{ color: 'var(--text-faint)' }}>This project is still syncing. Reports open once it reaches the server.</p>;
  return (
    <>
      <div className="no-print" style={{ display: 'grid', gap: 14 }}>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{live}</div>
        <div className="card report-bar" style={{ display: 'grid', gap: 10 }}>
          <div className="row">
            <div className="seg" role="group" aria-label="Report period">
              {PRESETS.map(([p, l]) => <button type="button" key={p} className={preset === p ? 'on' : ''} aria-pressed={preset === p} onClick={() => setPreset(p)}>{l}</button>)}</div>
            {preset === 'custom' && <>
              <input className="field" style={{ width: 'auto' }} type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              <input className="field" style={{ width: 'auto' }} type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></>}
            <span className="mono sub">{valid ? `${range.from} to ${range.to}` : ''}</span>
          </div>
          {!valid && <div className="sub" role="note" style={{ color: 'var(--danger)' }}>Pick a start date on or before the end date.</div>}
          <div className="row">
            {btn('Word', () => void word(doc!, 'status'), { primary: true, label: 'Download the status report as Word' })}
            {btn('Markdown', () => markdown(doc!, 'status'), { label: 'Download the status report as Markdown' })}
            {btn('PDF', () => setToPrint(doc), { label: 'Print the status report or save it as PDF' })}
            {cloud
              ? <button type="button" className="btn" disabled={!model || ai.busy || off} onClick={() => void writeSummary()}>{ai.busy ? 'Writing…' : 'Write the summary with Athena'}</button>
              : <small className="sub">{REFUSED.offline_boundary}</small>}
            <button type="button" className="btn" disabled={off} onClick={() => void refresh()} style={{ marginLeft: 'auto' }}>Refresh data</button>
          </div>
          {ai.note && <div className="sub" style={{ color: 'var(--danger)' }}>{ai.note}</div>}
          {off && <div className="sub" role="note">Offline: using the last copy{input ? ` from ${input.at.slice(0, 16).replace('T', ' ')}` : ''}. Athena's summary and template files need a connection.</div>}
        </div>
        {doc ? <div className="card report-preview" aria-label="Report preview"><PrintDoc doc={doc} /></div>
          : <p style={{ color: 'var(--text-faint)', margin: 0 }}>{valid ? (offline ? 'No saved copy of this report yet. Open it once while online.' : 'Loading the report…') : ''}</p>}

        <h2 className="rh2">Templates</h2>
        <div className="sub">Filled from the period above. Each builtin has a library page that explains how to use it.</div>
        {BUILTINS.map((b) => {
          const many = (model?.changes.count ?? 0) > 1;
          const make = () => b.make(model!, b.id === 'change_request' && changeId ? { changeId } : undefined);
          return (
            <div key={b.id} className="acard doc-row" style={accent(projectColor(project))}>
              <div className="row"><b style={{ flex: '1 1 160px' }}>{b.name}</b><Link to={`/library/${b.guide}`} className="btn">Guide</Link></div>
              {b.id === 'change_request' && many && <label className="sub">Which change
                <select className="field" style={{ width: 'auto', marginLeft: 8 }} value={changeId} onChange={(e) => setChangeId(e.target.value)}>
                  <option value="">The newest pending one</option>
                  {model!.changes.rows.map((c) => <option key={c.id} value={c.id}>{c.title || '(untitled)'} · {c.decision}</option>)}</select></label>}
              <div className="row">
                {btn('Word', () => void word(make(), b.name), { disabled: false, label: `${b.name} as Word` })}
                {btn('Markdown', () => markdown(make(), b.name), { label: `${b.name} as Markdown` })}
                {btn('PDF', () => setToPrint(make()), { label: `${b.name} as PDF` })}
              </div>
            </div>);
        })}
        {templates.length > 0 && <div className="eyebrow" style={{ marginTop: 6 }}>Your templates</div>}
        {templates.map((t) => (
          <div key={t.id} className="acard doc-row" style={accent(projectColor(project))}>
            <div className="row"><b style={{ flex: '1 1 160px', overflowWrap: 'anywhere' }}>{t.name}</b>
              <button type="button" className="btn primary" disabled={!model || off} onClick={() => void fill(t)} aria-label={`Fill ${t.name}`}>Fill</button></div>
            {fillErr?.id === t.id && <div className="sub" role="alert" style={{ color: 'var(--danger)', overflowWrap: 'anywhere' }}>{fillErr.msg}</div>}
          </div>))}
        {!templates.length && <p className="sub" style={{ margin: 0 }}>Upload a Word file with placeholders like {'{{project.name}}'} on the Documents tab and switch on "Use as template".</p>}
      </div>
      <div className="print-only">{toPrint && <PrintDoc doc={toPrint} />}</div>
    </>
  );
}
