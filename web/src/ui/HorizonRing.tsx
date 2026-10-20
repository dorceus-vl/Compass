import { useRef } from 'react';
import type { Horizon, Task } from '../../../shared/types.ts';
import { nearestTurn } from '../motion.ts';
import { useStore } from '../store/useStore.ts';
import { HORIZON_COLOR, taskColor } from './colors.ts';
import { HORIZONS, HORIZON_LABEL, cap } from './HorizonDial.tsx';

const SWIPE = 40; // px, as in the preview

/** Three horizon cards on a 3D ring that turns the short way to the chosen one; drag sideways or use the arrows to turn it. */
export function HorizonRing({ value, tasks, onChange }: { value: Horizon; tasks: Record<Horizon, Task[]>; onChange: (h: Horizon) => void }) {
  const { projects } = useStore();
  const turn = useRef(0);
  turn.current = nearestTurn(turn.current, HORIZONS.indexOf(value)); // same result when rendered twice
  const x0 = useRef<number | null>(null);
  const spin = (d: number) => onChange(HORIZONS[(((turn.current + d) % 3) + 3) % 3]);
  return (
    <div className="ringbox">
      <div className="ringstage"
        onPointerDown={(e) => { if (e.button !== 0) return; x0.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerUp={(e) => { const s = x0.current; x0.current = null; if (s != null && Math.abs(e.clientX - s) > SWIPE) spin(e.clientX < s ? 1 : -1); }}
        onPointerCancel={() => { x0.current = null; }}>
        <div className="ring" style={{ transform: `rotateY(${-turn.current * 120}deg)` }} aria-hidden="true">
          {HORIZONS.map((k, i) => (
            <div key={k} className={`rface${k === value ? ' on' : ''}`} style={{ ['--hc' as string]: HORIZON_COLOR[k], transform: `rotateY(${i * 120}deg) translateZ(var(--rz))` }}>
              <span className="eyebrow">{HORIZON_LABEL[k]}</span>
              <div className="rh">{cap(k)}<span>{tasks[k].length} {tasks[k].length === 1 ? 'task' : 'tasks'}</span></div>
              {tasks[k].length === 0 && <div className="mini empty">Nothing here yet</div>}
              {tasks[k].slice(0, 4).map((t) => <div key={t.id} className="mini" style={{ ['--tc' as string]: taskColor(t, projects) }}><i /><span>{t.title}</span></div>)}
            </div>
          ))}
        </div>
      </div>
      <div className="ringnav">
        <button type="button" aria-label="Previous horizon" onClick={() => spin(-1)}>‹</button>
        <button type="button" aria-label="Next horizon" onClick={() => spin(1)}>›</button>
      </div>
    </div>
  );
}
