/** "Blocked": a lock icon and the word, so it never relies on colour alone. Sits in a card's chip row (styles: .chip.blocked in app.css). */
export function BlockedChip() {
  return (
    <span className="chip blocked" title="Waiting on another task">
      <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false"><rect x="2" y="5.5" width="8" height="5.5" rx="1.5" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" /></svg>
      Blocked
    </span>
  );
}
