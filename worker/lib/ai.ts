import type { Env } from '../types.ts';
import type { AiFeature, Provider } from '../../shared/types.ts';
import { audit, getSettings, now } from './db.ts';

export type AiTurn = { role: 'user' | 'assistant'; content: string };
export type AiCall = { provider: Provider; system: string; messages: AiTurn[]; maxTokens: number };
export type AiResult = { text: string; input_tokens: number; output_tokens: number; cost_micro: number };
type Prices = Record<Provider, { in: number; out: number }>;
type Code = 'no_key' | 'cap_reached' | 'rate_limited' | 'offline_boundary' | 'provider_error';

const STATUS: Record<Code, number> = { no_key: 503, cap_reached: 409, rate_limited: 429, offline_boundary: 409, provider_error: 502 };
const NAMES: Record<Provider, string> = { claude: 'Claude', gemini: 'Gemini' };
const HOURLY_LIMIT = 30;

export class AiRefused extends Error {
  code: Code;
  status: number;
  constructor(code: Code, message: string) { super(message); this.code = code; this.status = STATUS[code]; }
}

const DEFAULT_PRICES: Prices = { claude: { in: 3, out: 15 }, gemini: { in: 0.75, out: 3.75 } };

export function parsePrices(raw?: string): Prices {
  try {
    const j = JSON.parse(raw ?? '');
    const ok = (['claude', 'gemini'] as const).every((k) => [j?.[k]?.in, j?.[k]?.out].every((n) => typeof n === 'number' && n > 0 && Number.isFinite(n)));
    return ok ? { claude: { in: j.claude.in, out: j.claude.out }, gemini: { in: j.gemini.in, out: j.gemini.out } } : DEFAULT_PRICES;
  } catch { return DEFAULT_PRICES; }
}

/** USD per million tokens × tokens = micro-dollars. */
export const costMicro = (p: Prices, provider: Provider, inTok: number, outTok: number) => Math.ceil(inTok * p[provider].in + outTok * p[provider].out);

/** The UTC instant of 00:00 on the 1st of now's month in tz. */
export function monthStartUtc(tz: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric' }).formatToParts(at);
  const y = Number(parts.find((x) => x.type === 'year')!.value), m = Number(parts.find((x) => x.type === 'month')!.value);
  const guess = Date.UTC(y, m - 1, 1);
  const offsetMs = (t: number) => {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(t)).find((x) => x.type === 'timeZoneName')!.value;
    const mm = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    return mm ? (mm[1] === '-' ? -1 : 1) * (Number(mm[2]) * 60 + Number(mm[3] ?? 0)) * 60000 : 0;
  };
  // Applied twice so a DST change at the start of the month lands right.
  return new Date(guess - offsetMs(guess - offsetMs(guess))).toISOString();
}

export function anthropicRequest(env: Env, call: AiCall): { url: string; init: RequestInit } {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env.AI_MODEL_CLAUDE, max_tokens: call.maxTokens, system: call.system, messages: call.messages }),
    },
  };
}

export function geminiRequest(env: Env, call: AiCall): { url: string; init: RequestInit } {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${env.AI_MODEL_GEMINI}:generateContent`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY ?? '' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: call.system }] },
        contents: call.messages.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
        generationConfig: { maxOutputTokens: call.maxTokens },
      }),
    },
  };
}

type Read = { text: string; input_tokens: number; output_tokens: number };
export function readAnthropic(j: any): Read {
  return {
    text: (Array.isArray(j?.content) ? j.content : []).map((b: { type?: string; text?: string }) => (b?.type === 'text' ? b.text ?? '' : '')).join(''),
    input_tokens: Number(j?.usage?.input_tokens) || 0, output_tokens: Number(j?.usage?.output_tokens) || 0,
  };
}
export function readGemini(j: any): Read {
  return {
    text: (Array.isArray(j?.candidates?.[0]?.content?.parts) ? j.candidates[0].content.parts : []).map((p: { text?: string }) => p?.text ?? '').join(''),
    input_tokens: Number(j?.usageMetadata?.promptTokenCount) || 0, // Thinking tokens bill at the output rate.
    output_tokens: (Number(j?.usageMetadata?.candidatesTokenCount) || 0) + (Number(j?.usageMetadata?.thoughtsTokenCount) || 0),
  };
}

const hasKey = (env: Env, p: Provider) => !!(p === 'claude' ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY);

async function monthCost(env: Env, tz: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(cost_micro), 0) AS c FROM ai_usage WHERE at >= ?1').bind(monthStartUtc(tz, new Date())).first<{ c: number }>();
  return r?.c ?? 0;
}

function stubAnswer(call: AiCall): Read {
  const last = [...call.messages].reverse().find((t) => t.role === 'user')?.content ?? '';
  const slug = call.system.match(/<<<data page ([^ \n]+)/)?.[1];
  const meta = { citations: slug ? [slug] : [], proposals: { tasks: [{ title: 'Stub task', horizon: 'short', due_at: null }], raid: [], decisions: [] } };
  return { text: `Stub answer for: ${last.slice(0, 4000)}\n\n\`\`\`compass-meta\n${JSON.stringify(meta)}\n\`\`\``, input_tokens: 100, output_tokens: 50 };
}

/** One model call, with the key, cap and hourly checks first and the usage row + audit (never content) after. */
export async function runAi(env: Env, feature: AiFeature, call: AiCall): Promise<AiResult> {
  if (!hasKey(env, call.provider) && !(env.AI_STUB === '1' && env.DEV_LOGIN === '1')) throw new AiRefused('no_key', `${NAMES[call.provider]} isn't set up yet.`);
  const s = await getSettings(env);
  if (await monthCost(env, s.tz) >= s.ai_monthly_cap_micro) throw new AiRefused('cap_reached', "This month's AI budget is used up. Raise it in Settings → AI.");
  const hour = await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE at >= ?1').bind(new Date(Date.now() - 3600_000).toISOString()).first<{ n: number }>();
  if ((hour?.n ?? 0) >= HOURLY_LIMIT) throw new AiRefused('rate_limited', '30 questions an hour is the limit. Try again in a few minutes.');

  let out: Read;
  if (env.AI_STUB === '1' && env.DEV_LOGIN === '1') out = stubAnswer(call);
  else {
    const { url, init } = call.provider === 'claude' ? anthropicRequest(env, call) : geminiRequest(env, call);
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      // Status only: the body can echo the prompt.
      if (!res.ok) throw new AiRefused('provider_error', `${NAMES[call.provider]} returned ${res.status}.`);
      out = (call.provider === 'claude' ? readAnthropic : readGemini)(await res.json());
    } catch (e) {
      throw e instanceof AiRefused ? e : new AiRefused('provider_error', `${NAMES[call.provider]} could not be reached.`);
    }
  }
  const cost_micro = costMicro(parsePrices(env.AI_PRICES), call.provider, out.input_tokens, out.output_tokens);
  await env.DB.prepare('INSERT INTO ai_usage (id, at, feature, provider, input_tokens, output_tokens, cost_micro) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(crypto.randomUUID(), now(), feature, call.provider, out.input_tokens, out.output_tokens, cost_micro).run();
  await audit(env, 'you', 'ai.' + feature, null, { provider: call.provider, input_tokens: out.input_tokens, output_tokens: out.output_tokens, cost_micro });
  return { ...out, cost_micro };
}

export async function aiUsage(env: Env): Promise<{ month_cost_micro: number; cap_micro: number; keys: Record<Provider, boolean>; models: Record<Provider, string> }> {
  const s = await getSettings(env);
  return {
    month_cost_micro: await monthCost(env, s.tz), cap_micro: s.ai_monthly_cap_micro,
    keys: { claude: hasKey(env, 'claude'), gemini: hasKey(env, 'gemini') },
    models: { claude: env.AI_MODEL_CLAUDE, gemini: env.AI_MODEL_GEMINI },
  };
}
