// Pure maths first (importable by node self-checks: nothing here touches window at import time), hooks after.
import { useEffect, useSyncExternalStore } from 'react';

export const lensFactor = (cardCenterY: number, viewportMidY: number, viewportH: number) => Math.max(0, 1 - Math.abs((cardCenterY - viewportMidY) / viewportH) * 2.4);
export const lensOffset = (cardCenterY: number, viewportMidY: number, viewportH: number) => (cardCenterY - viewportMidY) / viewportH;

/** Bearing from (cx, cy) to (px, py) in degrees: 0 = up, clockwise. */
export function angleTo(cx: number, cy: number, px: number, py: number): number {
  return (Math.atan2(px - cx, cy - py) * 180) / Math.PI;
}

/** The equivalent of `next` closest to `prev` (adds or removes whole turns), so a needle never spins the long way round. */
export function unwrap(prev: number, next: number): number {
  return next + 360 * Math.round((prev - next) / 360);
}

/** One step of a damped spring: returns the new [position, velocity]. k = 0.08, damping = 0.78 match the preview. */
export function springStep(pos: number, vel: number, target: number, k = 0.08, damping = 0.78): [number, number] {
  const v = (vel + (target - pos) * k) * damping;
  return [pos + v, v];
}

/** Stable index 0..n-1 from a string (FNV-1a), for project swatches. */
export function hashIndex(s: string, n: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) % n;
}

// ---- hooks (browser only; every window access is inside a function) ----

const REDUCE = '(prefers-reduced-motion: reduce)';
const reducedNow = () => typeof matchMedia === 'function' && matchMedia(REDUCE).matches;

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(REDUCE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    reducedNow,
    () => false,
  );
}

const frameCbs = new Set<() => void>();
let framePending = false;
const schedule = () => {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => { framePending = false; frameCbs.forEach((f) => f()); });
};

/** Runs cb on every animation frame after a scroll or resize, and once on mount; one shared loop for the whole app. */
export function useScrollFrame(cb: () => void, deps: unknown[]): void {
  useEffect(() => {
    if (frameCbs.size === 0) { addEventListener('scroll', schedule, { passive: true, capture: true }); addEventListener('resize', schedule, { passive: true }); }
    frameCbs.add(cb);
    cb();
    return () => {
      frameCbs.delete(cb);
      if (frameCbs.size === 0) { removeEventListener('scroll', schedule, { capture: true }); removeEventListener('resize', schedule); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Applies the lens effect (--f, opacity, transform) to every child matching `selector` inside ref. */
export function useLens(ref: { current: HTMLElement | null }, selector = ':scope > *'): void {
  const reduce = useReducedMotion();
  useScrollFrame(() => {
    const root = ref.current;
    if (!root) return;
    const mid = innerHeight / 2;
    root.querySelectorAll<HTMLElement>(selector).forEach((c) => {
      if (reduce) { c.style.removeProperty('--f'); c.style.opacity = ''; c.style.transform = ''; return; }
      const r = c.getBoundingClientRect(), cy = r.top + r.height / 2;
      const f = lensFactor(cy, mid, innerHeight), off = lensOffset(cy, mid, innerHeight);
      c.style.setProperty('--f', f.toFixed(3));
      c.style.opacity = (0.5 + f * 0.5).toFixed(3);
      c.style.transform = `perspective(900px) rotateX(${(-off * 30).toFixed(2)}deg) scale(${(0.94 + f * 0.06).toFixed(3)})`;
    });
  }, [ref, selector, reduce]);
}

/** Pointer tilt with a glare position (--gx, --gy) on the element; max degrees. */
export function useTilt(ref: { current: HTMLElement | null }, max = 12): void {
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduce || matchMedia('(pointer: coarse)').matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.transform = `rotateY(${((x - 0.5) * max).toFixed(2)}deg) rotateX(${((0.5 - y) * max * 0.83).toFixed(2)}deg)`;
      el.style.setProperty('--gx', `${x * 100}%`);
      el.style.setProperty('--gy', `${y * 100}%`);
    };
    const leave = () => { el.style.transform = ''; };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); leave(); };
  }, [ref, max, reduce]);
}

export function confetti(x: number, y: number, color: string): void {
  if (reducedNow()) return;
  const cols = [color, '#EDE3C9', '#5CC98B'];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('i');
    const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 70;
    s.setAttribute('aria-hidden', 'true');
    s.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:6px;height:6px;border-radius:2px;pointer-events:none;z-index:80;background:${cols[i % cols.length]}`;
    document.body.appendChild(s);
    s.animate(
      [{ transform: 'none', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d - 24}px) rotate(${Math.random() * 400}deg)`, opacity: 0 }],
      { duration: 800, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
    );
    setTimeout(() => s.remove(), 850);
  }
}
