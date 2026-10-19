import type { Task } from '../../../shared/types.ts';
import { completeTask, updateTask } from '../store/useStore.ts';
import { fmtDue } from '../dates.ts';
import { SRC } from './sources.ts';

export function TaskRow({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const due = fmtDue(task.due_at);
  const done = task.status === 'done';
  return (
    <div className="task" style={task.source_app !== 'manual' ? { ['--src' as string]: SRC[task.source_app] } : undefined}>
      <button className={`cb ${done ? 'done' : ''}`} aria-label={done ? 'Mark not done' : 'Mark done'} onClick={() => (done ? updateTask(task.id, { status: 'new' }) : completeTask(task.id))} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <button className={`tt ${done ? 'done' : ''}`} style={{ all: 'unset', cursor: 'pointer', display: 'block' }} onClick={() => onOpen(task.id)}>{task.title}</button>
        <div className="meta">
          {task.source_app !== 'manual' && <span className="chip src">{task.source_app}</span>}
          {task.kind === 'work' && <span className="chip work">Work</span>}
          {task.status === 'waiting' && <span className="chip">waiting{task.waiting_on ? ` · ${task.waiting_on}` : ''}</span>}
          {due.text && <span className={`chip ${due.tone}`}>{due.text}</span>}
          {task.source_url && <a className="chip" href={task.source_url} target="_blank" rel="noopener">open ↗</a>}
        </div>
      </div>
    </div>
  );
}
