import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../shared/types.ts';
import { api, ApiError, SignedOut } from './api.ts';
import { silentMp3 } from '../../shared/silent-mp3.ts';

// Athena's voice on the device: her answers read aloud (one audio element for the app), the mic (MediaRecorder), and the voice settings.
// Audio and text only ever go to /api/athena (same origin); ElevenLabs is called by the Worker.

async function post(path: string, body: BodyInit, headers: Record<string, string>): Promise<Response> {
  const r = await fetch(`/api${path}`, { method: 'POST', body, headers, credentials: 'same-origin' });
  if (r.status === 401) throw new SignedOut();
  if (!r.ok) {
    const d = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(r.status, d.message ?? d.error ?? `Request failed (${r.status})`, false, d.error);
  }
  return r;
}

// ---------------------------------------------------------------- the voice settings, shared by the screen's switch and the stage
type Voice = Settings['athena'];
let voice: Voice | null = null;
const voiceSubs = new Set<() => void>();
const setVoice = (v: Voice) => { voice = v; voiceSubs.forEach((f) => f()); };
export function useAthenaVoice(): [Voice | null, (speak: boolean) => Promise<void>] {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    voiceSubs.add(f);
    api<Settings>('/settings').then((s) => setVoice(s.athena)).catch(() => {}); // each screen reads it fresh (Settings may have changed it)
    return () => { voiceSubs.delete(f); };
  }, []);
  const setSpeak = async (speak: boolean) => {
    if (!voice) return;
    const before = voice;
    setVoice({ ...voice, speak_answers: speak });
    try { setVoice((await api<Settings>('/settings', { method: 'PATCH', json: { athena: { ...before, speak_answers: speak } } })).athena); }
    catch (e) { setVoice(before); throw e; }
  };
  return [voice, setSpeak];
}

// ---------------------------------------------------------------- speaking: one audio element, one answer at a time
export type Speech = { id: string; phase: 'loading' | 'playing' } | null;
const el = typeof Audio === 'undefined' ? null : new Audio();
let speech: Speech = null, url = '', turn = 0;
const speechSubs = new Set<() => void>();
const setSpeech = (s: Speech) => { speech = s; speechSubs.forEach((f) => f()); };
let silent = '';

/** Called inside a tap that may lead to speech: iOS only lets an audio element play later if it first played inside a gesture. */
export function primeAudio() {
  if (!el || speech) return;
  silent ||= URL.createObjectURL(new Blob([silentMp3(2) as BlobPart], { type: 'audio/mpeg' }));
  el.src = silent;
  void el.play().catch(() => {});
}

export function stopSpeech() {
  turn++;
  if (el) { el.pause(); el.onended = el.onerror = el.onplaying = null; }
  if (url) { URL.revokeObjectURL(url); url = ''; }
  if (speech) setSpeech(null);
}

async function play(id: string, body: Record<string, unknown>) {
  stopSpeech();
  const n = turn;
  setSpeech({ id, phase: 'loading' });
  try {
    const blob = await (await post('/athena/speak', JSON.stringify(body), { 'Content-Type': 'application/json' })).blob();
    if (n !== turn || !el) return;
    url = URL.createObjectURL(blob);
    el.onplaying = () => { if (n === turn) setSpeech({ id, phase: 'playing' }); };
    el.onended = el.onerror = () => { if (n === turn) stopSpeech(); };
    el.src = url;
    await el.play();
  } catch (e) {
    if (n === turn) stopSpeech();
    throw e;
  }
}
/** Read a stored answer aloud (the Worker caches it, so a replay is free). Rejects with the reason (voice_off, offline_boundary, cap…). */
export const speakAnswer = (messageId: string) => play(messageId, { message_id: messageId });
/** Settings → Athena → Test: a fixed line in `voiceId` (metered, not cached). */
export const testVoice = (voiceId: string | null) => play('test', { test: true, voice_id: voiceId });

export function useSpeech(): Speech {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); speechSubs.add(f); return () => { speechSubs.delete(f); }; }, []);
  return speech;
}

// ---------------------------------------------------------------- listening: hold to talk (touch) or click to start and stop
export type MicPhase = 'off' | 'starting' | 'rec' | 'busy';
const MAX_MS = 60_000, MAX_BYTES = 2 * 1024 * 1024, MIN_MS = 400;
export const micSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
const recType = () => (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');

/** The recording's text goes to `onText` (for the Ask box; never sent on its own); problems go to `onError` as plain sentences. */
export function useMic(onText: (text: string) => void, onError: (message: string) => void) {
  const [phase, setPhase] = useState<MicPhase>('off');
  const want = useRef(false), live = useRef(true);
  const rec = useRef<{ mr: MediaRecorder; timer: ReturnType<typeof setTimeout> } | null>(null);
  const cb = useRef({ onText, onError }); cb.current = { onText, onError };

  const start = async () => {
    if (rec.current || phase !== 'off') return;
    want.current = true; setPhase('starting');
    stopSpeech();
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setPhase('off'); cb.current.onError('The microphone is blocked. Allow it for Compass, then try again.'); return; }
    const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
    if (!want.current || !live.current) { stopTracks(); if (live.current) setPhase('off'); return; } // let go before the mic was ready
    const mime = recType();
    const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 64_000 });
    const chunks: Blob[] = [], t0 = Date.now();
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      stopTracks();
      clearTimeout(rec.current?.timer); rec.current = null;
      if (!live.current) return;
      const ms = Math.min(Date.now() - t0, MAX_MS), type = (mr.mimeType || mime || 'audio/webm').split(';')[0]!;
      const blob = new Blob(chunks, { type });
      if (ms < MIN_MS || !blob.size) { setPhase('off'); cb.current.onError('Hold the mic while you talk.'); return; }
      if (blob.size > MAX_BYTES) { setPhase('off'); cb.current.onError('That recording is too long. Keep it under a minute.'); return; }
      setPhase('busy');
      try {
        const r = await post('/athena/listen', blob, { 'Content-Type': type, 'X-Duration-Ms': String(Math.max(1, ms)) });
        const { text } = (await r.json()) as { text: string };
        if (!live.current) return;
        if (text.trim()) cb.current.onText(text.trim()); else cb.current.onError("Athena didn't catch that. Try again.");
      } catch (e) { if (live.current && !(e instanceof SignedOut)) cb.current.onError((e as Error).message); }
      finally { if (live.current) setPhase('off'); }
    };
    mr.start();
    rec.current = { mr, timer: setTimeout(() => stop(), MAX_MS) };
    setPhase('rec');
  };
  const stop = () => {
    want.current = false;
    if (rec.current?.mr.state === 'recording') rec.current.mr.stop();
  };
  useEffect(() => () => { live.current = false; want.current = false; if (rec.current?.mr.state === 'recording') rec.current.mr.stop(); }, []);
  return { phase, start: () => void start(), stop };
}
