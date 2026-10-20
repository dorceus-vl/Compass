/** What Athena's media uploads may be (clips: mp4; portrait: png or jpg), judged by their first bytes. */
export const MAX_CLIP_BYTES = 15 * 1024 * 1024;
export const MAX_CLIPS = 40;
export const MAX_PORTRAIT_BYTES = 2 * 1024 * 1024;

const at = (b: Uint8Array, i: number, s: string) => s.length + i <= b.length && [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));
/** 'mp4' when `ftyp` sits at offset 4, 'png' / 'jpg' by their signatures, else null. */
export function sniffMedia(head: Uint8Array): 'mp4' | 'png' | 'jpg' | null {
  if (at(head, 4, 'ftyp')) return 'mp4';
  if (head.length >= 8 && head[0] === 0x89 && at(head, 1, 'PNG') && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) return 'png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
  return null;
}
export const MEDIA_TYPE = { mp4: 'video/mp4', png: 'image/png', jpg: 'image/jpeg' } as const;
