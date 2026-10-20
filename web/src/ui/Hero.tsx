import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { angleTo, springStep, unwrap, useReducedMotion } from '../motion.ts';

// The preview's compass (docs/ui-directions.html), as JSX: 120 ticks, the four cardinal letters, the rim and the pointer.
const RAD = Math.PI / 180;
const TICKS = Array.from({ length: 120 }, (_, i) => {
  const a = i * 3 * RAD, major = i % 10 === 0, r1 = major ? 128 : 134;
  return { major, x1: 150 + r1 * Math.sin(a), y1: 150 - r1 * Math.cos(a), x2: 150 + 141 * Math.sin(a), y2: 150 - 141 * Math.cos(a) };
});
const CARDINALS = [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const;

/** The compass whose pointer follows the cursor over its parent element (the hero, or the sign-in stage) and swings back to
 *  north when the cursor leaves. `readout` adds the HEADING 000° line, placed by the parent's CSS. */
export function CursorCompass({ readout = false }: { readout?: boolean }) {
  const box = useRef<HTMLDivElement>(null), tilt = useRef<HTMLDivElement>(null), needle = useRef<SVGGElement>(null), heading = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = box.current, area = el?.parentElement;
    if (!el || !area) return;
    let target = 0, angle = 0, vel = 0, raf = 0;
    const draw = () => {
      needle.current?.setAttribute('transform', `rotate(${angle.toFixed(2)} 150 150)`);
      if (heading.current) heading.current.textContent = `${String(Math.round(((angle % 360) + 360) % 360) % 360).padStart(3, '0')}°`;
    };
    const step = () => {
      [angle, vel] = springStep(angle, vel, target);
      if (Math.abs(target - angle) < 0.05 && Math.abs(vel) < 0.05) { angle = target; vel = 0; raf = 0; } else raf = requestAnimationFrame(step);
      draw();
    };
    const go = () => { if (reduce) { angle = target; draw(); } else if (!raf) raf = requestAnimationFrame(step); };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      target = unwrap(target, angleTo(cx, cy, e.clientX, e.clientY));
      if (!reduce && tilt.current) tilt.current.style.transform = `perspective(700px) rotateX(${((-(e.clientY - cy) / r.height) * 14).toFixed(2)}deg) rotateY(${(((e.clientX - cx) / r.width) * 14).toFixed(2)}deg)`;
      go();
    };
    const leave = () => { target = Math.round(target / 360) * 360; if (tilt.current) tilt.current.style.transform = ''; go(); };
    draw();
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerleave', leave);
    return () => { area.removeEventListener('pointermove', move); area.removeEventListener('pointerleave', leave); cancelAnimationFrame(raf); };
  }, [reduce]);
  return (
    <>
      <div className="compass" ref={box} aria-hidden="true">
        <div className="tilt" ref={tilt}>
          <svg viewBox="0 0 300 300">
            {TICKS.map((t, i) => <line key={i} className={t.major ? 'tk maj' : 'tk'} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />)}
            {CARDINALS.map(([l, d]) => <text key={l} className={l === 'N' ? 'n' : undefined} x={150 + 116 * Math.sin(d * RAD)} y={154 - 116 * Math.cos(d * RAD)} textAnchor="middle">{l}</text>)}
            <circle className="rim" cx="150" cy="150" r="141" />
            <g ref={needle}>
              <line className="lead" x1="150" y1="82" x2="150" y2="40" />
              <path className="tip" d="M150 4 L166 46 L150 36 L134 46 Z" />
              <path className="tip2" d="M150 4 L150 36 L134 46 Z" />
              <circle className="dots" cx="150" cy="150" r="148" />
            </g>
          </svg>
          <div className="badge"><img src="/icons/icon-512.png" alt="" width={512} height={512} /></div>
        </div>
      </div>
      {readout && <div className="readout" aria-hidden="true">HEADING <b ref={heading}>000°</b></div>}
    </>
  );
}

// Floating shapes behind the greeting: colour, kind, look, left %, top %, size px (the preview's seven, in tokens).
const SHAPES: [string, 'circle' | 'tri' | 'sq', 'fill' | 'line', number, number, number][] = [
  ['var(--accent)', 'circle', 'fill', 4, 12, 96], ['var(--h-medium)', 'tri', 'line', 30, 58, 120], ['var(--h-short)', 'sq', 'fill', 22, 6, 62],
  ['var(--h-long)', 'circle', 'line', 46, 70, 80], ['var(--accent)', 'sq', 'line', 40, 18, 48], ['var(--swatch-4)', 'tri', 'fill', 10, 64, 70],
  ['var(--accent-dim)', 'circle', 'fill', 56, 34, 34],
];

function Shape({ s: [c, kind, look, x, y, size], i }: { s: (typeof SHAPES)[number]; i: number }) {
  const base: CSSProperties = { left: `${x}%`, top: `${y}%`, width: size, height: size, animationDelay: `-${i * 1.7}s` };
  if (kind === 'tri') return look === 'line'
    ? <svg className="shape line" style={base} viewBox="0 0 100 100"><polygon points="50,6 96,94 4,94" fill="none" strokeWidth="2.5" style={{ stroke: c }} /></svg>
    : <div className="shape fill" style={{ ...base, background: c, clipPath: 'polygon(50% 0,100% 100%,0 100%)' }} />;
  return <div className={`shape ${look}`} style={{ ...base, ...(look === 'line' ? { border: `1.5px solid ${c}` } : { background: c }), borderRadius: kind === 'circle' ? '50%' : 12, rotate: kind === 'sq' ? '18deg' : undefined }} />;
}

/** The seven floating shapes (also the sign-in stage's backdrop); positioned in % of the parent. */
export const FloatingShapes = () => <>{SHAPES.map((s, i) => <Shape key={i} s={s} i={i} />)}</>;

/** A number that counts up to `to` over 900 ms (ease-out), from whatever it showed before. */
function Count({ to }: { to: number }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? to : 0);
  const shown = useRef(n);
  useEffect(() => {
    if (reduce) { shown.current = to; setN(to); return; }
    const from = shown.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      shown.current = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
      setN(shown.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, reduce]);
  return <b>{n}</b>;
}

type HeroStats = { today: number; overdue: number; nextMilestone: { name: string; days: number } | null };

/** Today's greeting: grid and floating-shape layers with pointer parallax, the cursor compass, the date, the greeting and three counters. */
export function Hero({ greeting, stats }: { greeting: string; stats: HeroStats }) {
  const hero = useRef<HTMLElement>(null), grid = useRef<HTMLDivElement>(null), shapes = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = hero.current;
    if (!el || reduce) return;
    const layers: [HTMLDivElement | null, number][] = [[grid.current, 4], [shapes.current, 12]];
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      layers.forEach(([l, d]) => { if (l) l.style.transform = `translate3d(${(-x * d).toFixed(2)}px,${(-y * d).toFixed(2)}px,0)`; });
    };
    const leave = () => layers.forEach(([l]) => { if (l) l.style.transform = ''; });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); leave(); };
  }, [reduce]);
  const ms = stats.nextMilestone;
  return (
    <section className="hero" ref={hero} aria-labelledby="hero-h">
      <div className="layer hgrid" ref={grid} aria-hidden="true" />
      <div className="layer" ref={shapes} aria-hidden="true"><FloatingShapes /></div>
      <CursorCompass readout />
      <div className="hcopy">
        <span className="eyebrow">{new Date().toLocaleDateString('en-CA', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <h1 id="hero-h"><span>{greeting}</span>, Vlad</h1>
        <div className="hstats">
          <div className="hstat"><Count to={stats.today} /> for today</div>
          <div className={`hstat${stats.overdue ? ' alert' : ''}`}><Count to={stats.overdue} /> overdue</div>
          {ms && (ms.days === 0
            ? <div className="hstat"><b>Today</b> {ms.name}</div>
            : <div className="hstat"><Count to={ms.days} /> {ms.days === 1 ? 'day' : 'days'} to {ms.name}</div>)}
        </div>
      </div>
    </section>
  );
}

export const greetingFor = (hour: number) => `Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}`;
