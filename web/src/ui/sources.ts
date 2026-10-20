export const APP_LABEL: Record<string, string> = { nightowl: 'Night Owl', sonarflow: 'SonarFlow' };
export const appLabel = (app: string) => APP_LABEL[app] ?? app[0].toUpperCase() + app.slice(1);

const GLYPH: Record<string, string> = { finance: '$', health: '+', hollow: 'H', sonarflow: '◷', email: '@', home: '⌂' };
/** An app's mark for an icon tile: its glyph, else its initial. */
export const appGlyph = (app: string) => GLYPH[app] ?? app[0].toUpperCase();
