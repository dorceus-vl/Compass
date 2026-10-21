import { useEffect, useState } from 'react';
import { useRoute, navigate } from './router.ts';
import { api, SignedOut, onStepUpFailed } from './api.ts';
import { SignIn } from './views/SignIn.tsx';
import { Shell } from './ui/Shell.tsx';
import { Toasts, ConfirmDialog, confirmAction } from './ui/dialogs.tsx';
import { Today } from './views/Today.tsx';
import { Board } from './views/Board.tsx';
import { List } from './views/List.tsx';
import { Upcoming } from './views/Upcoming.tsx';
import { Calendar } from './views/Calendar.tsx';
import { Timeline } from './views/Timeline.tsx';
import { Projects } from './views/Projects.tsx';
import { ProjectPage } from './views/Project.tsx';
import { SettingsView } from './views/Settings.tsx';
import { TrashView } from './views/Trash.tsx';
import { InboxView } from './views/Inbox.tsx';
import { MeetingsView } from './views/Meetings.tsx';
import { MeetingView } from './views/Meeting.tsx';
import { ReviewView } from './views/Review.tsx';
import { LibraryView } from './views/Library.tsx';
import { LibraryPageView } from './views/LibraryPage.tsx';
import { AthenaView } from './views/Athena.tsx';
import { KnowledgeView } from './views/Knowledge.tsx';
import { MeetingSeriesView } from './views/MeetingSeries.tsx';
import { dropLocked } from './knowledge-search.ts';
import { KellyLog } from './views/KellyLog.tsx';
import { Palette } from './ui/Palette.tsx';
import { TaskSheet } from './ui/TaskSheet.tsx';
import { startSync, replay } from './store/sync.ts';
import { startWidgetWriter, clearWidgets } from './widgets.ts';
import { shell, startShell, sharedToQuickAdd, closeQuickAdd, stepUpInBrowser, openExternal } from './native.ts';
import { enablePush, thisDeviceId } from './push.ts';

/** The Mac's quick-add window loads `/?quickadd=1`: the palette alone, which closes the window after a save (once it reached the server, or is queued offline) or Escape. */
const quickAdd = new URLSearchParams(location.search).get('quickadd') === '1';

// The Mac app can't run a passkey yet: offer the same page in the browser, where the step-up works.
onStepUpFailed((e) => {
  if (!stepUpInBrowser(e)) return false;
  void confirmAction('Touch ID can’t be used in the Mac app yet. Continue in your browser?').then((ok) => { if (ok) openExternal(location.href); });
  return true;
});

export function App() {
  const { path, params } = useRoute();
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  const [palette, setPalette] = useState(false);
  const [deepTask, setDeepTask] = useState<string | null>(null); // `/?task=<id>` (an "unblocked" push): opens that task's sheet, then the URL is cleaned
  const taskParam = new URLSearchParams(location.search).get('task');
  const [shared, setShared] = useState<{ n: number; title: string; notes: string | null } | null>(null);
  useEffect(() => {
    api('/auth/me').then(() => setAuth('in')).catch((e) => setAuth(e instanceof SignedOut ? 'out' : 'in'));
  }, []);
  useEffect(() => {
    if (auth !== 'in' || !taskParam) return;
    setDeepTask(taskParam);
    const q = new URLSearchParams(location.search); q.delete('task');
    history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
  }, [auth, taskParam]);
  useEffect(() => { if (auth === 'out') { dropLocked(); void clearWidgets(); } }, [auth]); // Locked passages live in memory only: gone with the session
  useEffect(() => { if (auth === 'in') return startSync(() => setAuth('out')); }, [auth]);
  // In an app shell: shared text opens quick add prefilled, links and notification taps move inside Compass, and the push token is kept fresh.
  useEffect(() => {
    if (auth !== 'in' || !shell() || quickAdd) return;
    if (thisDeviceId()) void enablePush().catch(() => {}); // already allowed, so no prompt; the token may have changed
    const stopWidgets = startWidgetWriter(); // iOS and Android only: the widget snapshot (v2.3, W2)
    const stopShell = startShell({ onSharedText: (t) => { setShared((s) => ({ n: (s?.n ?? 0) + 1, ...sharedToQuickAdd(t) })); setPalette(true); }, onPath: (p) => { if (new URL(p, location.origin).searchParams.get('quickadd') === '1') setPalette(true); else navigate(p); }, /* the Quick add widget's `/?quickadd=1` (v2.3) */ notifyOn: () => thisDeviceId() === 'local' });
    return () => { stopWidgets(); stopShell(); };
  }, [auth]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (auth === 'checking') return null;
  if (quickAdd) return auth === 'out'
    ? <p className="quick-out">Open Compass and sign in first.</p>
    : <><Palette onClose={closeQuickAdd} onAdded={() => void replay().finally(closeQuickAdd)} /><Toasts /><ConfirmDialog /></>;
  if (auth === 'out') return <SignIn onSignedIn={() => setAuth('in')} />;
  const view = { today: <Today />, board: <Board />, list: <List />, upcoming: <Upcoming />, calendar: <Calendar />, timeline: <Timeline />, projects: <Projects />,
    project: <ProjectPage id={params.id} tab={params.tab} />, settings: <SettingsView onSignedOut={() => setAuth('out')} />, trash: <TrashView />, kelly: <KellyLog />, inbox: <InboxView />, meetings: <MeetingsView />, review: <ReviewView />, library: <LibraryView />, libpage: <LibraryPageView slug={params.slug} />, athena: <AthenaView id={params.id} />, knowledge: <KnowledgeView key={params.id ?? 'all'} id={params.id} />, meeting: <MeetingView key={params.id} id={params.id} />, series: <MeetingSeriesView key={params.id} id={params.id} /> }[path] ?? <Today />;
  return (
    <>
      <Shell onPalette={() => setPalette(true)}>{view}</Shell>
      {deepTask && <TaskSheet key={deepTask} taskId={deepTask} onClose={() => setDeepTask(null)} />}
      {palette && <Palette key={shared?.n ?? 0} prefill={shared ?? undefined} onClose={() => { setPalette(false); setShared(null); }} />}
      <Toasts /><ConfirmDialog />
    </>
  );
}
