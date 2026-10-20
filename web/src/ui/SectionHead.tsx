import type { ReactNode } from 'react';

/** A section's eyebrow and heading, with anything on the right (a note, a filter, a link). */
export function SectionHead({ eyebrow, title, id, children }: { eyebrow: ReactNode; title: ReactNode; id?: string; children?: ReactNode }) {
  return (
    <div className="bhead">
      <div><span className="eyebrow">{eyebrow}</span><h2 id={id}>{title}</h2></div>
      {children}
    </div>
  );
}
