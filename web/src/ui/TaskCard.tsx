import { useRef, useState } from 'react';
import type { Project, Task } from '../../../shared/types.ts';
import { completeTask, updateTask } from '../store/useStore.ts';
import { fmtDue } from '../dates.ts';
import { confetti, useLens } from '../motion.ts';
import { useSwipe } from './useSwipe.ts';
import { taskColor, projectColor } from './colors.ts';
import { appLabel, appGlyph } from './sources.ts';

/** The icon tile's glyph: the source app's mark, else the project's initial. */
export function iconFor(task: Task, project?: Project): string {
  return task.source_app !== 'manual' ? appGlyph(task.source_app) : project ? project.name.trim()[0]?.toUpperCase() ?? '•' : '•';
}
const TONE = { over: 'var(--danger)', due: 'var(--accent)', '': 'var(--text-dim)' };

/** Ids finished from a view's cards during this visit (gone when the view unmounts), so they stay struck through and the check can undo. */
export function useFinished(): [ReadonlySet<string>, (id: string) => void] {
  const [finished, set] = useState<ReadonlySet<string>>(() => new Set());
  return [finished, (id) => set((s) => new Set(s).add(id))];
}

type CardProps = { task: Task; projects: Project[]; onOpen: (id: string) => void; onFinish?: (id: string) => void };

export function TaskCard({ task, projects, onOpen, onFinish }: CardProps) {
  const done = task.status === 'done';
  const due = fmtDue(task.due_at), tone = done ? '' : due.tone; // a finished task is not late
  const color = taskColor(task, projects);
  const project = task.project_id ? projects.find((p) => p.id === task.project_id) : undefined;
  const ico = iconFor(task, project);

  const finish = (x: number, y: number) => {
    if (done) { void updateTask(task.id, { status: 'new' }); return; }
    onFinish?.(task.id);
    confetti(x, y, color);
    void completeTask(task.id);
  };
  const swipe = useSwipe<HTMLElement>({ right: !done, skip: '.check, a', onSwipe: (_d, x, y) => finish(x, y) });

  return (
    <article
      className={`tcard${done ? ' done' : ''}`}
      style={{ ['--tc' as string]: color }}
      ref={swipe.ref}
      {...swipe.props}
    >
      <div className="reveal" aria-hidden="true">Done ✓</div>
      <div className="body">
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
