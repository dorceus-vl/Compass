import { useEffect, useState } from 'react';
import type { PortfolioRow } from '../../../shared/types.ts';
import { api, SignedOut } from '../api.ts';
import { idb } from '../store/db.ts';
import { useStore } from '../store/useStore.ts';
import { Link } from '../router.ts';
import { fmtDue } from '../dates.ts';

const RAG = { green: 'var(--ok)', amber: 'var(--warn)', red: 'var(--danger)', none: 'var(--text-faint)' };
type Filter = 'all' | 'personal' | 'work';

/** Portfolio cards from /api/portfolio, cached in IndexedDB `meta` ("portfolio"); closed projects come from the local store. */
export function Portfolio() {
  const { projects } = useStore();
  const [rows, setRows] = useState<PortfolioRow[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const sig = projects.reduce((m, p) => (p.updated_at > m ? p.updated_at : m), '') + projects.length; // refetch after a pull changes a project
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { projects: r } = await api<{ projects: PortfolioRow[] }>('/portfolio');
        await idb.put('meta', { id: 'portfolio', projects: r, at: new Date().toISOString() }).catch(() => {});
        if (live) { setRows(r); setOffline(false); }
      } catch (e) {
        if (e instanceof SignedOut) return;
        const c = await idb.get<{ projects: PortfolioRow[] }>('meta', 'portfolio').catch(() => undefined);
        if (live) { setRows(c?.projects ?? []); setOffline(true); }
      }
    })();
    return () => { live = false; };
  }, [sig]);
  const shown = (rows ?? []).filter((p) => filter === 'all' || p.kind === filter);
  const closed = projects.filter((p) => !p.deleted_at && p.status === 'closed' && (filter === 'all' || p.kind === filter));
  return (
    <>
      <div className="row">
        <div className="seg" role="group" aria-label="Show">{(['all', 'personal', 'work'] as const).map((f) => <button type="button" key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}</div>
        {offline && <span className="sub" role="status">Offline: showing the last copy.</span>}
      </div>
      <div className="grid3">
        {shown.map((p) => { const ms = p.next_milestone;
          return <Link key={p.id} to={`/projects/${p.id}`} className="card" style={{ display: 'grid', gap: 8, color: 'inherit', alignContent: 'start' }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><h3 style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{p.name}</h3><span className="chip">{p.kind}</span></div>
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><i style={{ width: 10, height: 10, borderRadius: 99, background: RAG[p.rag], flex: 'none' }} title={`RAG: ${p.rag}`} /><span className="sub">{p.rag_reason || (p.rag === 'none' ? 'No RAG set' : p.rag)}{p.status === 'on_hold' ? ' · on hold' : ''}</span></div>
            <div className="prog" role="progressbar" aria-valuenow={p.pct_done} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks done"><i style={{ '--w': `${p.pct_done}%` } as React.CSSProperties} /></div>
            <div className="sub">{p.pct_done}% done · {p.open_tasks} open task{p.open_tasks === 1 ? '' : 's'}</div>
            <div className="sub">{ms ? `Next: ${ms.name} (${fmtDue(ms.due_at).text})` : 'No upcoming milestone'}</div>
            <div className="row" style={{ gap: 6 }}>
              <span className="chip">{p.open_risks} open risk{p.open_risks === 1 ? '' : 's'}</span>
              {p.high_risks > 0 && <span className="chip danger">{p.high_risks} high</span>}
              {p.pending_changes > 0 && <span className="chip warn">{p.pending_changes} pending change{p.pending_changes === 1 ? '' : 's'}</span>}
            </div>
          </Link>; })}
        {rows && !shown.length && <p style={{ color: 'var(--text-faint)' }}>No projects here yet.</p>}
      </div>
      {closed.length > 0 && <details><summary style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14 }}>Closed ({closed.length})</summary>
        <div className="grid3" style={{ marginTop: 10 }}>{closed.map((p) => <Link key={p.id} to={`/projects/${p.id}`} className="card row" style={{ color: 'inherit', justifyContent: 'space-between' }}><span style={{ overflowWrap: 'anywhere' }}>{p.name}</span><span className="chip">{p.kind}</span></Link>)}</div></details>}
    </>
  );
}
