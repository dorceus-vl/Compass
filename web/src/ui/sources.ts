export const SRC: Record<string, string> = { finance: 'var(--finance)', health: 'var(--health)', hollow: 'var(--hollow)', aura: 'var(--aura)', home: 'var(--aura)', nightowl: 'var(--nightowl)', sonarflow: 'var(--sonar)', kelly: 'var(--kelly)', email: 'var(--kelly)' };
export const APP_LABEL: Record<string, string> = { nightowl: 'Night Owl', sonarflow: 'SonarFlow' };
export const appLabel = (app: string) => APP_LABEL[app] ?? app[0].toUpperCase() + app.slice(1);
