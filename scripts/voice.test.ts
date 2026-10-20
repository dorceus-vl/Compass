import assert from 'node:assert/strict';
import { speechText, parseVoicePrices, ttsCostMicro, sttCostMicro, synthesize, transcribe, sniffAudio, MAX_SPEECH } from '../worker/lib/voice.ts';
import { meter, AiRefused } from '../worker/lib/ai.ts';
import { silentMp3 } from '../shared/silent-mp3.ts';

// speechText: what Athena says out loud.
const meta = 'Ship it Friday.\n\n```compass-meta\n{"citations":[],"proposals":{"tasks":[]}}\n```';
assert.equal(speechText(meta), 'Ship it Friday.', 'the compass-meta block goes');
assert.equal(speechText('Use this:\n\n```js\nconst secret = 1;\n```\n\nThen test.'), 'Use this:\nThen test.', 'code blocks go');
assert.equal(speechText('~~~\nraw\n~~~\nDone.'), 'Done.', 'tilde fences go too');
assert.equal(speechText('## Risks\n\n- **Budget** is *tight*\n- Vendor `late`\n1. First step'), 'Risks.\nBudget is tight.\nVendor late.\n1. First step.', 'headings, bullets, emphasis and inline code lose their symbols');
assert.equal(speechText('See [the plan](https://x.y/plan) and [[raid-log|the RAID log]] or [[change-control]].'), 'See the plan and the RAID log or change control.', 'links keep their text');
assert.equal(speechText('Logo ![Bell logo](a.png) here. Visit https://example.com/x now.'), 'Logo Bell logo here. Visit now.', 'images keep their alt, bare URLs go');
assert.equal(speechText('Before.\n\n| Risk | Owner |\n| --- | --- |\n| Budget | Vlad |\n| Vendor | Ana |\n| Scope | Ben |\n\nAfter.'), 'Before.\nA table with 3 rows.\nAfter.', 'a table is summarised');
assert.equal(speechText('| A |\n|---|\n| 1 |'), 'A table with 1 row.', 'one row');
assert.equal(speechText('> Quoted line\n\n---\n\nEnd'), 'Quoted line.\nEnd.', 'quotes and rules');
assert.equal(speechText('```compass-meta\n{}\n```'), '', 'nothing left to say');
const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
const cut = speechText(long);
assert.ok(cut.length <= MAX_SPEECH && cut.length > MAX_SPEECH - 40, `capped near ${MAX_SPEECH}: ${cut.length}`);
assert.ok(cut.endsWith('here.'), 'cut at a sentence end');
const run = 'word '.repeat(800);
assert.ok(speechText(run).length <= MAX_SPEECH, 'no sentence end: still capped');

// Prices (USD) → micro-dollars.
const p = parseVoicePrices('{"tts_per_1k_chars":0.18,"stt_per_minute":0.40}');
assert.equal(ttsCostMicro(1000, p), 180000, '1,000 characters at $0.18');
assert.equal(ttsCostMicro(1, p), 180);
assert.equal(ttsCostMicro(2500, p), 450000);
assert.equal(sttCostMicro(60000, p), 400000, 'a minute at $0.40');
assert.equal(sttCostMicro(1500, p), 10000);
assert.equal(sttCostMicro(1, p), 7, 'rounded up');
assert.deepEqual(parseVoicePrices('{bad'), parseVoicePrices(undefined), 'bad JSON: defaults');
assert.deepEqual(parseVoicePrices('{"tts_per_1k_chars":-1,"stt_per_minute":0.4}'), parseVoicePrices(undefined), 'a negative price: defaults');

// First bytes of a recording.
assert.equal(sniffAudio(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), 'webm');
assert.equal(sniffAudio(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])), 'mp4');
assert.equal(sniffAudio(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0])), null, 'an mp3 is not a recording we take');

// The stub's silent mp3: a few frames, small.
const s = silentMp3();
assert.ok(s.length < 5 * 1024 && s[0] === 0xff && s[1] === 0xfb, 'silent mp3');

// ElevenLabs requests, with fetch stubbed (never the real endpoint).
const env = { ELEVENLABS_API_KEY: 'xi-key', ATHENA_TTS_MODEL: 'eleven_turbo_v2_5', ATHENA_STT_MODEL: 'scribe_v1' } as never;
const seen: { url: string; init: RequestInit }[] = [];
let reply: Response = new Response(new Uint8Array([1, 2, 3]), { status: 200 });
globalThis.fetch = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return reply; }) as typeof fetch;
const audio = await synthesize(env, 'Voice123', 'Hello Vlad.');
assert.deepEqual([...audio], [1, 2, 3]);
assert.equal(seen[0].url, 'https://api.elevenlabs.io/v1/text-to-speech/Voice123?output_format=mp3_44100_128');
assert.equal((seen[0].init.headers as Record<string, string>)['xi-api-key'], 'xi-key');
assert.deepEqual(JSON.parse(seen[0].init.body as string), { text: 'Hello Vlad.', model_id: 'eleven_turbo_v2_5' });
reply = new Response('{"detail":"echo of the text"}', { status: 401 });
await assert.rejects(synthesize(env, 'Voice123', 'x'), (e: unknown) => e instanceof AiRefused && e.code === 'provider_error' && !e.message.includes('echo'), 'status only, never the body');
reply = new Response(JSON.stringify({ text: 'Move the review to Friday. ' + 'x'.repeat(9000) }), { status: 200 });
const heard = await transcribe(env, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), 'audio/webm');
assert.ok(heard.startsWith('Move the review to Friday.') && heard.length === 8000, 'the transcript, at most 8,000 characters');
const form = seen[2].init.body as FormData;
assert.equal(seen[2].url, 'https://api.elevenlabs.io/v1/speech-to-text');
assert.equal(form.get('model_id'), 'scribe_v1');
assert.equal((form.get('file') as Blob).type, 'audio/webm');
// The stub never calls out.
const n = seen.length;
const stubEnv = { AI_STUB: '1', DEV_LOGIN: '1' } as never;
assert.deepEqual(await synthesize(stubEnv, 'v', 'hi'), silentMp3());
assert.equal(await transcribe(stubEnv, new Uint8Array(4), 'audio/webm'), 'stub transcript');
assert.equal(seen.length, n, 'stub: no fetch');

// meter: model features and voice features have their own hourly limits; both count against the monthly cap.
function fakeDb(state: { month: number; hourModel: number; hourVoice: number; cap: number }) {
  const rows: unknown[][] = [], sql: string[] = [];
  const db = {
    prepare(q: string) {
      sql.push(q);
      const stmt = (args: unknown[]) => ({
        async first() {
          if (q.includes('FROM settings')) return { json: JSON.stringify({ ai_monthly_cap_micro: state.cap }) };
          if (q.includes('SUM(cost_micro)')) return { c: state.month };
          if (q.includes('COUNT(*)')) return { n: q.includes('NOT IN') ? state.hourModel : state.hourVoice };
          return null;
        },
        async run() { if (q.startsWith('INSERT INTO ai_usage')) rows.push(args); return { meta: { changes: 1 } }; },
      });
      return { ...stmt([]), bind: (...args: unknown[]) => stmt(args) };
    },
  };
  return { db, rows, sql };
}
const st = { month: 0, hourModel: 30, hourVoice: 0, cap: 1_000_000 };
const f = fakeDb(st);
const menv = { DB: f.db } as never;
await assert.rejects(meter(menv, 'copilot'), (e: unknown) => e instanceof AiRefused && e.code === 'rate_limited', '30 model calls an hour');
const record = await meter(menv, 'athena_voice', 1000); // the model limit is full, the voice one is not
await record({ provider: 'elevenlabs', input_tokens: 11, output_tokens: 0, cost_micro: 1000 });
assert.equal(f.rows.length, 1, 'one usage row');
assert.equal(f.rows[0][2], 'athena_voice');
assert.equal(f.rows[0][3], 'elevenlabs');
st.hourVoice = 60;
await assert.rejects(meter(menv, 'athena_listen', 1), (e: unknown) => e instanceof AiRefused && e.code === 'rate_limited', '60 voice calls an hour');
st.hourVoice = 0; st.month = 999_500;
await assert.rejects(meter(menv, 'athena_voice', 1000), (e: unknown) => e instanceof AiRefused && e.code === 'cap_reached', 'an estimate that would cross the cap');
st.hourModel = 0; st.month = 1_000_000;
await assert.rejects(meter(menv, 'copilot'), (e: unknown) => e instanceof AiRefused && e.code === 'cap_reached', 'the cap stops model calls too');
assert.ok(f.sql.some((q) => /feature NOT IN/.test(q)) && f.sql.some((q) => /feature IN/.test(q)), 'separate hourly counts');

console.log('voice: ok');
