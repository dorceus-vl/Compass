import { checklistProgress } from '../../../shared/deps.ts';

/** "3/5" with a slim bar for a task that has a checklist (nothing otherwise). The count is text, so it never relies on colour. Styles: .chip.chk in app.css. */
export function ChecklistChip({ checklist }: { checklist: string | null }) {
  const p = checklistProgress(checklist);
  if (!p) return null;
  return (
    <span className="chip chk" title={`${p.done} of ${p.total} checklist items done`} aria-label={`Checklist: ${p.done} of ${p.total} done`}>
      <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false"><rect x="1.5" y="1.5" width="9" height="9" rx="2" /><path d="M3.8 6.2l1.6 1.6 2.9-3.4" /></svg>
      {p.done}/{p.total}
      <span className="cbar" aria-hidden="true"><em style={{ width: `${Math.round((100 * p.done) / p.total)}%` }} /></span>
    </span>
  );
}
