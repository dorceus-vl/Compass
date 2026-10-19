import { useEffect, useState, createElement, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();
export function navigate(path: string, replace = false) { history[replace ? 'replaceState' : 'pushState'](null, '', path); listeners.forEach((l) => l()); }
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

/** Paths: / board list upcoming timeline projects projects/:id settings trash. */
export function useRoute(): { path: string; params: Record<string, string> } {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'projects' && parts[1]) return { path: 'project', params: { id: parts[1] } };
  return { path: parts[0] ?? 'today', params: {} };
}

export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const { to, onClick, ...rest } = props;
  return createElement('a', { ...rest, href: to, onClick: (e: MouseEvent<HTMLAnchorElement>) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(to); onClick?.(e); } });
}
