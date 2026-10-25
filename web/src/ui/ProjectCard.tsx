import { useRef, type CSSProperties } from 'react';
import type { PortfolioRow, Rag } from '../../../shared/types.ts';
import { Link } from '../router.ts';
import { fmtDue } from '../dates.ts';
import { useTilt } from '../motion.ts';
import { projectColor } from './colors.ts';

const RAG: Record<Rag, { c: string; label: string }> = {
  green: { c: 'var(--ok)', label: 'Green' }, amber: { c: 'var(--warn)', label: 'Amber' }, red: { c: 'var(--danger)', label: 'Red' }, none: { c: 'var(--text-faint)', label: 'No RAG' },
};
const vars = (o: Record<string, string | number>) => o as CSSProperties;

/** The preview's .rag pill: a dot and the word, in the RAG colour. */
export function RagPill({ rag }: { rag: Rag }) {
  return <span className="rag" style={vars({ '--rc': RAG[rag].c })}><i />{RAG[rag].label}</span>;
}

/** The preview's .pring: a conic ring filled to `pct` in the project's colour, the number in the middle. */
export function Ring({ pct, color }: { pct: number; color: string }) {
  return <div className="pring" style={vars({ '--v': pct, '--pc': color })} role="img" aria-label={`${pct}% of tasks done`}><b>{pct}%</b></div>;
}

/** A portfolio card: tilt and glare follow the pointer (useTilt), the colour dot, RAG, ring, next milestone and the open and high risks. */
export function ProjectCard({ p }: { p: PortfolioRow }) {
  const ref = useRef<HTMLElement>(null);
  useTilt(ref, 12);
  const color = projectColor(p), ms = p.next_milestone;
  return (
    <article className="pcard" ref={ref} style={vars({ '--pc': color })}>
      <div className="glare" aria-hidden="true" />
      <Link to={`/projects/${p.id}`} className="lift">
        <div className="prow"><RagPill rag={p.rag} /><span className="chip" style={vars({ '--sc': color })}><i />{p.kind}</span></div>
        <div className="pmain">
          <Ring pct={p.pct_done} color={color} />
          <div className="ptx"><h3>{p.name}</h3>{p.rag_reason && <p>{p.rag_reason}</p>}<p>{[p.status === 'on_hold' && 'On hold', `${p.pct_done}% done`, `${p.open_tasks} open task${p.open_tasks === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p></div>
        </div>
        <div className="prow"><span>{ms ? `Next: ${ms.name} · ${fmtDue(ms.due_at).text}` : 'No upcoming milestone'}</span></div>
        <div className="prow"><span>{p.open_risks} open risk{p.open_risks === 1 ? '' : 's'}</span>
          <span className="mono" style={{ color: p.high_risks ? 'var(--danger)' : 'var(--text-faint)' }}>{p.high_risks} high</span></div>
        {p.budget_planned != null && p.budget_planned > 0 && (() => {
          const spent = p.budget_spent ?? 0, pct = Math.round((100 * spent) / p.budget_planned);
          return <div className="pbud"><div className="prow"><span>Budget: {p.currency} {spent.toLocaleString()} of {p.budget_planned.toLocaleString()}</span><span className="mono" style={{ color: pct > 100 ? 'var(--danger)' : undefined }}>{pct}% spent{pct > 100 ? ' · over' : ''}</span></div>
            <div className="pb-bar" aria-hidden="true"><i className="pb-spent" style={{ width: `${Math.min(100, pct)}%` }} /></div></div>;
        })()}
        {p.pending_changes > 0 && <div className="prow" style={{ color: 'var(--warn)' }}><span>{p.pending_changes} pending change{p.pending_changes === 1 ? '' : 's'}</span></div>}
      </Link>
    </article>
  );
}
