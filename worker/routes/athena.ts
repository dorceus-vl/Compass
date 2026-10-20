import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { AthenaClip, AthenaClipState } from '../../shared/types.ts';
import { now, audit, getSettings, patchSettings } from '../lib/db.ts';
import { parseRange } from '../lib/range.ts';
import { MAX_CLIP_BYTES, MAX_CLIPS, MAX_PORTRAIT_BYTES, MEDIA_TYPE, sniffMedia } from '../lib/athena-media.ts';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AiRefused, meter } from '../lib/ai.ts';
import { open as openRow, sealBytes, openBytes } from '../lib/enc.ts';
import { projectAccess, threadAccess } from '../lib/project-context.ts';
import { speechText, synthesize, transcribe, parseVoicePrices, ttsCostMicro, sttCostMicro, sniffAudio, voiceKey } from '../lib/voice.ts';

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

// ---------------------------------------------------------------- voice (ruling A6): ElevenLabs only from here, metered, never logged

const VOICE_OFF = { error: 'voice_off', message: "Athena's voice isn't set up yet: it needs the ElevenLabs key and a voice picked in Settings → Athena." };
const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TEST_LINE = "Hello Vlad, it's Athena. This is how I'll sound when I read my answers.";
const MAX_RECORDING = 2 * 1024 * 1024, MAX_RECORDING_MS = 60_000;
const mp3 = (body: BodyInit) => new Response(body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
const refused = (e: unknown) => {
  if (e instanceof AiRefused) return Response.json({ error: e.code, message: e.message }, { status: e.status as ContentfulStatusCode });
  throw e;
};

/** Text-to-speech of a stored answer (cached in R2 per message, sealed for a work thread), or `{ test: true, voice_id? }`: a fixed line, uncached. */
athena.post('/speak', async (c) => {
  const env = c.env;
  const b = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const settings = await getSettings(env);
  try {
    if (b.test === true) {
      const voice = b.voice_id === undefined || b.voice_id === null ? settings.athena.voice_id : b.voice_id;
      if (voice !== null && !(typeof voice === 'string' && VOICE_ID.test(voice))) return c.json({ error: 'voice_id must be an ElevenLabs voice id (letters and digits)' }, 400);
      if (!voice || !voiceKey(env)) return c.json(VOICE_OFF, 409);
      const prices = parseVoicePrices(env.ELEVENLABS_PRICES), cost_micro = ttsCostMicro(TEST_LINE.length, prices);
      const record = await meter(env, 'athena_voice', cost_micro);
      const audio = await synthesize(env, voice, TEST_LINE);
      await record({ provider: 'elevenlabs', input_tokens: TEST_LINE.length, output_tokens: 0, cost_micro });
      return mp3(audio);
    }
    if (typeof b.message_id !== 'string' || !b.message_id) return c.json({ error: 'message_id must be a message id' }, 400);
    // The answer, in a live thread, read with its project's boundary (the same check chat makes): Offline-only or trashed never reaches ElevenLabs.
    const row = await env.DB.prepare('SELECT m.*, t.project_id, t.kind AS thread_kind FROM ai_messages m JOIN ai_threads t ON t.id = m.thread_id WHERE m.id = ?1 AND t.deleted_at IS NULL')
      .bind(b.message_id).first<{ id: string; role: string; content: string; enc_v: number; project_id: string | null; thread_kind: 'work' | 'personal' | null }>();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.role !== 'assistant') return c.json({ error: 'Only answers are read aloud' }, 400);
    const access = await threadAccess(env, row.project_id, row.thread_kind); // KN2: a project-less work thread's audio is sealed as work
    if (!access) return c.json({ error: 'Not found' }, 404);
    if (access.boundary === 'offline') return c.json({ error: 'offline_boundary', message: 'This project is Offline only: its answers are not sent to ElevenLabs.' }, 409);

    const key = `athena-tts/${row.id}`, context = `athena-tts:${row.id}`;
    const voice = settings.athena.voice_id;
    // A replay is free; after he picks another voice, the answer is spoken again in the new one.
    const hit = await env.FILES.get(key);
    if (hit && (!voice || hit.customMetadata?.voice === voice)) return mp3(hit.customMetadata?.sealed === '1' ? await openBytes(env, await hit.text(), context) : hit.body);

    if (!voice || !voiceKey(env)) return c.json(VOICE_OFF, 409);
    const text = speechText((await openRow(env, 'ai_messages', { ...row })).content);
    if (!text) return c.json({ error: 'nothing_to_say', message: 'This answer has nothing to read aloud.' }, 400);
    const cost_micro = ttsCostMicro(text.length, parseVoicePrices(env.ELEVENLABS_PRICES));
    const record = await meter(env, 'athena_voice', cost_micro);
    const audio = await synthesize(env, voice, text);
    await record({ provider: 'elevenlabs', input_tokens: text.length, output_tokens: 0, cost_micro });
    // Work answers are sealed at rest like their rows; the cache is best effort (a failed write only costs a replay).
    await (access.kind === 'work'
      ? env.FILES.put(key, await sealBytes(env, audio, context), { customMetadata: { sealed: '1', voice } })
      : env.FILES.put(key, audio, { httpMetadata: { contentType: 'audio/mpeg' }, customMetadata: { voice } })).catch(() => console.warn('[athena] could not cache an answer\'s audio'));
    return mp3(audio);
  } catch (e) { return refused(e); }
});

/** Speech-to-text of a recording (raw body, WebM or MP4, 2 MB and 60 s at most). The text goes into the Ask box; it is never sent on its own. */
athena.post('/listen', async (c) => {
  const env = c.env;
  const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'audio/webm' && type !== 'audio/mp4') return c.json({ error: 'Recordings are audio/webm or audio/mp4.' }, 415);
  const len = c.req.header('content-length');
  if (!len || !/^\d+$/.test(len)) return c.json({ error: 'Length Required' }, 411);
  if (Number(len) > MAX_RECORDING) return c.json({ error: 'Recordings must be 2 MB or smaller.' }, 413);
  const ms = Number(c.req.header('x-duration-ms'));
  if (!Number.isInteger(ms) || ms < 1 || ms > MAX_RECORDING_MS) return c.json({ error: 'X-Duration-Ms must be 1 to 60000' }, 400);
  // The boundary, before the body is read or anything is metered: what he dictates belongs to the open conversation (its thread's project
  // wins, as in chat), else to the project the screen is in (X-Project-Id), else it is personal. Offline only or trashed never reaches ElevenLabs.
  const threadId = c.req.header('x-thread-id'), projectHeader = c.req.header('x-project-id');
  let projectId = projectHeader || null;
  if (threadId) {
    const t = await env.DB.prepare('SELECT project_id FROM ai_threads WHERE id = ?1 AND deleted_at IS NULL').bind(threadId).first<{ project_id: string | null }>();
    if (!t) return c.json({ error: 'Not found' }, 404);
    projectId = t.project_id;
  }
  const access = await projectAccess(env, projectId);
  if (!access) return c.json({ error: 'Not found' }, 404);
  if (access.boundary === 'offline') return c.json({ error: 'offline_boundary', message: 'This project is Offline only: nothing you say is sent to ElevenLabs.' }, 409);
  if (!voiceKey(env)) return c.json(VOICE_OFF, 409);
  const audio = new Uint8Array(await c.req.arrayBuffer());
  if (!audio.length) return c.json({ error: 'The recording is empty.' }, 400);
  if (audio.length > MAX_RECORDING) return c.json({ error: 'Recordings must be 2 MB or smaller.' }, 413);
  if (sniffAudio(audio) !== type.slice(6)) return c.json({ error: 'That recording is not the audio it says it is.' }, 415);
  try {
    // Billed on the longer of the declared length and a floor from the size (128 kbps, above what the recorder asks for), so a wrong header can't under-bill.
    const billedMs = Math.max(ms, Math.ceil(audio.length / 16));
    const cost_micro = sttCostMicro(billedMs, parseVoicePrices(env.ELEVENLABS_PRICES));
    const record = await meter(env, 'athena_listen', cost_micro);
    const text = await transcribe(env, audio, type);
    await record({ provider: 'elevenlabs', input_tokens: Math.ceil(billedMs / 1000), output_tokens: 0, cost_micro });
    return c.json({ text });
  } catch (e) { return refused(e); }
});

export default athena;
