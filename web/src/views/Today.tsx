import { useEffect, useState } from 'react';
import type { Horizon, Settings, Task, TodayAnswer } from '../../../shared/types.ts';
import { briefText } from '../../../shared/brief.ts';
import { api, online } from '../api.ts';
import { idb } from '../store/db.ts';
import { loadUsage, providerReady } from '../copilot.ts';
import { toast } from '../ui/dialogs.tsx';
import { useStore } from '../store/useStore.ts';
import { TaskList, useFinished } from '../ui/TaskCard.tsx';
import { arrange } from '../query.ts';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { today, startOfWeek, daysUntil } from '../dates.ts';
import { Link } from '../router.ts';
import { AddedStrip } from '../ui/AddedStrip.tsx';
import { Hero, greetingFor } from '../ui/Hero.tsx';
import { HorizonDial, HORIZONS, HORIZON_LABEL, cap } from '../ui/HorizonDial.tsx';
import { HorizonRing } from '../ui/HorizonRing.tsx';
import { MilestonePath } from '../ui/MilestonePath.tsx';
import { SectionHead } from '../ui/SectionHead.tsx';
import { blockedIds } from '../../../shared/deps.ts';

const FEED_LIMIT = 12;

export function Today() {
  const { tasks, milestones, projects, ready } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<'all' | 'personal' | 'work'>('all');
  const [hz, setHz] = useState<Horizon>('short');
  const [finished, onFinish] = useFinished();
  const t = today();
  const [ai, setAi] = useState<string | null>(null); // Athena's version of today's brief, kept in `meta` for the rest of the day
  const [canAsk, setCanAsk] = useState(false);
  const [writing, setWriting] = useState(false);
  const [kelly, setKelly] = useState<string | null>(null); // Kelly's paragraph from Kelly-Cloud, kept in `meta` for the day (plain text, never HTML)
  useEffect(() => {
    setAi(null); setKelly(null);
    void idb.get<{ text: string }>('meta', `kelly-brief:${t}`).then((c) => setKelly((cur) => cur ?? c?.text ?? null)).catch(() => {});
    // Online, the server decides (off, no permission, no relay, slow = unavailable, and the cached copy goes); offline, the cached one stays.
    if (online()) api<{ text?: string; unavailable?: true }>(`/kelly/brief?date=${t}`).then(async (r) => {
      setKelly(r.text ?? null);
      if (r.text) await idb.put('meta', { id: `kelly-brief:${t}`, text: r.text, at: new Date().toISOString() }); else await idb.del('meta', `kelly-brief:${t}`);
    }).catch(() => {});
    void idb.get<{ text: string }>('meta', `brief:${t}`).then((c) => setAi(c?.text ?? null)).catch(() => {});
    // The brief is written by the default provider (worker/routes/ai.ts), so only its key counts.
    Promise.all([loadUsage(), api<Settings>('/settings')]).then(([u, s]) => setCanAsk(providerReady(u, s.default_provider))).catch(() => setCanAsk(false));
  }, [t]);
  if (!ready) return null;
  const live = tasks.filter((x) => !x.deleted_at && !x.parent_id && (kind === 'all' || x.kind === kind));
  // the lists also keep, after the open ones, what was finished from a card during this visit, so its check can undo it
  const blocked = blockedIds(tasks);
  const sorted = [...live].sort((a, b) => (a.due_at ?? '9') < (b.due_at ?? '9') ? -1 : 1);
  const blockedList = sorted.filter((x) => blocked.has(x.id)); // v2.1: a blocked task waits in its own group, outside the horizons and Overdue
  const byDue = sorted.filter((x) => !blocked.has(x.id));
  const openTasks = byDue.filter((x) => x.status !== 'done');
  const overdueList = arrange(byDue.filter((x) => x.due_at && x.due_at < t), finished);
  const byHz = Object.fromEntries(HORIZONS.map((h) => [h, openTasks.filter((x) => x.horizon === h)])) as Record<Horizon, Task[]>;
  const counts = Object.fromEntries(HORIZONS.map((h) => [h, byHz[h].length])) as Record<Horizon, number>;
  const feed = arrange(byDue.filter((x) => x.horizon === hz), finished, FEED_LIMIT);
  const doneWeek = live.filter((x) => x.status === 'done' && x.done_at && x.done_at >= startOfWeek(t)).length;

  // Milestones of live projects, open and dated, soonest first. The line shows the project of the nearest one still ahead
  // (or, when every open one is late, the latest-late one's project); the hero counts days to the nearest one ahead.
  const liveProject = (id: string) => projects.find((p) => p.id === id && !p.deleted_at);
  const dueMs = milestones.filter((m) => !m.deleted_at && !m.done_at && m.due_at && liveProject(m.project_id)).sort((a, b) => a.due_at! < b.due_at! ? -1 : 1);
  const ahead = dueMs.find((m) => m.due_at! >= t);
  const lineMs = ahead ?? dueMs[0];
  const lineProject = lineMs ? liveProject(lineMs.project_id) : undefined;

  // The brief covers everything, whatever the Personal/Work filter shows.
  const every = tasks.filter((x) => !x.deleted_at && !x.parent_id && x.status !== 'done');
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
    } catch (e) { toast((e as Error).message || 'Athena could not write it'); }
    finally { setWriting(false); }
  };
  const daysLeft = lineMs ? daysUntil(lineMs.due_at!, t) : 0;
  return (
    <div className="today">
      <Hero greeting={greetingFor(new Date().getHours())} stats={{
        today: openTasks.filter((x) => x.due_at === t).length, overdue: overdueList.open,
        nextMilestone: ahead ? { name: ahead.name, days: daysUntil(ahead.due_at!, t) } : null,
      }} />
      <AddedStrip onOpen={setOpen} />
      <section className="card brief" aria-label="Today's brief">
        <div className="eyebrow">{kelly ? 'Kelly' : ai ? 'Athena' : "Compass's summary"}</div>
        <p className={kelly ? 'kelly-brief' : undefined}>{kelly ?? ai ?? briefText(answer, t)}</p>
        {!kelly && !ai && canAsk && online() && <button type="button" className="btn" disabled={writing} onClick={() => void writeIt()}>{writing ? 'Writing…' : 'Write it with Athena'}</button>}
      </section>
      <section aria-labelledby="hz-h">
        <SectionHead id="hz-h" eyebrow="Your horizons" title="Turn the compass, the horizons follow">
          <div className="seg" role="group" aria-label="Show">{(['all', 'personal', 'work'] as const).map((k) => <button type="button" key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{cap(k)}</button>)}</div>
        </SectionHead>
        <div className="hzgrid">
          <HorizonDial value={hz} counts={counts} onChange={setHz} />
          <HorizonRing value={hz} tasks={byHz} onChange={setHz} />
        </div>
      </section>
      {overdueList.shown.length > 0 && (
        <section aria-labelledby="od-h">
          <SectionHead id="od-h" eyebrow="Needs attention" title="Overdue"><span className="note">{overdueList.open} open</span></SectionHead>
          <TaskList tasks={overdueList.shown} projects={projects} onOpen={setOpen} onFinish={onFinish} />
        </section>
      )}
      <section aria-labelledby="feed-h">
        <SectionHead id="feed-h" eyebrow={`${cap(hz)} horizon`} title={HORIZON_LABEL[hz]}><span className="note">{feed.open} open · swipe right to finish</span></SectionHead>
        {feed.shown.length === 0 && <p className="hint">Nothing here. ⌘K or + to add.</p>}
        <TaskList tasks={feed.shown} projects={projects} onOpen={setOpen} onFinish={onFinish} />
        {feed.open > FEED_LIMIT && <Link to="/list" className="chip more">+{feed.open - FEED_LIMIT} more in List</Link>}
      </section>
      {blockedList.length > 0 && (
        <details className="blocked-group">
          <summary><span>Blocked ({blockedList.length})</span><small>waiting on another task</small></summary>
          <TaskList tasks={blockedList} projects={projects} onOpen={setOpen} onFinish={onFinish} blocked={blocked} />
        </details>
      )}
      {lineMs && lineProject && (
        <section aria-labelledby="ms-h">
          <SectionHead id="ms-h" eyebrow="Milestones" title={<Link to={`/projects/${lineProject.id}`}>{lineProject.name}</Link>}>
            <span className="note">{lineMs.name} {daysLeft > 1 ? `in ${daysLeft} days` : daysLeft === 1 ? 'tomorrow' : daysLeft === 0 ? 'today' : `${-daysLeft}d late`}</span>
          </SectionHead>
          <MilestonePath milestones={milestones.filter((m) => m.project_id === lineProject.id)} today={t} />
        </section>
      )}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
