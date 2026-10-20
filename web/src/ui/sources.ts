export const APP_LABEL: Record<string, string> = { nightowl: 'Night Owl', sonarflow: 'SonarFlow' };
export const appLabel = (app: string) => APP_LABEL[app] ?? app[0].toUpperCase() + app.slice(1);
