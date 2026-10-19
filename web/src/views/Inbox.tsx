import { useEffect, useState, type KeyboardEvent } from 'react';
import { useInbox, safeUrl, reviewPath } from '../inbox.ts';
import { InboxCard } from '../ui/AddedStrip.tsx';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { navigate } from '../router.ts';

export function InboxView() {
  const inbox = useInbox();
  const { items, loading, offline } = inbox;
  const [cur, setCur] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const at = Math.min(cur, Math.max(items.length - 1, 0));
  const item = items[at];
  useEffect(() => { document.getElementById(`inbox-${item?.id}`)?.scrollIntoView({ block: 'nearest' }); }, [item?.id]);
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey || !item) return;
    const off = offline || !navigator.onLine;
    const k = e.key;
    if (k === 'j' || k === 'ArrowDown') setCur(Math.min(at + 1, items.length - 1));
    else if (k === 'k' || k === 'ArrowUp') setCur(Math.max(at - 1, 0));
    else if (k === 'o') { const u = safeUrl(item.url); if (u) window.open(u, '_blank', 'noopener,noreferrer'); }
    else if (k === 'Enter' && item.state === 'added' && item.task_id) setOpen(item.task_id);
    else if (off) return;
    else if (item.kind === 'meeting') { if (k === 'Enter') void reviewPath(item).then(navigate); else if (k === 'd') void inbox.dismiss(item.id); else return; }
    else if (item.state === 'new' && k === 'Enter') void inbox.keep(item.id);
    else if (item.state === 'new' && k === 's') void inbox.snooze(item.id);
    else if (k === 'd') void inbox.dismiss(item.id);
    else return;
    e.preventDefault();
  };
  return (
    <>
      <div className="head"><div><div className="eyebrow">Inbox</div><h1 style={{ marginTop: 6 }}>Added by <b>your apps</b></h1>
        <div className="sub">{offline ? 'Offline: showing the last list. Actions need a connection.' : 'j/k move · Enter keep · s snooze · d dismiss · o open source'}</div></div></div>
      {!loading && items.length === 0 && <div className="card"><p style={{ margin: 0 }}>Inbox zero.</p></div>}
      {items.length > 0 && (
        <div className="auto inbox-list" role="listbox" tabIndex={0} aria-label="Inbox" aria-activedescendant={`inbox-${item.id}`} onKeyDown={onKey}>
          {items.map((i, n) => <InboxCard key={i.id} item={i} inbox={inbox} onOpen={setOpen} id={`inbox-${i.id}`} active={n === at} />)}
        </div>
      )}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
