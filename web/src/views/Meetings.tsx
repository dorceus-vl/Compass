import { useEffect, useState } from 'react';
import type { MeetingReview } from '../../../shared/types.ts';
import { loadMeetings } from '../inbox.ts';
import { Link } from '../router.ts';
import { SignedOut } from '../api.ts';

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const n = (c: number, w: string) => `${c} ${w}${c === 1 ? '' : 's'}`;

function Row({ m }: { m: MeetingReview }) {
  return (
    <Link to={`/meetings/${m.id}`} className="card" style={{ display: 'block', color: 'inherit' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{m.title}</h3>
        <span className="chip">{m.state === 'new' ? 'New' : 'Reviewed'}</span>
      </div>
      <p>{when(m.received_at)} · {n(m.action_items.length, 'action')} · {n(m.decisions.length, 'decision')}</p>
    </Link>
  );
}

export function MeetingsView() {
  const [s, set] = useState<{ meetings: MeetingReview[]; offline: boolean; known: boolean } | null>(null);
  useEffect(() => { loadMeetings().then(set).catch((e) => { if (!(e instanceof SignedOut)) throw e; }); }, []);
  const fresh = s?.meetings.filter((m) => m.state === 'new') ?? [], done = s?.meetings.filter((m) => m.state !== 'new') ?? [];
  return (
    <>
      <div className="head"><div><div className="eyebrow">Meetings</div><h1 style={{ marginTop: 6 }}>Meeting <b>notes</b></h1>
        <div className="sub">{s?.offline ? 'Offline: showing the last list. Reviewing needs a connection.' : `${fresh.length} to review`}</div></div></div>
      {s && !s.meetings.length && <div className="card"><p style={{ margin: 0 }}>{s.known ? 'No meetings yet.' : "Can't reach your meetings right now."}</p></div>}
      {fresh.length > 0 && <><h2 style={{ fontSize: 16, margin: '18px 0 10px' }}>To review</h2><div className="grid3">{fresh.map((m) => <Row key={m.id} m={m} />)}</div></>}
      {done.length > 0 && <><h2 style={{ fontSize: 16, margin: '18px 0 10px' }}>Reviewed</h2><div className="grid3">{done.map((m) => <Row key={m.id} m={m} />)}</div></>}
    </>
  );
}
