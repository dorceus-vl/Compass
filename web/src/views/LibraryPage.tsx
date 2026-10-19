import { useLibrary } from '../library.ts';
import { Markdown } from '../ui/Markdown.tsx';
import { Link } from '../router.ts';

export function LibraryPageView({ slug }: { slug: string }) {
  const { pages, ready } = useLibrary();
  const page = pages.find((p) => p.slug === slug);
  if (!page) return ready ? <div className="card"><p style={{ margin: 0 }}>No such page. <Link to="/library">Back to the library</Link></p></div> : null;
  return (
    <>
      <div className="head"><div><div className="eyebrow">{page.section}</div><h1 style={{ marginTop: 6, overflowWrap: 'anywhere' }}>{page.title}</h1></div>
        <div className="row"><Link to="/library" className="btn">Library</Link><Link to={`/copilot?page=${encodeURIComponent(page.slug)}`} className="btn primary">Ask about this page</Link></div></div>
      <div className="card"><Markdown text={page.body} /></div>
    </>
  );
}
