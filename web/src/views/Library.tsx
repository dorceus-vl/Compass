import { useState } from 'react';
import { useLibrary } from '../library.ts';
import { Link } from '../router.ts';
import { Icon } from '../ui/Shell.tsx';
import { fold, tokens } from '../../../shared/search.ts';

/** The snippet with the words that matched the query wrapped in <mark> (text nodes only, so a page can never inject markup). */
export function Highlight({ text, q }: { text: string; q: string }) {
  const want = new Set(tokens(q)), last = tokens(q).at(-1), prefix = !/\s$/.test(q);
  return <>{text.split(/([\p{L}\p{N}]+)/u).map((w, i) => {
    const t = i % 2 && tokens(w)[0];
    return t && (want.has(t) || (prefix && last && fold(w).startsWith(last))) ? <mark key={i}>{w}</mark> : w;
  })}</>;
}

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
            <p><Highlight text={snippet} q={q} /></p>
          </Link>))}</div>
        : <div className="card"><p style={{ margin: 0 }}>Nothing found for “{q.trim()}”.</p></div>)}
      {!hits && !pages.length && <div className="card"><p style={{ margin: 0 }}>{ready ? 'The library is empty.' : 'Loading the library…'}</p></div>}
      {!hits && groups.length > 0 && <div className="lib-tree">{groups.map(([name, xs]) => (
        <section className="card lib-sec" key={name} aria-label={name}>
          <div className="sechead"><span className="secico"><Icon name="library" /></span><div><h2>{name}</h2></div><span className="chip count">{xs.length}</span></div>
          <div className="lib-list">{xs.map((p) => <Link key={p.slug} to={`/library/${p.slug}`} className="lib-link">{p.title}</Link>)}</div>
        </section>))}</div>}
    </>
  );
}
