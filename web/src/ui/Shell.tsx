import type { ReactNode } from 'react';
import { Link, useRoute } from '../router.ts';
import { useInbox } from '../inbox.ts';

const NAV = [
  ['today', '/', 'Today'], ['board', '/board', 'Board'], ['list', '/list', 'List'], ['upcoming', '/upcoming', 'Upcoming'],
  ['timeline', '/timeline', 'Timeline'], ['projects', '/projects', 'Projects'],
] as const;

export function Shell({ children, onPalette }: { children: ReactNode; onPalette: () => void }) {
  const { path } = useRoute();
  const fresh = useInbox().items.filter((i) => i.state === 'new').length;
  const on = (k: string) => (path === k || (k === 'projects' && path === 'project') ? 'on' : '');
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="logo"><i /><em /></div>
        {NAV.map(([k, to, label]) => <Link key={k} to={to} className={on(k)}>{label}</Link>)}
        <Link to="/inbox" className={on('inbox')} aria-label={fresh ? `Inbox, ${fresh} new` : 'Inbox'}>Inbox{fresh > 0 && <span className="badge">{fresh}</span>}</Link>
        <button className="btn" style={{ width: 56, padding: '8px 0', fontSize: 11 }} onClick={onPalette} aria-label="Command palette">⌘K</button>
        <div className="spacer" />
        <Link to="/settings" className={on('settings')}>Settings</Link>
      </nav>
      <div className="main">{children}</div>
      <nav className="ptab phone-only" aria-label="Main">
        <Link to="/" className={on('today')}>Today</Link><Link to="/board" className={on('board')}>Board</Link>
        <button type="button" onClick={onPalette} aria-label="Quick add">+</button>
        <Link to="/projects" className={on('projects')}>Projects</Link><Link to="/settings" className={on('settings') || on('inbox')} aria-label={fresh ? `More, ${fresh} new in the inbox` : 'More'}>More{fresh > 0 && <span className="badge">{fresh}</span>}</Link>
      </nav>
    </div>
  );
}
