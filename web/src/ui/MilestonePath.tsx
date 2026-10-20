import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Milestone } from '../../../shared/types.ts';
import { pathMilestones } from '../query.ts';
import { useReducedMotion, useScrollFrame } from '../motion.ts';

// The preview's curve (viewBox 660 × 190). x only grows along it, so a clip that grows from the left draws it by length.
const D = 'M24 140 C 120 140, 130 44, 214 54 S 320 150, 404 118 S 512 34, 636 44';
const W = 660, N = 100;
const md = (ymd: string | null) => { if (!ymd) return 'No date'; const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }); };
const short = (s: string) => (s.length > 20 ? `${s.slice(0, 19)}…` : s);

/** A project's milestones on a curved line drawn as it scrolls into view: done green, next amber and pulsing, ahead violet;
 *  a spark runs along the drawn part. More than 6 milestones: the 6 around today. */
export function MilestonePath({ milestones, today }: { milestones: Milestone[]; today: string }) {
  const pts = pathMilestones(milestones.filter((m) => !m.deleted_at), today);
  const reduce = useReducedMotion();
  const id = useId(), grad = `${id}g`, clipId = `${id}c`, blur = `${id}b`;
  const box = useRef<HTMLDivElement>(null), path = useRef<SVGPathElement>(null), svg = useRef<SVGSVGElement>(null), clip = useRef<SVGRectElement>(null), spark = useRef<SVGCircleElement>(null);
  const [samples, setSamples] = useState<{ x: number; y: number }[]>([]); // N+1 points at equal lengths along the curve
  const pp = useRef(0);
  const kick = useRef(() => {}); // starts the spark when it should run (set by the spark effect)
  const key = pts.map(({ m, state }) => `${m.id}:${state}`).join(); // re-light and re-clip when a milestone changes
  useLayoutEffect(() => {
    const p = path.current; if (!p) return;
    const L = p.getTotalLength();
    setSamples(Array.from({ length: N + 1 }, (_, i) => { const q = p.getPointAtLength((L * i) / N); return { x: q.x, y: q.y }; }));
  }, [pts.length > 0]);
  const at = (f: number) => { // the point at length fraction f (0..1), between samples
    const k = Math.min(N, Math.max(0, f * N)), i = Math.floor(k), a = samples[i], b = samples[Math.min(N, i + 1)], t = k - i;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  useScrollFrame(() => {
    const s = svg.current; if (!s || !samples.length) return;
    const r = s.getBoundingClientRect();
    // starts as its top enters and is whole once its bottom is in view, so the line ends drawn even as the page's last section
    pp.current = reduce ? 1 : Math.min(1, Math.max(0, (innerHeight * 0.95 - r.top) / (r.height * 0.9)));
    clip.current?.setAttribute('transform', `scale(${pp.current ? ((at(pp.current).x + 2) / W).toFixed(4) : 0} 1)`);
    s.querySelectorAll<SVGGElement>('g[data-at]').forEach((g) => g.classList.toggle('lit', pp.current >= Number(g.dataset.at) - 0.001));
    kick.current();
  }, [samples, reduce, key]);

  useLayoutEffect(() => { // a narrow screen scrolls the line sideways: start with the next milestone in the middle
    const b = box.current, s = svg.current, g = s?.querySelector<SVGGElement>('g.next');
    if (!b || !s || !g || b.scrollWidth <= b.clientWidth) return;
    const x = Number(g.dataset.x) * (s.getBoundingClientRect().width / W);
    b.scrollLeft = x - b.clientWidth / 2;
  }, [samples.length > 0]);

  useEffect(() => { // the spark: a slow loop along what is drawn, only while the line is on screen and partly drawn
    const el = box.current;
    if (reduce || !samples.length || !el) return;
    let sp = 0, raf = 0, seen = false;
    const travel = () => {
      if (!seen || pp.current <= 0) { raf = 0; spark.current?.setAttribute('opacity', '0'); return; }
      sp = (sp + 0.003) % 1;
      const q = at(sp * pp.current);
      spark.current?.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`);
      spark.current?.setAttribute('opacity', pp.current > 0.02 ? '0.9' : '0');
      raf = requestAnimationFrame(travel);
    };
    kick.current = () => { if (!raf && seen && pp.current > 0) raf = requestAnimationFrame(travel); };
    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; kick.current(); });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); kick.current = () => {}; };
  }, [samples, reduce]);

  if (!pts.length) return null;
  const label = `Milestones: ${pts.map(({ m, state }) => `${m.name}, ${md(m.due_at)}, ${state}`).join('; ')}`;
  return (
    <div className="pathbox"><div className="pathscroll" ref={box} tabIndex={0} role="region" aria-label="Milestone line">
      <svg ref={svg} viewBox={`0 0 ${W} 190`} role="img" aria-label={label}>
        <defs>
          <linearGradient id={grad} x1="0" x2="1"><stop offset="0" className="g0" /><stop offset=".45" className="g1" /><stop offset="1" className="g2" /></linearGradient>
          <filter id={blur} x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="3" /></filter>
          <clipPath id={clipId}><rect ref={clip} x="0" y="0" width={W} height="190" transform={reduce ? undefined : 'scale(0 1)'} /></clipPath>
        </defs>
        <path className="bed" d={D} />
        <path ref={path} className="drawn" d={D} stroke={`url(#${grad})`} clipPath={`url(#${clipId})`} />
        {!reduce && <circle ref={spark} className="spark" r="4" opacity="0" filter={`url(#${blur})`} />}
        {samples.length > 0 && pts.map(({ m, state }, i) => {
          const f = pts.length === 1 ? 0.5 : i / (pts.length - 1), p = at(f);
          const anchor = pts.length > 1 && i === 0 ? 'start' : pts.length > 1 && i === pts.length - 1 ? 'end' : 'middle', below = p.y < 95;
          return (
            <g key={m.id} className={state} data-at={f} data-x={p.x}>
              {state === 'next' && <circle className="pulse" cx={p.x} cy={p.y} r="10" />}
              <rect className="mk" x={p.x - 8} y={p.y - 8} width="16" height="16" rx="3" transform={`rotate(45 ${p.x} ${p.y})`} />
              <text className="mn" x={p.x} y={below ? p.y + 32 : p.y - 22} textAnchor={anchor}>{short(m.name)}<title>{m.name}</title></text>
              <text className="mdt" x={p.x} y={below ? p.y + 48 : p.y - 38} textAnchor={anchor}>{md(m.due_at)}</text>
            </g>
          );
        })}
      </svg>
    </div></div>
  );
}
