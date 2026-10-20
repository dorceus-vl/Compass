// What comes back from Kelly-Cloud's relay is data: plain text, trimmed and capped. No Worker imports, so scripts/kelly.test.ts runs it directly.
export const BRIEF_MAX = 1200;

/** `{ text, generated_at }` from the relay body, or null when it has no usable text. Control characters (except newlines) go; HTML is left alone because it is only ever rendered as text. */
export function cleanBrief(body: unknown, nowIso: string): { text: string; generated_at: string } | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.text !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = b.text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, BRIEF_MAX).trim();
  if (!text) return null;
  const at = typeof b.generated_at === 'string' && !Number.isNaN(Date.parse(b.generated_at)) ? new Date(b.generated_at).toISOString() : nowIso;
  return { text, generated_at: at };
}
