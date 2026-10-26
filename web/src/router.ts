import { useEffect, useState, createElement, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
/** Ruling D6: a route change cross-fades through the View Transitions API when present (styles in app.css). flushSync makes React commit inside the
 *  callback so the browser snapshots the new page. Reduced motion, `replace` (redirects can run inside effects) and other browsers switch instantly. */
function change(animate: boolean) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (animate && d.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) d.startViewTransition(() => flushSync(notify));
  else notify();
}
/** Old saved links: /copilot[/…] becomes /athena[/…], query and hash kept. */
const legacy = (p: string) => p.replace(/^\/copilot(?=[/?#]|$)/, '/athena');
function fixLegacy() { const to = legacy(location.pathname) + location.search + location.hash; if (to !== location.pathname + location.search + location.hash) history.replaceState(null, '', to); }
fixLegacy();
export function navigate(path: string, replace = false) { path = legacy(path); history[replace ? 'replaceState' : 'pushState'](null, '', path); change(!replace); }
// iOS Safari swipe-back and Android predictive back already animate (hasUAVisualTransition); ours would play on top of theirs.
window.addEventListener('popstate', (e) => { fixLegacy(); change(!(e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition); });

/** Paths: / board list upcoming calendar workload time timeline projects programs programs/:id[/:tab] projects/:id projects/:id/:tab inbox meetings meetings/:id meetings/series/:id review library library/:slug knowledge knowledge/:id athena athena/:id (or athena/new; /copilot redirects) settings kelly/log trash. */
export function useRoute(): { path: string; params: Record<string, string> } {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'projects' && parts[1]) return { path: 'project', params: { id: parts[1], tab: parts[2] ?? 'overview' } };
  if (parts[0] === 'programs' && parts[1]) return { path: 'program', params: { id: parts[1], tab: parts[2] ?? 'overview' } };
  if (parts[0] === 'meetings' && parts[1] === 'series' && parts[2]) return { path: 'series', params: { id: parts[2] } };
  if (parts[0] === 'meetings' && parts[1]) return { path: 'meeting', params: { id: parts[1] } };
  if (parts[0] === 'athena' && parts[1]) return { path: 'athena', params: { id: parts[1] } };
  if (parts[0] === 'knowledge' && parts[1]) return { path: 'knowledge', params: { id: parts[1] } };
  if (parts[0] === 'library' && parts[1]) return { path: 'libpage', params: { slug: parts[1] } };
  return { path: parts[0] ?? 'today', params: {} };
}

export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const { to, onClick, ...rest } = props;
  return createElement('a', { ...rest, href: to, onClick: (e: MouseEvent<HTMLAnchorElement>) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(to); onClick?.(e); } });
}
