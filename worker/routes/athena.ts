import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { AthenaClip, AthenaClipState } from '../../shared/types.ts';
import { now, audit, getSettings, patchSettings } from '../lib/db.ts';
import { parseRange } from '../lib/range.ts';
import { MAX_CLIP_BYTES, MAX_CLIPS, MAX_PORTRAIT_BYTES, MEDIA_TYPE, sniffMedia } from '../lib/athena-media.ts';

const athena = new Hono<{ Bindings: Env; Variables: Variables }>();
const STATES: readonly string[] = ['idle', 'listening', 'thinking', 'speaking'];
const cleanName = (s: string | undefined) => {
  let n = s ?? '';
  try { n = decodeURIComponent(n); } catch { /* keep it as sent */ }
  return n.split(/[\\/]/).pop()!.trim().slice(0, 200);
};
type Row = { id: string; state: AthenaClipState | 'portrait'; name: string; bytes: number; content_type: string; r2_key: string; created_at: string };
const asClip = ({ id, state, name, bytes, created_at }: Row): AthenaClip => ({ id, state: state as AthenaClipState, name, bytes, created_at });

athena.get('/clips', async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM athena_clips WHERE deleted_at IS NULL AND state != 'portrait' ORDER BY created_at, id").all<Row>();
  return c.json({ clips: results.map(asClip), portrait_id: (await getSettings(c.env)).athena.portrait_id }, 200, { 'Cache-Control': 'private, no-store' });
});

/** The body is read up to its first bytes, checked, then the rest streams into R2 without being held in memory (a FixedLengthStream, so R2 gets the declared length and a short or long body fails). */
athena.post('/clips', async (c) => {
  const state = c.req.query('state') ?? '';
  if (!STATES.includes(state)) return c.json({ error: 'state must be one of: idle, listening, thinking, speaking' }, 400);
  if ((c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase() !== MEDIA_TYPE.mp4) return c.json({ error: 'Clips are MP4 videos (video/mp4).' }, 415);
  const len = c.req.header('content-length');
  if (!len || !/^\d+$/.test(len)) return c.json({ error: 'Length Required' }, 411);
  const size = Number(len);
  if (size === 0) return c.json({ error: 'That file is empty.' }, 400);
  if (size > MAX_CLIP_BYTES) return c.json({ error: `Clips must be ${MAX_CLIP_BYTES / 1024 / 1024} MB or smaller.` }, 413);
  const name = cleanName(c.req.header('x-file-name'));
  if (!name) return c.json({ error: 'The clip needs a name (X-File-Name).' }, 400);
  const live = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM athena_clips WHERE deleted_at IS NULL AND state != 'portrait'").first<{ n: number }>();
  if ((live?.n ?? 0) >= MAX_CLIPS) return c.json({ error: `Athena keeps up to ${MAX_CLIPS} clips. Remove one first.` }, 409);
  if (!c.req.raw.body) return c.json({ error: 'That file is empty.' }, 400);

  const reader = c.req.raw.body.getReader();
  let head = new Uint8Array(0);
  while (head.length < 12) {
    const { done, value } = await reader.read();
    if (done) break;
    const next = new Uint8Array(head.length + value.length); next.set(head); next.set(value, head.length); head = next;
  }
  if (sniffMedia(head) !== 'mp4') { void reader.cancel().catch(() => {}); return c.json({ error: 'That file is not an MP4 video.' }, 415); }
  const rest = new ReadableStream<Uint8Array>({
    start(ctl) { ctl.enqueue(head); },
    async pull(ctl) { const { done, value } = await reader.read(); if (done) ctl.close(); else ctl.enqueue(value); },
    cancel(why) { return reader.cancel(why); },
  });
  const id = crypto.randomUUID(), r2_key = `athena/${id}`, t = now();
  try {
    await c.env.FILES.put(r2_key, rest.pipeThrough(new FixedLengthStream(size)), { httpMetadata: { contentType: MEDIA_TYPE.mp4 } });
  } catch { await c.env.FILES.delete(r2_key).catch(() => {}); return c.json({ error: 'The upload was cut short. Try again.' }, 400); }
  const row: Row = { id, state: state as AthenaClipState, name, bytes: size, content_type: MEDIA_TYPE.mp4, r2_key, created_at: t };
  try {
    await c.env.DB.prepare('INSERT INTO athena_clips (id, state, name, bytes, content_type, r2_key, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)').bind(id, state, name, size, MEDIA_TYPE.mp4, r2_key, t).run();
  } catch (e) { await c.env.FILES.delete(r2_key).catch(() => {}); throw e; }
  await audit(c.env, 'you', 'athena.clip.upload', id, { state, bytes: size });
  return c.json({ clip: asClip(row) }, 201);
});

athena.delete('/clips/:id', async (c) => {
  const r = await c.env.DB.prepare("UPDATE athena_clips SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL AND state != 'portrait'").bind(c.req.param('id'), now()).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'athena.clip.trash', c.req.param('id'));
  return c.json({ ok: true });
});

/** The still portrait is small (png or jpg, 2 MB), so it is read whole; the old one goes to Trash. */
athena.post('/portrait', async (c) => {
  const len = c.req.header('content-length');
  if (!len || !/^\d+$/.test(len)) return c.json({ error: 'Length Required' }, 411);
  if (Number(len) > MAX_PORTRAIT_BYTES) return c.json({ error: `The portrait must be ${MAX_PORTRAIT_BYTES / 1024 / 1024} MB or smaller.` }, 413);
  const declared = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (declared !== MEDIA_TYPE.png && declared !== MEDIA_TYPE.jpg) return c.json({ error: 'The portrait is a PNG or JPG image.' }, 415);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length) return c.json({ error: 'That file is empty.' }, 400);
  if (bytes.length > MAX_PORTRAIT_BYTES) return c.json({ error: `The portrait must be ${MAX_PORTRAIT_BYTES / 1024 / 1024} MB or smaller.` }, 413);
  const kind = sniffMedia(bytes);
  if ((kind !== 'png' && kind !== 'jpg') || MEDIA_TYPE[kind] !== declared) return c.json({ error: 'That file is not the image it says it is.' }, 415);
  const id = crypto.randomUUID(), r2_key = `athena/${id}`, t = now(), name = cleanName(c.req.header('x-file-name')) || `portrait.${kind}`;
  await c.env.FILES.put(r2_key, bytes, { httpMetadata: { contentType: declared } });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE athena_clips SET deleted_at = ?1 WHERE state = 'portrait' AND deleted_at IS NULL").bind(t),
      c.env.DB.prepare("INSERT INTO athena_clips (id, state, name, bytes, content_type, r2_key, created_at) VALUES (?1,'portrait',?2,?3,?4,?5,?6)").bind(id, name, bytes.length, declared, r2_key, t),
    ]);
  } catch (e) { await c.env.FILES.delete(r2_key).catch(() => {}); throw e; }
  await patchSettings(c.env, { athena: { ...(await getSettings(c.env)).athena, portrait_id: id } });
  await audit(c.env, 'you', 'athena.portrait.set', id, { bytes: bytes.length });
  return c.json({ portrait_id: id }, 201);
});

athena.delete('/portrait', async (c) => {
  await c.env.DB.prepare("UPDATE athena_clips SET deleted_at = ?1 WHERE state = 'portrait' AND deleted_at IS NULL").bind(now()).run();
  await patchSettings(c.env, { athena: { ...(await getSettings(c.env)).athena, portrait_id: null } });
  await audit(c.env, 'you', 'athena.portrait.trash', null);
  return c.json({ ok: true });
});

/** A clip or the portrait, straight from R2 with Range, so Safari can play and seek. Same origin, cookie-guarded, private cache. */
athena.get('/media/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM athena_clips WHERE id = ?1 AND deleted_at IS NULL').bind(c.req.param('id')).first<Row>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  const base = { 'Content-Type': row.content_type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
  const range = parseRange(c.req.header('range'), row.bytes);
  if (range === 'bad') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${row.bytes}` } });
  const obj = await c.env.FILES.get(row.r2_key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!obj) return c.json({ error: 'Not found' }, 404);
  if (!range) return new Response(obj.body, { status: 200, headers: { ...base, 'Content-Length': String(row.bytes) } });
  return new Response(obj.body, { status: 206, headers: { ...base, 'Content-Range': `bytes ${range.start}-${range.end}/${row.bytes}`, 'Content-Length': String(range.end - range.start + 1) } });
});

export default athena;
