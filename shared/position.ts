// Fractional ordering inside a board column: a move writes one row, not the whole column. Shared by the Worker and the web app.
// ponytail: positions can get very close after many moves; renumber the column if a gap drops under 1e-6.
export function positionBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1000;
  if (prev === null) return next! - 1000;
  if (next === null) return prev + 1000;
  return (prev + next) / 2;
}
