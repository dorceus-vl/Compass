import { useState } from 'react';
import { useLibrary } from '../library.ts';
import { Link } from '../router.ts';

export function LibraryView() {
  const { pages, ready, find } = useLibrary();
  const [q, setQ] = useState('');
  const hits = q.trim() ? find(q, 20) : null;
  // Pages arrive sorted by section order; lessons and imports follow.
  const groups: [string, typeof pages][] = [];
  for (const p of pages.filter((p) => p.source === 'bundled')) { const g = groups.find((x) => x[0] === p.section); if (g) g[1].push(p); else groups.push([p.section, [p]]); }
  for (const [name, src] of [['Lessons', 'lesson'], ['Imports', 'import']] as const) { const xs = pages.filter((p) => p.source === src); if (xs.length) groups.push([name, xs]); }
  return (
    <>
      <div className="head"><div><div className="eyebrow">Library</div><h1 style={{ marginTop: 6 }}>Project <b>know-how</b></h1>
        <div className="sub">{pages.length} page{pages.length === 1 ? '' : 's'}, searchable offline</div></div></div>
      <input className="field" type="search" placeholder="Search the library" aria-label="Search the library" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits && (hits.length
        ? <div className="lib-list">{hits.map(({ page, snippet }) => (
          <Link key={page.slug} to={`/library/${page.slug}`} className="card lib-hit">
            <div className="row" style={{ justifyContent: 'space-between' }}><b>{page.title}</b><span className="chip">{page.section}</span></div>
            <p>{snippet}</p>
          </Link>))}</div>
        : <div className="card"><p style={{ margin: 0 }}>Nothing found for “{q.trim()}”.</p></div>)}
      {!hits && !pages.length && <div className="card"><p style={{ margin: 0 }}>{ready ? 'The library is empty.' : 'Loading the library…'}</p></div>}
      {!hits && groups.map(([name, xs]) => (
        <div className="card" key={name}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>{name}</div>
          <div className="lib-list">{xs.map((p) => <Link key={p.slug} to={`/library/${p.slug}`} className="lib-link">{p.title}</Link>)}</div>
        </div>))}
    </>
  );
}
