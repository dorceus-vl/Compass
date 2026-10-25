import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Link, useRoute } from '../router.ts';
import { useInbox } from '../inbox.ts';
import { mediaUrl, useAthenaMedia } from '../athena-media.ts';
import { TimersBar } from './TimersBar.tsx';

// Inline icons, 24-box, stroke 1.75 (set in CSS), no library.
const ICONS: Record<string, ReactNode> = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>,
  inbox: <><path d="M4 13 6.5 5h11L20 13v6H4z" /><path d="M4 13h4.5l1 2h5l1-2H20" /></>,
  board: <><rect x="4" y="4" width="4.5" height="16" rx="1.2" /><rect x="10" y="4" width="4.5" height="10" rx="1.2" /><rect x="16" y="4" width="4" height="13" rx="1.2" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 9.5h16M8.5 3v4M15.5 3v4" /><path d="M8.5 13.5h.01M12 13.5h.01M15.5 13.5h.01M8.5 17h.01M12 17h.01" strokeWidth={3} /></>,
  upcoming: <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M8.5 3v4M15.5 3v4" /></>,
  timeline: <path d="M4 7h8M8 12h10M6 17h7" />,
  projects: <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />,
  knowledge: <><path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" /><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16 12 20.5 20.5 16" /></>,
  library: <><path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v13H7.5A2.5 2.5 0 0 1 5 17.5z" /><path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H18" /></>,
  copilot: <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />,
  athena: <><path d="M6 4l2.5 3h7L18 4v8a6 6 0 0 1-12 0z" /><circle cx="9.5" cy="11" r="1.6" /><circle cx="14.5" cy="11" r="1.6" /><path d="M11 14.5l1 1 1-1" /></>,
  settings: <path d="M5 7h9M18 7h1M5 17h1M10 17h9M14 7a2 2 0 1 0 0 .01M8 17a2 2 0 1 0 0 .01" />,
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={3} />,
  bell: <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0" />,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="m4 7.5 8 6 8-6" /></>,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  doc: <><path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5v4h4M9.5 12h5M9.5 15.5h5" /></>,
  trash: <path d="M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7M10 11v5M14 11v5" />,
  meetings: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.8M17.5 14a5.5 5.5 0 0 1 3 5" /></>,
  review: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.3 2.5 2.5 4.5-5" /></>,
  kelly: <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 4v-4h-.5A2.5 2.5 0 0 1 5 12.5zM9 9.5h.01M12 9.5h.01M15 9.5h.01" />,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  warn: <><path d="M12 4 3.5 19h17z" /><path d="M12 10v4M12 16.5h.01" /></>,
  chevron: <path d="m9.5 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" strokeWidth={2.2} />,
  bars: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  sheet: <><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /><path d="M3.5 9h17M3.5 14.5h17M9 3.5v17" /></>,
  clip: <path d="M20.5 11 12 19.5a5 5 0 0 1-7-7L13.5 4a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3L15 7" />,
  send: <path d="M5 12h14M13 6l6 6-6 6" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,

};
ICONS.workload = ICONS.bars; // NAV keys double as icon names
export const Icon = ({ name }: { name: string }) => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICONS[name]}</svg>;

const NAV = [
  ['today', '/', 'Today'], ['inbox', '/inbox', 'Inbox'], ['board', '/board', 'Board'], ['list', '/list', 'List'], ['upcoming', '/upcoming', 'Upcoming'], ['calendar', '/calendar', 'Calendar'], ['workload', '/workload', 'Workload'],
  ['timeline', '/timeline', 'Timeline'], ['projects', '/projects', 'Projects'], ['library', '/library', 'Library'], ['knowledge', '/knowledge', 'Knowledge'], ['athena', '/athena', 'Athena'],
] as const;

/** Slides one absolutely positioned pill (transform only) to the nav's active link (`sel`, default `a.on`); size is set inline and not animated. Hidden when no link is active. */
export function useSlider(nav: { current: HTMLElement | null }, pill: { current: HTMLElement | null }, key: string, sel = 'a.on') {
  useLayoutEffect(() => {
    const n = nav.current, p = pill.current;
    if (!n || !p) return;
    const place = () => {
      const a = n.querySelector<HTMLElement>(sel);
      if (!a || !a.offsetWidth) { p.style.opacity = '0'; return; } // display:none (the other nav at this width) measures 0
      p.style.opacity = '1';
      p.style.width = `${a.offsetWidth}px`; p.style.height = `${a.offsetHeight}px`;
      p.style.transform = `translate(${a.offsetLeft}px,${a.offsetTop}px)`;
    };
    place();
    const ro = new ResizeObserver(place); ro.observe(n);
    const t = requestAnimationFrame(() => p.classList.add('ready')); // no slide on first paint
    return () => { ro.disconnect(); cancelAnimationFrame(t); };
  }, [nav, pill, key, sel]);
}

export function Shell({ children, onPalette }: { children: ReactNode; onPalette: () => void }) {
  const { path } = useRoute();
  const fresh = useInbox().items.filter((i) => i.state === 'new').length;
  const on = (k: string) => (path === k || (k === 'projects' && (path === 'project' || path === 'programs' || path === 'program')) || (k === 'library' && path === 'libpage') || (k === 'meetings' && (path === 'meeting' || path === 'series')) ? 'on' : '');
  const portrait = useAthenaMedia()?.portrait_id;
  const rail = useRef<HTMLElement>(null), railPill = useRef<HTMLSpanElement>(null), tab = useRef<HTMLElement>(null), tabPill = useRef<HTMLSpanElement>(null);
  useSlider(rail, railPill, path); useSlider(tab, tabPill, path);
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main" ref={rail}>
        <span className="slide" ref={railPill} aria-hidden="true" />
        <img className="logo" src="/icons/icon-192.png" width={42} height={42} alt="Compass, Knocturn Labs" />
        {NAV.map(([k, to, label]) => k === 'athena' && portrait
          ? <Link key={k} to={to} className={on(k)} aria-current={on(k) ? 'page' : undefined}><img className="ath-rail-img" src={mediaUrl(portrait)} alt="" />{label}</Link>
          : k === 'inbox'
          ? <Link key={k} to={to} className={on(k)} aria-current={on(k) ? 'page' : undefined} aria-label={fresh ? `Inbox, ${fresh} new` : 'Inbox'}><Icon name={k} />Inbox{fresh > 0 && <span className="badge">{fresh}</span>}</Link>
          : <Link key={k} to={to} className={on(k)} aria-current={on(k) ? 'page' : undefined}><Icon name={k} />{label}</Link>)}
        <button className="btn rk" onClick={onPalette} aria-label="Command palette">⌘K</button>
        <div className="spacer" />
        <Link to="/settings" className={on('settings') || on('kelly')} aria-current={on('settings') || on('kelly') ? 'page' : undefined}><Icon name="settings" />Settings</Link>
      </nav>
      <div className="main"><TimersBar />{children}</div>
      <nav className="ptab phone-only" aria-label="Main" ref={tab}>
        <span className="slide" ref={tabPill} aria-hidden="true" />
        <Link to="/" className={on('today')} aria-current={on('today') ? 'page' : undefined}><Icon name="today" />Today</Link><Link to="/board" className={on('board')} aria-current={on('board') ? 'page' : undefined}><Icon name="board" />Board</Link>
        <button type="button" className="add" onClick={onPalette} aria-label="Quick add"><Icon name="plus" /></button>
        <Link to="/projects" className={on('projects')} aria-current={on('projects') ? 'page' : undefined}><Icon name="projects" />Projects</Link>
        <Link to="/settings" className={on('settings') || on('kelly') || on('inbox') || on('library') || on('knowledge') || on('athena') || on('calendar') || on('workload')} aria-current={on('settings') || on('kelly') || on('inbox') || on('library') || on('knowledge') || on('athena') || on('calendar') || on('workload') ? 'page' : undefined} aria-label={fresh ? `More, ${fresh} new in the inbox` : 'More'}><Icon name="more" />More{fresh > 0 && <span className="badge">{fresh}</span>}</Link>
      </nav>
    </div>
  );
}
