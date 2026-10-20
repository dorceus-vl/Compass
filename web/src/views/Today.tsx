import { useEffect, useState } from 'react';
import type { Settings, TodayAnswer } from '../../../shared/types.ts';
import { briefText } from '../../../shared/brief.ts';
import { api, online } from '../api.ts';
import { idb } from '../store/db.ts';
import { loadUsage, providerReady } from '../copilot.ts';
import { toast } from '../ui/dialogs.tsx';
import { useStore } from '../store/useStore.ts';
import { TaskList, shownInList } from '../ui/TaskCard.tsx';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { today, startOfWeek, fmtDue } from '../dates.ts';
import { Link } from '../router.ts';
import { AddedStrip } from '../ui/AddedStrip.tsx';

export function Today() {
  const { tasks, milestones, projects, ready } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<'all' | 'personal' | 'work'>('all');
  const t = today();
  const [ai, setAi] = useState<string | null>(null); // the copilot's version of today's brief, kept in `meta` for the rest of the day
  const [canAsk, setCanAsk] = useState(false);
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    setAi(null);
    void idb.get<{ text: string }>('meta', `brief:${t}`).then((c) => setAi(c?.text ?? null)).catch(() => {});
    // The brief is written by the default provider (worker/routes/ai.ts), so only its key counts.
    Promise.all([loadUsage(), api<Settings>('/settings')]).then(([u, s]) => setCanAsk(providerReady(u, s.default_provider))).catch(() => setCanAsk(false));
  }, [t]);
  if (!ready) return null;
  const live = tasks.filter((x) => !x.deleted_at && !x.parent_id && (kind === 'all' || x.kind === kind));
  const openTasks = live.filter((x) => x.status !== 'done').sort((a, b) => (a.due_at ?? '9') < (b.due_at ?? '9') ? -1 : 1);
  const overdue = openTasks.filter((x) => x.due_at && x.due_at < t);
  // the lists also keep what was just finished from a card, so its check can undo it
  const shown = live.filter(shownInList).sort((a, b) => (a.due_at ?? '9') < (b.due_at ?? '9') ? -1 : 1);
  const overdueShown = shown.filter((x) => x.due_at && x.due_at < t);
  const doneWeek = live.filter((x) => x.status === 'done' && x.done_at && x.done_at >= startOfWeek(t)).length;
  const col = (h: 'short' | 'medium' | 'long', title: string) => {
    const xs = shown.filter((x) => x.horizon === h), open = xs.filter((x) => x.status !== 'done').length;
    return (
      <div className="hz">
        <div className="hh"><b>{title}</b><small>{open}</small></div>
        {xs.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Nothing here. ⌘K or + to add.</p>}
        <TaskList tasks={xs.slice(0, 12)} projects={projects} onOpen={setOpen} />
        {xs.length > 12 && <Link to="/list" className="chip">+{xs.length - 12} more in List</Link>}
      </div>
    );
  };
  // The brief covers everything, whatever the Personal/Work filter shows.
  const every = tasks.filter((x) => !x.deleted_at && !x.parent_id && x.status !== 'done');
  const dueMs = milestones.filter((m) => !m.deleted_at && !m.done_at && m.due_at).sort((a, b) => a.due_at! < b.due_at! ? -1 : 1);
  const answer: TodayAnswer = {
    date: t, short: every.filter((x) => x.horizon === 'short'), medium: every.filter((x) => x.horizon === 'medium'), long: every.filter((x) => x.horizon === 'long'),
    overdue: every.filter((x) => x.due_at && x.due_at < t), open_today: every.filter((x) => x.due_at && x.due_at <= t).length, done_this_week: doneWeek,
    milestones: dueMs.slice(0, 5).map((m) => ({ ...m, project_name: projects.find((p) => p.id === m.project_id)?.name ?? '' })),
  };
  const writeIt = async () => {
    setWriting(true);
    try {
      const { text } = await api<{ text: string }>('/ai/brief', { method: 'POST' });
      setAi(text);
      await idb.put('meta', { id: `brief:${t}`, text, at: new Date().toISOString() }).catch(() => {});
    } catch (e) { toast((e as Error).message || 'The copilot could not write it'); }
    finally { setWriting(false); }
  };
  const next = milestones.filter((m) => !m.done_at && m.due_at).sort((a, b) => a.due_at! < b.due_at! ? -1 : 1).slice(0, 4);
  return (
    <>
      <div className="head">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString('en-CA', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1 style={{ marginTop: 6 }}>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, <b>Vlad</b></h1>
          <div className="sub">{openTasks.filter((x) => x.due_at && x.due_at <= t).length} due today · <span style={{ color: overdue.length ? 'var(--danger)' : undefined }}>{overdue.length} overdue</span> · {doneWeek} done this week</div>
        </div>
        <div className="seg">{(['all', 'personal', 'work'] as const).map((k) => <button type="button" key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}</div>
      </div>
      <section className="card brief" aria-label="Today's brief">
        <div className="eyebrow">{ai ? 'Copilot' : "Compass's summary"}</div>
        <p>{ai ?? briefText(answer, t)}</p>
        {!ai && canAsk && online() && <button type="button" className="btn" disabled={writing} onClick={() => void writeIt()}>{writing ? 'Writing…' : 'Write it with the copilot'}</button>}
      </section>
      <AddedStrip onOpen={setOpen} />
      {overdueShown.length > 0 && <div className="inbox" style={{ borderColor: 'rgba(255,77,94,.35)' }}><div className="top"><h2>Overdue <small>{overdue.length}</small></h2></div><TaskList tasks={overdueShown} projects={projects} onOpen={setOpen} /></div>}
      <div className="horizons">{col('short', 'Short · this week')}{col('medium', 'Medium · this quarter')}{col('long', 'Long · this year and beyond')}</div>
      {next.length > 0 && <div className="inbox"><div className="top"><h2>Next milestones</h2></div>
        {next.map((m) => <div key={m.id} className="task"><div className="tt">{m.name}</div><span className="chip" style={{ marginLeft: 'auto' }}>{projects.find((p) => p.id === m.project_id)?.name} · {fmtDue(m.due_at).text}</span></div>)}</div>}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
