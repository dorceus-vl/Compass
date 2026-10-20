import { hashIndex } from '../motion.ts';

export const HORIZON_COLOR: Record<'short' | 'medium' | 'long', string> = { short: 'var(--h-short)', medium: 'var(--h-medium)', long: 'var(--h-long)' };

/** The six project swatches (ruling D2), as hex so they can be stored in the `colour` column. */
export const PROJECT_SWATCHES = ['#C9BB9A', '#7DB4AC', '#9D95C6', '#6FA8E8', '#D9A55A', '#6DB98F'];

const SOURCE_COLOR: Record<string, string> = {
  finance: 'var(--src-finance)', health: 'var(--src-health)', hollow: 'var(--src-hollow)', sonarflow: 'var(--src-meeting)', email: 'var(--src-email)',
  home: 'var(--src-home)', aura: 'var(--src-home)', kelly: 'var(--src-kelly)', nightowl: 'var(--src-nightowl)',
};

export function projectColor(p: { id: string; colour: string | null }): string {
  return p.colour || PROJECT_SWATCHES[hashIndex(p.id, PROJECT_SWATCHES.length)];
}

/** Source app's colour; else the project's; else dim. */
export function taskColor(t: { source_app: string; project_id: string | null }, projects: { id: string; colour: string | null }[]): string {
  const src = SOURCE_COLOR[t.source_app];
  if (src) return src;
  const p = t.project_id ? projects.find((x) => x.id === t.project_id) : undefined;
  return p ? projectColor(p) : 'var(--text-dim)';
}
