import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Task, Project } from '../../../shared/types.ts';
import { fmtDue } from '../dates.ts';
import { SRC } from './sources.ts';

const HZ = { short: 'Short', medium: 'Medium', long: 'Long' };

export function Card({ task, project, subtasks, onOpen, dragging, onPointerDown }: {
  task: Task; project?: Project; subtasks: Task[]; onOpen: (id: string) => void; dragging: boolean; onPointerDown: (e: ReactPointerEvent, id: string) => void;
}) {
  const due = fmtDue(task.due_at);
  const done = subtasks.filter((s) => s.status === 'done').length;
  return (
    <div className={`kc ${dragging ? 'ghost' : ''} ${task.status === 'hold' && task.waiting_on ? 'block' : ''}`} data-task={task.id}
      onPointerDown={(e) => onPointerDown(e, task.id)} onClick={() => !dragging && onOpen(task.id)}
      style={task.source_app !== 'manual' ? { ['--src' as string]: SRC[task.source_app] } : undefined} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(task.id)}>
      <div className="tt">{task.title}</div>
      <div className="pj">{project?.name ?? (task.kind === 'work' ? 'Work' : 'Personal')}{task.waiting_on ? ` · waiting on ${task.waiting_on}` : ''}</div>
      {subtasks.length > 0 && <div className="prog" style={{ ['--w' as string]: `${Math.round((100 * done) / subtasks.length)}%` }}><i /></div>}
      <div className="ft">
        {task.source_app !== 'manual' && <span className="chip src">{task.source_app}</span>}
        {task.kind === 'work' && <span className="chip work">Work</span>}
        <span className="chip">{HZ[task.horizon]}</span>
        {due.text && <span className={`chip ${due.tone}`}>{due.text}</span>}
        {task.priority === 3 && <span className="chip over">!</span>}
      </div>
    </div>
  );
}
