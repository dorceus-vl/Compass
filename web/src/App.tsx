import { useEffect, useState } from 'react';
import { useRoute } from './router.ts';
import { api, SignedOut } from './api.ts';
import { SignIn } from './views/SignIn.tsx';
import { Shell } from './ui/Shell.tsx';
import { Toasts, ConfirmDialog } from './ui/dialogs.tsx';
import { Today } from './views/Today.tsx';
import { Board } from './views/Board.tsx';
import { List } from './views/List.tsx';
import { Upcoming } from './views/Upcoming.tsx';
import { Timeline } from './views/Timeline.tsx';
import { Projects } from './views/Projects.tsx';
import { ProjectPage } from './views/Project.tsx';
import { SettingsView } from './views/Settings.tsx';
import { TrashView } from './views/Trash.tsx';
import { InboxView } from './views/Inbox.tsx';
import { MeetingsView } from './views/Meetings.tsx';
import { MeetingView } from './views/Meeting.tsx';
import { ReviewView } from './views/Review.tsx';
import { Palette } from './ui/Palette.tsx';
import { startSync } from './store/sync.ts';

export function App() {
  const { path, params } = useRoute();
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    api('/auth/me').then(() => setAuth('in')).catch((e) => setAuth(e instanceof SignedOut ? 'out' : 'in'));
  }, []);
  useEffect(() => { if (auth === 'in') return startSync(() => setAuth('out')); }, [auth]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (auth === 'checking') return null;
  if (auth === 'out') return <SignIn onSignedIn={() => setAuth('in')} />;
  const view = { today: <Today />, board: <Board />, list: <List />, upcoming: <Upcoming />, timeline: <Timeline />, projects: <Projects />,
    project: <ProjectPage id={params.id} />, settings: <SettingsView onSignedOut={() => setAuth('out')} />, trash: <TrashView />, inbox: <InboxView />, meetings: <MeetingsView />, review: <ReviewView />, meeting: <MeetingView key={params.id} id={params.id} /> }[path] ?? <Today />;
  return (
    <>
      <Shell onPalette={() => setPalette(true)}>{view}</Shell>
      {palette && <Palette onClose={() => setPalette(false)} />}
      <Toasts /><ConfirmDialog />
    </>
  );
}
