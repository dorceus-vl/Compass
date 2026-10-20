import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { toast } from '../ui/dialogs.tsx';
import { accent } from '../ui/colors.ts';
import { Link } from '../router.ts';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { openTask } from '../inbox.ts';
import { kellyLine } from '../../../shared/kelly-log.ts';

type Row = { id: string; at: string; actor: string; action: string; target: string | null; detail: unknown; task_live: boolean };
type Page = { rows: Row[]; next: string | null };

/** What Kelly did through the agent API (and when Vlad changed her access), newest first. Everything is plain text; a task is a link only while it still exists. */
export function KellyLog() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = (before?: string) => api<Page>(`/kelly/log?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`)
    .then((p) => { setRows((cur) => (before && cur ? [...cur, ...p.rows] : p.rows)); setNext(p.next); })
    .catch(() => toast("Kelly's activity needs a connection"));
  useEffect(() => { void load(); }, []);
  return (
    <>
      <div className="head"><div><div className="eyebrow"><Link to="/settings">Settings</Link> · Kelly</div><h1 style={{ marginTop: 6 }}>What Kelly <b>did</b></h1>
        <div className="sub">Every call she makes to Compass, and every time you changed what she may do. Task names are never kept here.</div></div></div>
      {rows?.length === 0 && <div className="card"><p style={{ margin: 0 }}>Kelly hasn't called Compass yet.</p></div>}
      <div className="tlist2" role="list" aria-label="Kelly's activity">
        {rows?.map((r) => {
          const { title, sub } = kellyLine(r.action, r.detail);
          const refused = title.startsWith('Refused');
          return (
            <div key={r.id} role="listitem" className="acard trow kelly-log" style={accent(r.actor === 'kelly' ? (refused ? 'var(--danger)' : 'var(--src-kelly)') : 'var(--text-dim)')}>
              <div className="tt">{title}{sub && <span className="kelly-sub">{sub}</span>}</div>
              {r.task_live && r.target && <button type="button" className="btn" onClick={() => void openTask(r.target!, setOpen)}>Open task</button>}
              <time className="chip" dateTime={r.at}>{new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
            </div>);
        })}
      </div>
      {next && <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => void load(next)}>Older</button>}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
