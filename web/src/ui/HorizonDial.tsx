import { useRef, type CSSProperties } from 'react';
import type { Horizon } from '../../../shared/types.ts';
import { unwrap, useReducedMotion } from '../motion.ts';
import { HORIZON_COLOR } from './colors.ts';

export const HORIZONS: Horizon[] = ['short', 'medium', 'long'];
export const HORIZON_LABEL: Record<Horizon, string> = { short: 'This week', medium: 'This quarter', long: 'This year and beyond' };
export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const DEG: Record<Horizon, number> = { short: -60, medium: 60, long: 180 };
const RAD = Math.PI / 180;
const pt = (d: number, r: number) => [135 + r * Math.sin(d * RAD), 135 - r * Math.cos(d * RAD)];
const TICKS = Array.from({ length: 72 }, (_, i) => {
  const major = i % 6 === 0, [x1, y1] = pt(i * 5, major ? 116 : 124), [x2, y2] = pt(i * 5, 129);
  return { major, x1, y1, x2, y2 };
});
const arc = (from: number, to: number, r: number) => { const [x1, y1] = pt(from, r), [x2, y2] = pt(to, r); return `M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}`; };

/** The tilted horizon dial: a needle that springs to the chosen horizon (the short way round) and a group of pressed buttons. */
export function HorizonDial({ value, counts, onChange }: { value: Horizon; counts: Record<Horizon, number>; onChange: (h: Horizon) => void }) {
  const dial = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const deg = useRef(DEG[value]);
  deg.current = unwrap(deg.current, DEG[value]); // same result when rendered twice
  return (
    <div className="dialbox">
      <div className="dialstage"
        onPointerMove={(e) => { if (reduce || e.pointerType !== 'mouse' || !dial.current) return; const r = e.currentTarget.getBoundingClientRect(); dial.current.style.transform = `rotateX(50deg) rotateZ(${(((e.clientX - r.left) / r.width - 0.5) * -18).toFixed(2)}deg)`; }}
        onPointerLeave={() => { if (dial.current) dial.current.style.transform = ''; }}>
        <div className="dial" ref={dial} style={{ ['--nc' as string]: HORIZON_COLOR[value] }}>
          <div className="face" />
          <svg viewBox="0 0 270 270" aria-hidden="true">
            {TICKS.map((t, i) => <line key={i} className={t.major ? 'tk maj' : 'tk'} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />)}
            {HORIZONS.map((k) => {
              const [x, y] = pt(DEG[k], 82), c: CSSProperties = { stroke: HORIZON_COLOR[k] };
              return <g key={k}><path className="arc" d={arc(DEG[k] - 48, DEG[k] + 48, 104)} style={c} /><text x={x} y={y + 4} textAnchor="middle" style={{ fill: HORIZON_COLOR[k] }}>{k.toUpperCase()}</text></g>;
            })}
          </svg>
          <div className="needle" style={{ ['--deg' as string]: `${deg.current}deg` }} />
          <div className="hub" />
        </div>
      </div>
      <div className="dialseg" role="group" aria-label="Horizon">
        {HORIZONS.map((k) => (
          <button type="button" key={k} aria-pressed={value === k} aria-label={`${cap(k)}, ${counts[k]} open`} style={{ ['--hc' as string]: HORIZON_COLOR[k] }} onClick={() => onChange(k)}>
            <i />{cap(k)}<span>{counts[k]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
