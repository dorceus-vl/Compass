import { useEffect, useState } from 'react';
import type { PortfolioRow } from '../../../shared/types.ts';
import { api, SignedOut } from '../api.ts';
import { idb } from '../store/db.ts';
import { useStore } from '../store/useStore.ts';
import { Link } from '../router.ts';
import { ProjectCard } from '../ui/ProjectCard.tsx';
import { projectColor } from '../ui/colors.ts';

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
      <div className="pgrid">
        {shown.map((p) => <ProjectCard key={p.id} p={p} />)}
        {rows && !shown.length && <p className="hint">No projects here yet.</p>}
      </div>
      {closed.length > 0 && <details><summary style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14 }}>Closed ({closed.length})</summary>
        <div className="grid3" style={{ marginTop: 10 }}>{closed.map((p) => <Link key={p.id} to={`/projects/${p.id}`} className="acard row" style={{ color: 'inherit', justifyContent: 'space-between', ['--ac' as string]: projectColor(p) }}><span style={{ overflowWrap: 'anywhere' }}>{p.name}</span><span className="chip">{p.kind}</span></Link>)}</div></details>}
    </>
  );
}
