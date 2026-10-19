import type { ReactNode } from 'react';
import { parseMarkdown, type Inline } from '../md.ts';
import { Link } from '../router.ts';

// Builds React elements only: text is always a text node, so nothing in a page can become HTML or script.
const inline = (xs: Inline[]): ReactNode[] => xs.map((x, i) => {
  switch (x.t) {
    case 'text': return x.v;
    case 'b': return <strong key={i}>{inline(x.c)}</strong>;
    case 'i': return <em key={i}>{inline(x.c)}</em>;
    case 'code': return <code key={i}>{x.v}</code>;
    case 'link': return <a key={i} href={x.href} target="_blank" rel="noopener noreferrer">{inline(x.c)}</a>;
    case 'page': return <Link key={i} to={`/library/${x.slug}`}>{x.label}</Link>;
  }
});

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parseMarkdown(text).map((b, i) => {
        switch (b.t) {
          case 'h': { const H = (`h${b.level + 1}`) as 'h2' | 'h3' | 'h4'; return <H key={i}>{inline(b.c)}</H>; } // the page title is the h1
          case 'p': return <p key={i}>{inline(b.c)}</p>;
          case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
          case 'ol': return <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
          case 'code': return <pre key={i}><code>{b.v}</code></pre>;
          case 'quote': return <blockquote key={i}>{inline(b.c)}</blockquote>;
          case 'hr': return <hr key={i} />;
          case 'table': return (
            <div key={i} style={{ overflowX: 'auto' }}>
              <table><thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table>
            </div>
          );
        }
      })}
    </div>
  );
}

