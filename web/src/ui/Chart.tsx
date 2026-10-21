import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RiskMatrix, Severity } from '../../../shared/dashboard.ts';

// Hand-drawn SVG charts for the project dashboard (v2.2). No library, tokens only, static (complete at rest).
// Each chart has a text summary that the drawing points to with aria-describedby, a "Show as table" toggle, and never relies on colour alone:
// lines differ by dash and marker, bars carry their value, the risk grid carries a letter and a pattern.

export interface ChartTable { head: string[]; rows: (string | number)[][] }

/** The width of an element in pixels, kept up to date (a fallback until it is measured). */
function useWidth(fallback = 320) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, set] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => set(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

/** Title, one-sentence summary, the drawing (given the width and the id of the summary) and the table toggle. */
export function ChartFrame({ id, title, summary, table, children }: { id: string; title: string; summary: string; table: ChartTable; children: (w: number, describedBy: string) => ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  const { ref, w } = useWidth();
  const sum = `${id}-sum`;
  return (
    <figure className="chart" aria-labelledby={`${id}-t`}>
      <figcaption className="chart-head">
        <h3 id={`${id}-t`}>{title}</h3>
        <button type="button" className="btn chart-tog" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>{asTable ? 'Show the chart' : 'Show as table'}</button>
      </figcaption>
      <p className="chart-sum" id={sum}>{summary}</p>
      <div ref={ref} className="chart-body">
        {asTable
          ? <div className="scroll-x"><table className="chart-table" aria-describedby={sum}>
              <thead><tr>{table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j} className="num">{c}</td>))}</tr>)}</tbody>
            </table></div>
          : children(w, sum)}
      </div>
    </figure>
  );
}

const M = { l: 32, r: 12, t: 14, b: 26 };
/** 0 to a round maximum with three ticks. */
function scale(max: number) {
  const top = Math.max(2, Math.ceil(max / 2) * 2);
  return { top, ticks: [0, top / 2, top] };
}
function ticks(n: number, want: number) { // x label positions: first, last and a few between
  if (n <= want) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: want }, (_, k) => Math.round((k * (n - 1)) / (want - 1)));
}

export interface LineSeries { name: string; values: (number | null)[]; dashed?: boolean; markers?: boolean; tone: 'accent' | 'dim' | 'danger' }
const TONE = { accent: 'var(--accent)', dim: 'var(--text-dim)', danger: 'var(--danger)' } as const;

/** One or more lines over shared x labels. `marker` draws a dotted upright line (today) at that index. */
export function LineChart({ w, h = 210, labels, series, marker, describedBy, label }: { w: number; h?: number; labels: string[]; series: LineSeries[]; marker?: { index: number; label: string }; describedBy: string; label: string }) {
  const n = labels.length;
  const max = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const { top, ticks: yt } = scale(max);
  const iw = w - M.l - M.r, ih = h - M.t - M.b;
  const x = (i: number) => M.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => M.t + ih - (v / top) * ih;
  const path = (vals: (number | null)[]) => {
    let d = '', pen = false;
    vals.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  return (
    <>
      <svg className="chart-svg" role="img" aria-label={label} aria-describedby={describedBy} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {yt.map((v) => <g key={v}><line x1={M.l} x2={w - M.r} y1={y(v)} y2={y(v)} className="ch-grid" /><text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="ch-t">{v}</text></g>)}
        {ticks(n, w < 420 ? 3 : 5).map((i) => <text key={i} x={x(i)} y={h - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="ch-t">{labels[i]}</text>)}
        {marker && marker.index >= 0 && marker.index < n && <g><line x1={x(marker.index)} x2={x(marker.index)} y1={M.t} y2={M.t + ih} className="ch-mark" /><text x={x(marker.index)} y={M.t - 3} textAnchor={marker.index > n * 0.8 ? 'end' : 'middle'} className="ch-t">{marker.label}</text></g>}
        {series.map((s) => <path key={s.name} d={path(s.values)} fill="none" stroke={TONE[s.tone]} strokeWidth={s.dashed ? 1.75 : 2.25} strokeDasharray={s.dashed ? '6 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
        {series.filter((s) => s.markers).map((s) => s.values.map((v, i) => v === null ? null : <g key={`${s.name}${i}`}><circle cx={x(i)} cy={y(v)} r={3.5} fill="var(--card)" stroke={TONE[s.tone]} strokeWidth={2} />{n <= 9 && <text x={x(i)} y={y(v) - 8} textAnchor="middle" className="ch-v">{v}</text>}</g>))}
        {series.filter((s) => !s.markers && !s.dashed).map((s) => { const i = s.values.reduce<number>((a, v, k) => (v === null ? a : k), -1); return i < 0 ? null : <g key={`${s.name}end`}><circle cx={x(i)} cy={y(s.values[i]!)} r={3.5} fill={TONE[s.tone]} /><text x={x(i) + (i > n * 0.85 ? -7 : 7)} y={y(s.values[i]!) - 7} textAnchor={i > n * 0.85 ? 'end' : 'start'} className="ch-v">{s.values[i]}</text></g>; })}
      </svg>
      <ul className="chart-legend" aria-hidden="true">
        {series.map((s) => <li key={s.name}><svg width="30" height="10"><line x1="2" x2="28" y1="5" y2="5" stroke={TONE[s.tone]} strokeWidth="2.25" strokeDasharray={s.dashed ? '6 4' : undefined} strokeLinecap="round" />{s.markers && <circle cx="15" cy="5" r="3.5" fill="var(--card)" stroke={TONE[s.tone]} strokeWidth="2" />}</svg>{s.name}</li>)}
        {marker && <li><svg width="30" height="10"><line x1="15" x2="15" y1="0" y2="10" className="ch-mark" /></svg>{marker.label}</li>}
      </ul>
    </>
  );
}

/** Bars with the value written on each; `partial` marks the last bar (this week so far) with a hatch. */
export function BarChart({ w, h = 190, labels, values, partialLast, describedBy, label, id }: { w: number; h?: number; labels: string[]; values: number[]; partialLast?: boolean; describedBy: string; label: string; id: string }) {
  const { top, ticks: yt } = scale(Math.max(0, ...values));
  const iw = w - M.l - M.r, ih = h - M.t - M.b, n = values.length, slot = iw / Math.max(1, n), bw = Math.min(36, slot * 0.62), step = slot < 46 ? 2 : 1; // narrow: label every second bar, counting back from this week
  const y = (v: number) => M.t + ih - (v / top) * ih;
  return (
    <>
      <svg className="chart-svg" role="img" aria-label={label} aria-describedby={describedBy} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <defs><pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--card)" /><rect width="3" height="6" fill="var(--accent)" /></pattern></defs>
        {yt.map((v) => <g key={v}><line x1={M.l} x2={w - M.r} y1={y(v)} y2={y(v)} className="ch-grid" /><text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="ch-t">{v}</text></g>)}
        {values.map((v, i) => {
          const cx = M.l + slot * i + slot / 2, last = partialLast && i === n - 1;
          return <g key={i}>
            <rect x={cx - bw / 2} y={y(v)} width={bw} height={Math.max(0, M.t + ih - y(v))} rx={3} fill={last ? `url(#${id}-hatch)` : 'var(--accent)'} stroke="var(--accent)" strokeWidth={last ? 1.5 : 0} />
            <text x={cx} y={y(v) - 5} textAnchor="middle" className="ch-v">{v}</text>
            {(n - 1 - i) % step === 0 && <text x={cx} y={h - 8} textAnchor="middle" className="ch-t">{labels[i]}</text>}
          </g>;
        })}
      </svg>
      {partialLast && <ul className="chart-legend" aria-hidden="true"><li><svg width="20" height="12"><rect width="20" height="12" rx="2" fill={`url(#${id}-hatch)`} stroke="var(--accent)" strokeWidth="1.5" /></svg>This week so far</li></ul>}
    </>
  );
}

const SEV: Record<Severity, { letter: string; name: string; range: string }> = { high: { letter: 'H', name: 'High', range: '15 and up' }, medium: { letter: 'M', name: 'Medium', range: '8 to 14' }, low: { letter: 'L', name: 'Low', range: 'up to 7' } };

/** The 5×5 probability by impact grid: the count in each cell, the severity as a letter and a pattern (never colour alone). */
export function RiskGrid({ matrix, describedBy, label }: { matrix: RiskMatrix; describedBy: string; label: string }) {
  return (
    <div className="rgrid-wrap">
      <div className="rgrid" role="img" aria-label={label} aria-describedby={describedBy}>
        <span className="rg-ax rg-y" aria-hidden="true">Probability</span>
        {[5, 4, 3, 2, 1].map((p) => [
          <span key={`t${p}`} className="rg-tick" aria-hidden="true">{p}</span>,
          ...matrix.cells.filter((c) => c.p === p).map((c) => (
            <span key={`${c.p}${c.i}`} className={`rg-cell sev-${c.severity} ${c.count ? 'has' : ''}`} aria-hidden="true"><i>{SEV[c.severity].letter}</i><b>{c.count || ''}</b></span>)),
        ])}
        <span className="rg-corner" aria-hidden="true" />
        {[1, 2, 3, 4, 5].map((i) => <span key={`i${i}`} className="rg-tick rg-xt" aria-hidden="true">{i}</span>)}
        <span className="rg-ax rg-x" aria-hidden="true">Impact, 1 to 5</span>
      </div>
      <ul className="chart-legend" aria-hidden="true">
        {(['high', 'medium', 'low'] as const).map((s) => <li key={s}><span className={`rg-sw sev-${s}`}><i>{SEV[s].letter}</i></span>{SEV[s].name} ({SEV[s].range})</li>)}
      </ul>
    </div>
  );
}
export { SEV };
