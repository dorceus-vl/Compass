import type { InboxItem } from '../../../shared/types.ts';
import { useInbox, reviewPath, safeUrl, openTask } from '../inbox.ts';
import { navigate } from '../router.ts';
import { trashTask } from '../store/useStore.ts';
import { confirmAction, toast } from './dialogs.tsx';
import { appLabel, appGlyph } from './sources.ts';
import { sourceColor, accent } from './colors.ts';
import { useSwipe } from './useSwipe.ts';
import { SectionHead } from './SectionHead.tsx';

type Inbox = ReturnType<typeof useInbox>;

/** One item, as the "Added by your apps" card; the Inbox view reuses it (`id`, `active` for the listbox). */
export function InboxCard({ item, inbox, onOpen, id, active }: { item: InboxItem; inbox: Inbox; onOpen: (taskId: string) => void; id?: string; active?: boolean }) {
  const off = inbox.offline || !navigator.onLine;
  const tip = off ? 'Needs a connection' : undefined;
  const link = safeUrl(item.url);
  const undo = async () => {
    if (!item.task_id || !await confirmAction('Remove the task this app added?', { danger: true })) return;
    try { if (await inbox.dismiss(item.id)) await trashTask(item.task_id); } catch { toast('Could not remove the task'); }
  };
  const btn = (label: string, fn: () => void, primary = false) => <button type="button" key={label} className={primary ? 'p' : undefined} disabled={off} title={tip} onClick={fn}>{label}</button>;
  const meeting = item.kind === 'meeting', fresh = item.state === 'new';
  const keep = () => (meeting ? reviewPath(item).then(navigate) : inbox.keep(item.id));
  const swipe = useSwipe<HTMLDivElement>({
    right: meeting || (fresh && !off), left: (meeting || fresh) && !off, skip: 'a, button', fly: true,
    onSwipe: (dir) => (dir === 'right' ? keep() : inbox.dismiss(item.id)),
  });
  return (
    <div className={`icard${active ? ' active' : ''}`} id={id} role={id ? 'option' : undefined} aria-selected={id ? !!active : undefined} style={accent(sourceColor(item.app))} ref={swipe.ref} {...swipe.props}>
      <div className="reveal keep" aria-hidden="true">{meeting ? 'Review →' : 'Keep ✓'}</div>
      <div className="reveal drop" aria-hidden="true">Dismiss</div>
      <div className="body">
        <div className="ico" aria-hidden="true">{appGlyph(item.app)}</div>
        <div className="tx">
          <span className="src">{appLabel(item.app)}{item.state === 'added' && <span className="chip" style={{ marginLeft: 8 }}>Added</span>}</span>
          <div className="t">{item.title}</div>
          {item.body && <div className="m">{item.body}</div>}
          <div className="act">
            {meeting ? <>
              <button type="button" className="p" onClick={async () => navigate(await reviewPath(item))}>Review</button>
              {btn('Dismiss', () => void inbox.dismiss(item.id))}
            </> : item.state === 'added' ? <>
              {item.task_id && <button type="button" className="p" onClick={() => void openTask(item.task_id!, onOpen)}>Open</button>}
              {item.task_id && btn('Undo', () => void undo())}
            </> : <>
              {btn('Keep', () => void inbox.keep(item.id), true)}
              {btn('Snooze', () => void inbox.snooze(item.id))}
              {btn('Dismiss', () => void inbox.dismiss(item.id))}
            </>}
            {link && <a href={link} target="_blank" rel="noopener noreferrer">Source ↗</a>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AddedStrip({ onOpen }: { onOpen: (taskId: string) => void }) {
  const inbox = useInbox();
  if (!inbox.items.length) return null;
  const fresh = inbox.items.filter((i) => i.state === 'new').length;
  return (
    <section className="strip" aria-labelledby="strip-h">
      <SectionHead id="strip-h" eyebrow={`From your apps · ${fresh} new${inbox.offline ? ' · offline' : ''}`} title="Added by your apps">
        {inbox.items.length > 4 && <a className="chip" href="/inbox" onClick={(e) => { e.preventDefault(); navigate('/inbox'); }}>All {inbox.items.length}</a>}
      </SectionHead>
      <div className="auto">{inbox.items.slice(0, 4).map((i) => <InboxCard key={i.id} item={i} inbox={inbox} onOpen={onOpen} />)}</div>
    </section>
  );
}
