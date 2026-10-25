// Task estimates (v2.4, P4): "90", "30m", "2h", "1.5h", "1d", "1h 30m" <-> whole minutes.
export const MAX_ESTIMATE_MINUTES = 57_600;

/** Whole minutes, or null for an empty, bad or over-cap (40 days of dayHours) string. */
export function parseEstimate(s: string, dayHours: number): number | null {
  const str = s.trim().toLowerCase();
  if (!str) return null;
  const unit = { d: dayHours * 60, h: 60, m: 1 } as const;
  let min: number;
  if (/^\d+(\.\d+)?$/.test(str)) min = Number(str);
  else {
    if (!/^(\d+(\.\d+)?\s*[dhm]\s*)+$/.test(str)) return null;
    min = 0;
    for (const m of str.matchAll(/(\d+(?:\.\d+)?)\s*([dhm])/g)) min += Number(m[1]) * unit[m[2] as 'd' | 'h' | 'm'];
  }
  min = Math.round(min);
  return min <= 40 * dayHours * 60 ? min : null;
}

export function formatEstimate(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}
