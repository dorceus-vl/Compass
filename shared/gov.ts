// Governance helpers used by both the Worker and the web app.
export const riskScore = (p: number | null, i: number | null) => (p && i ? p * i : 0);
/** ≥ 15 danger, 8–14 warn, else muted (empty string). */
export const scoreTone = (score: number): 'danger' | 'warn' | '' => (score >= 15 ? 'danger' : score >= 8 ? 'warn' : '');
