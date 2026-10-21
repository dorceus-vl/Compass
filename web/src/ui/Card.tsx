import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Task, Project } from '../../../shared/types.ts';
import { fmtDue } from '../dates.ts';
import { taskColor, HORIZON_COLOR } from './colors.ts';
import { iconFor } from './TaskCard.tsx';
import { appLabel } from './sources.ts';
import { BlockedChip } from './BlockedChip.tsx';

const HZ = { short: 'Short', medium: 'Medium', long: 'Long' };
const TONE = { over: 'var(--danger)', due: 'var(--accent)', '': 'var(--text-dim)' };
const dot = (c: string) => ({ ['--sc' as string]: c });

/** A board card: accent bar and icon tile in the task's colour, chips with dots. Drag is wired by the Board. */
export function Card({ task, project, projects, subtasks, onOpen, dragging, landed, onPointerDown, blocked }: {
  blocked?: boolean; task: Task; project?: Project; projects: Project[]; subtasks: Task[]; onOpen: (id: string) => void; dragging: boolean; landed: boolean; onPointerDown: (e: ReactPointerEvent, id: string) => void;
}) {
  const due = fmtDue(task.due_at);
  const done = subtasks.filter((s) => s.status === 'done').length;
  const color = taskColor(task, projects);
  return (
    <div className={`kc${dragging ? ' ghost' : ''}${landed ? ' landed' : ''}${task.status === 'hold' && task.waiting_on ? ' block' : ''}`} data-task={task.id}
      onPointerDown={(e) => onPointerDown(e, task.id)} onClick={() => !dragging && onOpen(task.id)}
      style={{ ['--tc' as string]: color }} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(task.id)}>
      <div className="kh">
        <div className="ico" aria-hidden="true">{iconFor(task, project)}</div>
        <div className="kx">
          <div className="tt">{task.title}</div>
          <div className="pj">{project?.name ?? (task.kind === 'work' ? 'Work' : 'Personal')}{task.waiting_on ? ` · waiting on ${task.waiting_on}` : ''}</div>
        </div>
      </div>
      {subtasks.length > 0 && <div className="prog" style={{ ['--w' as string]: `${Math.round((100 * done) / subtasks.length)}%` }}><i /></div>}
      <div className="ft">
        {blocked && <BlockedChip />}
        {task.source_app !== 'manual' && <span className="chip" style={dot(color)}><i />{appLabel(task.source_app)}</span>}
        {task.kind === 'work' && <span className="chip" style={dot('var(--accent)')}><i />Work</span>}
        <span className="chip" style={dot(HORIZON_COLOR[task.horizon])}><i />{HZ[task.horizon]}</span>
        {due.text && <span className="chip" style={dot(TONE[due.tone])}><i />{due.text}</span>}
        {task.priority === 3 && <span className="chip" style={dot('var(--danger)')}><i />!</span>}
      </div>
    </div>
  );
}
