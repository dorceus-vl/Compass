import { useRef, type PointerEvent, type MouseEvent } from 'react';
import { useReducedMotion } from '../motion.ts';

export const SWIPE = 110; // px that commits, as in the preview
type Dir = 'right' | 'left';
type Opts = {
  /** Which directions the card allows. */
  right?: boolean; left?: boolean;
  /** A pointerdown inside an element matching this does not start a swipe. */
  skip: string;
  /** Called when a swipe passes the threshold (x, y: where the pointer let go). May return a promise. */
  onSwipe: (dir: Dir, x: number, y: number) => unknown;
  /** After a commit, the card flies off the side and stays there until what onSwipe returned settles (then springs back if it is still here); otherwise it springs back at once. */
  fly?: boolean;
};

/** Pointer swipe for a card. Sets --sx (px), --sr and --sl (0..1 progress) and data-drag on the card; the CSS moves `.body` and fades the `.reveal`s.
 *  Reduced motion: nothing moves, only the reveal shows. A drag that ends over a link is not a click on it. */
export function useSwipe<E extends HTMLElement>({ right, left, skip, onSwipe, fly }: Opts) {
  const ref = useRef<E>(null);
  const drag = useRef<{ x0: number; dx: number } | null>(null);
  const swiped = useRef(false);
  const reduce = useReducedMotion();
  const paint = (dx: number | null, off = false) => {
    const el = ref.current; if (!el) return;
    if (dx === null) { el.removeAttribute('data-drag'); for (const p of ['--sx', '--sr', '--sl']) el.style.removeProperty(p); return; }
    if (off) el.removeAttribute('data-drag'); else el.dataset.drag = '1';
    el.style.setProperty('--sx', reduce ? '0px' : `${dx}px`);
    el.style.setProperty('--sr', String(Math.min(1, Math.max(0, dx) / SWIPE)));
    el.style.setProperty('--sl', String(Math.min(1, Math.max(0, -dx) / SWIPE)));
  };
  const end = (e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    drag.current = null;
    const up = e.type === 'pointerup';
    swiped.current = up && Math.abs(d.dx) > 6;
    if (swiped.current) setTimeout(() => { swiped.current = false; }); // only the click that follows this pointerup
    const dir: Dir | null = !up ? null : d.dx > SWIPE ? 'right' : d.dx < -SWIPE ? 'left' : null;
    if (dir && fly) {
      const w = ref.current?.offsetWidth ?? 400;
      paint(dir === 'right' ? w : -w, true);
      Promise.resolve(onSwipe(dir, e.clientX, e.clientY)).catch(() => {}).finally(() => paint(null));
      return;
    }
    paint(null);
    if (dir) onSwipe(dir, e.clientX, e.clientY);
  };
  return {
    ref,
    props: {
      onPointerDown: (e: PointerEvent) => {
        if (e.button !== 0 || (e.target as Element).closest(skip)) return;
        drag.current = { x0: e.clientX, dx: 0 }; swiped.current = false;
      },
      onPointerMove: (e: PointerEvent) => {
        const d = drag.current; if (!d) return;
        const dx = e.clientX - d.x0;
        d.dx = dx > 0 ? (right ? dx : 0) : (left ? dx : 0);
        if (Math.abs(d.dx) > 6) paint(d.dx);
      },
      onPointerUp: end, onPointerCancel: end, onPointerLeave: end,
      onClickCapture: (e: MouseEvent) => { if (swiped.current) { swiped.current = false; e.preventDefault(); e.stopPropagation(); } },
    },
  };
}
