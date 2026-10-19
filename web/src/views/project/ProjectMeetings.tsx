import { useEffect, useState } from 'react';
import type { MeetingReview, Project } from '../../../../shared/types.ts';
import { api, SignedOut } from '../../api.ts';
import { idb } from '../../store/db.ts';
import { Link } from '../../router.ts';

export function ProjectMeetings({ project }: { project: Project }) {
  const [s, set] = useState<{ meetings: MeetingReview[]; offline: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    const id = `gov:${project.id}:meetings`;
    (async () => {
      let r: { meetings: MeetingReview[]; offline: boolean };
      try {
        const { meetings } = await api<{ meetings: MeetingReview[] }>(`/meetings?project=${encodeURIComponent(project.id)}`);
        await idb.put('meta', { id, meetings, at: new Date().toISOString() }).catch(() => {});
        r = { meetings, offline: false };
      } catch (e) {
        if (e instanceof SignedOut) return;
        r = { meetings: (await idb.get<{ meetings: MeetingReview[] }>('meta', id).catch(() => undefined))?.meetings ?? [], offline: true };
      }
      if (live) set(r);
    })();
    return () => { live = false; };
  }, [project.id]);
  if (!s) return null;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {s.offline && <div className="sub" role="status">Offline: showing the last copy.</div>}
      {s.meetings.map((m) => (
        <Link key={m.id} to={`/meetings/${m.id}`} className="card row" style={{ color: 'inherit', justifyContent: 'space-between', padding: 12 }}>
          <span style={{ overflowWrap: 'anywhere' }}>{m.title}</span>
          <span className="row" style={{ gap: 6 }}><span className="sub">{new Date(m.received_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span><span className="chip">{m.state === 'new' ? 'New' : 'Reviewed'}</span></span>
        </Link>))}
      {!s.meetings.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>No meetings are linked to this project yet. Accept one with this project chosen.</p>}
    </div>
  );
}
