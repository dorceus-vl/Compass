import type { InboxItem } from '../../../shared/types.ts';
import { useInbox, reviewPath, safeUrl } from '../inbox.ts';
import { navigate } from '../router.ts';
import { trashTask } from '../store/useStore.ts';
import { confirmAction } from './dialogs.tsx';
import { SRC, appLabel } from './sources.ts';

type Inbox = ReturnType<typeof useInbox>;

/** One item, as the "Added by your apps" card; the Inbox view reuses it (`id`, `active` for the listbox). */
export function InboxCard({ item, inbox, onOpen, id, active }: { item: InboxItem; inbox: Inbox; onOpen: (taskId: string) => void; id?: string; active?: boolean }) {
  const off = inbox.offline || !navigator.onLine;
  const tip = off ? 'Needs a connection' : undefined;
  const link = safeUrl(item.url);
  const undo = async () => {
    if (!item.task_id || !await confirmAction('Remove the task this app added?', { danger: true })) return;
    if (await inbox.dismiss(item.id)) await trashTask(item.task_id);
  };
  const btn = (label: string, fn: () => void, primary = false) => <button type="button" key={label} className={primary ? 'p' : undefined} disabled={off} title={tip} onClick={fn}>{label}</button>;
  return (
    <div className={`ai${active ? ' active' : ''}`} id={id} role={id ? 'option' : undefined} aria-selected={id ? !!active : undefined} style={{ ['--src' as string]: SRC[item.app] ?? 'var(--text-faint)' }}>
      <span className="src">{appLabel(item.app)}{item.state === 'added' && <span className="chip" style={{ marginLeft: 8 }}>Added</span>}</span>
      <div className="t">{item.title}</div>
      {item.body && <div className="m">{item.body}</div>}
      <div className="act">
        {item.kind === 'meeting' ? <>
          <button type="button" className="p" onClick={async () => navigate(await reviewPath(item))}>Review</button>
          {btn('Dismiss', () => void inbox.dismiss(item.id))}
        </> : item.state === 'added' ? <>
          {item.task_id && <button type="button" className="p" onClick={() => onOpen(item.task_id!)}>Open</button>}
          {item.task_id && btn('Undo', () => void undo())}
        </> : <>
          {btn('Keep', () => void inbox.keep(item.id), true)}
          {btn('Snooze', () => void inbox.snooze(item.id))}
          {btn('Dismiss', () => void inbox.dismiss(item.id))}
        </>}
        {link && <a href={link} target="_blank" rel="noopener noreferrer">Source ↗</a>}
      </div>
    </div>
  );
}

export function AddedStrip({ onOpen }: { onOpen: (taskId: string) => void }) {
  const inbox = useInbox();
  if (!inbox.items.length) return null;
  const fresh = inbox.items.filter((i) => i.state === 'new').length;
  return (
    <div className="inbox">
      <div className="top"><h2>Added by your apps <small>{fresh} new{inbox.offline ? ' · offline' : ''}</small></h2>{inbox.items.length > 4 && <a className="chip" href="/inbox" onClick={(e) => { e.preventDefault(); navigate('/inbox'); }}>All {inbox.items.length}</a>}</div>
      <div className="auto">{inbox.items.slice(0, 4).map((i) => <InboxCard key={i.id} item={i} inbox={inbox} onOpen={onOpen} />)}</div>
    </div>
  );
}
