import type { DocBlock, TemplateDoc } from '../docs/templates.ts';

function Block({ b }: { b: DocBlock }) {
  switch (b.t) {
    case 'p': return b.text ? <p>{b.text}</p> : <p className="pd-blank" aria-hidden="true">&nbsp;</p>;
    case 'list': return <ul>{b.items.map((i, k) => <li key={k}>{i}</li>)}</ul>;
    case 'fields': return <table className="pd-fields"><tbody>{b.pairs.map(([k, v], i) => <tr key={i}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody></table>;
    case 'table': return (
      <table><thead><tr>{b.headers.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>);
  }
}

/** The same document the Word and Markdown writers get, as HTML for the screen preview and the print pipeline. Text is rendered as text. */
export function PrintDoc({ doc }: { doc: TemplateDoc }) {
  return (
    <article className="printdoc">
      <h1>{doc.title}</h1>
      {doc.subtitle && <p className="pd-sub">{doc.subtitle}</p>}
      {doc.sections.map((s, i) => <section key={i}><h2>{s.heading}</h2>{s.blocks.map((b, j) => <Block key={j} b={b} />)}</section>)}
    </article>
  );
}
