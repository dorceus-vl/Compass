import type { Env } from '../types.ts';
import { AiRefused, isStub } from './ai.ts';
import { silentMp3 } from '../../shared/silent-mp3.ts';

// Athena's voice (ruling A6): her answer as speech text, ElevenLabs text-to-speech and speech-to-text, and their prices.
// ElevenLabs is called only from here (the Worker). Neither text nor audio is ever logged.

export const MAX_SPEECH = 2500;
export const MAX_TRANSCRIPT = 8000;
const API = 'https://api.elevenlabs.io/v1';

// Pipe tables, with or without outer pipes: a header row, a separator row with at least one pipe, then rows that have a pipe.
const isRow = (s: string) => s.includes('|') && !!s.trim();
const isSep = (s: string) => s.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(s);
const inline = (s: string) => s
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images keep their alt text
  .replace(/\[\[[a-z0-9-]+\|([^\]]+)\]\]/g, '$1') // library links keep their label, or their slug as words
  .replace(/\[\[([a-z0-9-]+)\]\]/g, (_, slug: string) => slug.replace(/-/g, ' '))
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links keep their text
  .replace(/<https?:[^>]*>|https?:\/\/\S+/g, '') // bare addresses are not read out
  .replace(/<[^>]+>/g, '')
  .replace(/`([^`]*)`/g, '$1')
  .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
  .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=[^\w*]|$)/g, '$1$2')
  .replace(/[*`]/g, '');

/** What Athena says aloud: no compass-meta block, no code, links as their text, tables summarised, no Markdown symbols; at most
 *  MAX_SPEECH characters, cut at a sentence end. Each line ends with punctuation so the voice pauses between items. */
export function speechText(markdown: string): string {
  const t = markdown.replace(/\r\n?/g, '\n')
    .replace(/\n?```compass-meta[\s\S]*$/, '')
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, '')
    .replace(/^(`{3,}|~{3,})[\s\S]*$/m, ''); // a fence left open runs to the end
  const lines = t.split('\n'), out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isRow(lines[i]!) && isSep(lines[i + 1] ?? '')) {
      let j = i + 2;
      while (j < lines.length && isRow(lines[j]!)) j++;
      const n = j - i - 2;
      out.push(`A table with ${n} row${n === 1 ? '' : 's'}.`);
      i = j - 1;
      continue;
    }
    let line = lines[i]!;
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue; // a rule
    line = inline(line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*>+\s?/, '').replace(/^\s*[-*+]\s+/, '')).replace(/\s+/g, ' ').trim();
    if (line) out.push(/[.!?:;,…]$/.test(line) ? line : line + '.');
  }
  const all = out.join('\n');
  if (all.length <= MAX_SPEECH) return all;
  const head = all.slice(0, MAX_SPEECH);
  let end = -1;
  for (const m of head.matchAll(/[.!?…](?=\s|$)/g)) end = m.index!;
  if (end > 0) return head.slice(0, end + 1);
  const space = head.search(/\s\S*$/);
  return head.slice(0, space > 0 ? space : MAX_SPEECH);
}

type Prices = { tts_per_1k_chars: number; stt_per_minute: number };
const DEFAULT_PRICES: Prices = { tts_per_1k_chars: 0.18, stt_per_minute: 0.4 };
export function parseVoicePrices(raw?: string): Prices {
  try {
    const j = JSON.parse(raw ?? '');
    const ok = [j?.tts_per_1k_chars, j?.stt_per_minute].every((n) => typeof n === 'number' && n > 0 && Number.isFinite(n));
    return ok ? { tts_per_1k_chars: j.tts_per_1k_chars, stt_per_minute: j.stt_per_minute } : DEFAULT_PRICES;
  } catch { return DEFAULT_PRICES; }
}
/** USD per 1,000 characters × characters = micro-dollars (rounded up). */
export const ttsCostMicro = (chars: number, p: Prices) => Math.ceil(chars * p.tts_per_1k_chars * 1000 - 1e-6);
/** USD per minute × milliseconds = micro-dollars (rounded up). */
export const sttCostMicro = (ms: number, p: Prices) => Math.ceil((ms * p.stt_per_minute * 1e6) / 60000 - 1e-6);

/** A recording's first bytes: WebM (Chrome, Firefox, Android) or MP4 (Safari, iOS). */
export function sniffAudio(head: Uint8Array): 'webm' | 'mp4' | null {
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
  if (String.fromCharCode(...head.subarray(4, 8)) === 'ftyp') return 'mp4';
  return null;
}

export const voiceKey = (env: Env) => !!env.ELEVENLABS_API_KEY || isStub(env);

async function call(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }); }
  catch { throw new AiRefused('provider_error', 'ElevenLabs could not be reached.'); }
  // Status only: the body can echo the text.
  if (!res.ok) throw new AiRefused('provider_error', `ElevenLabs returned ${res.status}.`);
  return res;
}

/** Text to MP3 in `voiceId`. The stub returns a short silent MP3. */
export async function synthesize(env: Env, voiceId: string, text: string): Promise<Uint8Array> {
  if (isStub(env)) return silentMp3();
  const res = await call(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'audio/mpeg', 'xi-api-key': env.ELEVENLABS_API_KEY ?? '' },
    body: JSON.stringify({ text, model_id: env.ATHENA_TTS_MODEL }),
  });
  return new Uint8Array(await res.arrayBuffer());
}

/** A recording to text, at most MAX_TRANSCRIPT characters. The stub returns "stub transcript". */
export async function transcribe(env: Env, audio: Uint8Array, type: 'audio/webm' | 'audio/mp4'): Promise<string> {
  if (isStub(env)) return 'stub transcript';
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), type === 'audio/mp4' ? 'speech.m4a' : 'speech.webm');
  form.append('model_id', env.ATHENA_STT_MODEL);
  const res = await call(`${API}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY ?? '' }, body: form });
  const j = (await res.json().catch(() => null)) as { text?: unknown } | null;
  return (typeof j?.text === 'string' ? j.text : '').trim().slice(0, MAX_TRANSCRIPT);
}
