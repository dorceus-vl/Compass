import { useRef, useState } from 'react';
import type { Project, Task } from '../../../shared/types.ts';
import { completeTask, updateTask } from '../store/useStore.ts';
import { fmtDue } from '../dates.ts';
import { confetti, useLens, useReducedMotion } from '../motion.ts';
import { taskColor, projectColor } from './colors.ts';
import { appLabel } from './sources.ts';

const GLYPH: Record<string, string> = { finance: '$', health: '+', hollow: 'H', sonarflow: '◷', email: '@', home: '⌂' };
const TONE = { over: 'var(--danger)', due: 'var(--accent)', '': 'var(--text-dim)' };
const SWIPE = 110; // px to the right that completes, as in the preview

/** Ids finished from a view's cards during this visit (gone when the view unmounts), so they stay struck through and the check can undo. */
export function useFinished(): [ReadonlySet<string>, (id: string) => void] {
  const [finished, set] = useState<ReadonlySet<string>>(() => new Set());
  return [finished, (id) => set((s) => new Set(s).add(id))];
}

type CardProps = { task: Task; projects: Project[]; onOpen: (id: string) => void; onFinish?: (id: string) => void };

export function TaskCard({ task, projects, onOpen, onFinish }: CardProps) {
  const body = useRef<HTMLDivElement>(null);
  const reveal = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; dx: number } | null>(null);
  const swiped = useRef(false);
  const reduce = useReducedMotion();
  const done = task.status === 'done';
  const due = fmtDue(task.due_at), tone = done ? '' : due.tone; // a finished task is not late
  const color = taskColor(task, projects);
  const project = task.project_id ? projects.find((p) => p.id === task.project_id) : undefined;
  const ico = GLYPH[task.source_app] ?? (task.source_app !== 'manual' ? task.source_app[0].toUpperCase() : project ? project.name.trim()[0]?.toUpperCase() ?? '•' : '•');

  const finish = (x: number, y: number) => {
    if (done) { void updateTask(task.id, { status: 'new' }); return; }
    onFinish?.(task.id);
    confetti(x, y, color);
    void completeTask(task.id);
  };
  const end = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    drag.current = null;
    if (body.current) { body.current.style.transition = ''; body.current.style.transform = ''; }
    if (reveal.current) reveal.current.style.opacity = '';
    swiped.current = e.type === 'pointerup' && d.dx > 6;
    if (swiped.current) setTimeout(() => { swiped.current = false; }); // only the click that follows this pointerup
    if (d.dx > SWIPE && e.type === 'pointerup') finish(e.clientX, e.clientY);
  };

  return (
    <article
      className={`tcard${done ? ' done' : ''}`}
      style={{ ['--tc' as string]: color }}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as Element).closest('.check, a')) return;
        drag.current = { x0: e.clientX, dx: 0 }; swiped.current = false;
        if (body.current) body.current.style.transition = 'none';
      }}
      onPointerMove={(e) => {
        const d = drag.current; if (!d) return;
        d.dx = Math.max(0, e.clientX - d.x0);
        if (d.dx <= 6) return;
        if (body.current && !reduce) body.current.style.transform = `translateX(${d.dx}px)`;
        if (reveal.current) reveal.current.style.opacity = String(Math.min(1, d.dx / SWIPE));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
      // a drag that ends over the title is not a click on it
      onClickCapture={(e) => { if (swiped.current) { swiped.current = false; e.preventDefault(); e.stopPropagation(); } }}
    >
      <div className="reveal" ref={reveal} aria-hidden="true">Done ✓</div>
      <div className="body" ref={body}>
        <div className="ico" aria-hidden="true">{ico}</div>
        <div className="tx">
          <button type="button" className="t" onClick={() => onOpen(task.id)}>{task.title}</button>
          <div className="m">
            {project && <span className="chip" style={{ ['--sc' as string]: projectColor(project) }}><i />{project.name}</span>}
            {task.source_app !== 'manual' && <span className="chip" style={{ ['--sc' as string]: color }}><i />{appLabel(task.source_app)}</span>}
            {task.kind === 'work' && <span className="chip" style={{ ['--sc' as string]: 'var(--accent)' }}><i />Work</span>}
            {task.status === 'waiting' && <span className="chip" style={{ ['--sc' as string]: 'var(--warn)' }}><i />waiting{task.waiting_on ? ` · ${task.waiting_on}` : ''}</span>}
            {due.text && <span className="chip when" style={{ ['--sc' as string]: TONE[tone] }}><i />{due.text}</span>}
            {task.source_url && <a className="chip" href={task.source_url} target="_blank" rel="noopener">open ↗</a>}
          </div>
        </div>
        <div className="due">
          {due.text && <b className={tone}>{due.text}</b>}
          <button type="button" className="check" aria-label={`Done: ${task.title}`} aria-pressed={done}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); finish(r.left + r.width / 2, r.top + r.height / 2); }}><i /></button>
        </div>
      </div>
    </article>
  );
}

/** A vertical list of task cards with the lens effect. */
export function TaskList({ tasks, ...card }: Omit<CardProps, 'task'> & { tasks: Task[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useLens(ref, ':scope > .tcard');
  return <div className="tlist" ref={ref}>{tasks.map((t) => <TaskCard key={t.id} task={t} {...card} />)}</div>;
}
