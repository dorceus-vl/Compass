import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { Settings } from '../../shared/types.ts';
import { dateTime } from '../lib/validate.ts';
import { getSettings, patchSettings, audit } from '../lib/db.ts';

const settings = new Hono<{ Bindings: Env; Variables: Variables }>();
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

settings.get('/', async (c) => c.json(await getSettings(c.env)));

settings.patch('/', async (c) => {
  const body = await c.req.json<Partial<Settings>>().catch(() => ({}) as Partial<Settings>);
  if (body && typeof body === 'object' && 'kelly' in body) return c.json({ error: 'use_kelly_route' }, 400); // Kelly's grants change only through the passkey-guarded route
  const patch: Partial<Settings> = {};
  const hour = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23;
  if (hour(body.day_start_hour)) patch.day_start_hour = body.day_start_hour!;
  if (hour(body.digest_hour)) patch.digest_hour = body.digest_hour!;
  if (typeof body.quiet_from === 'string' && HHMM.test(body.quiet_from)) patch.quiet_from = body.quiet_from;
  if (typeof body.quiet_to === 'string' && HHMM.test(body.quiet_to)) patch.quiet_to = body.quiet_to;
  if (Number.isInteger(body.weekly_review_day) && body.weekly_review_day! >= 0 && body.weekly_review_day! <= 6) patch.weekly_review_day = body.weekly_review_day!;
  if (typeof body.tz === 'string') { try { new Intl.DateTimeFormat('en-CA', { timeZone: body.tz }); patch.tz = body.tz; } catch { return c.json({ error: 'tz is not a time zone' }, 400); } }
  if (body.wip_limits && typeof body.wip_limits === 'object') {
    const w = { ...(await getSettings(c.env)).wip_limits };
    for (const k of ['new', 'progress', 'hold', 'waiting', 'done'] as const) {
      const v = (body.wip_limits as Record<string, unknown>)[k];
      if (v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 99)) w[k] = v as number | null;
    }
    patch.wip_limits = w;
  }
  if (body.push && typeof body.push === 'object') {
    const p = { ...(await getSettings(c.env)).push };
    for (const k of Object.keys(p) as (keyof Settings['push'])[]) {
      const v = (body.push as Record<string, unknown>)[k];
      if (typeof v === 'boolean') p[k] = v;
    }
    patch.push = p;
  }
  if (body.athena && typeof body.athena === 'object') { // her voice and whether she speaks; portrait_id is set only by POST/DELETE /api/athena/portrait
    const a = { ...(await getSettings(c.env)).athena }, b = body.athena as Record<string, unknown>;
    if (b.voice_id !== undefined) {
      if (b.voice_id !== null && !(typeof b.voice_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.voice_id))) return c.json({ error: 'athena.voice_id must be an ElevenLabs voice id (letters and digits) or null' }, 400);
      a.voice_id = b.voice_id as string | null;
    }
    if (b.speak_answers !== undefined) {
      if (typeof b.speak_answers !== 'boolean') return c.json({ error: 'athena.speak_answers must be true or false' }, 400);
      a.speak_answers = b.speak_answers;
    }
    patch.athena = a;
  }
  if (body.widgets && typeof body.widgets === 'object') {
    const b = body.widgets as Record<string, unknown>;
    if (b.hide_work_on_lock !== undefined && typeof b.hide_work_on_lock !== 'boolean') return c.json({ error: 'widgets.hide_work_on_lock must be true or false' }, 400);
    patch.widgets = { ...(await getSettings(c.env)).widgets, ...(b.hide_work_on_lock !== undefined && { hide_work_on_lock: b.hide_work_on_lock }) };
  }
  if (body.workload !== undefined) { // capacity (P9): partial; an override set to null is removed
    if (!body.workload || typeof body.workload !== 'object') return c.json({ error: 'workload must be an object' }, 400);
    const b = body.workload as Record<string, unknown>, w = { ...(await getSettings(c.env)).workload };
    const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
    for (const [k, lo, hi] of [['work_hours', 0, 168], ['personal_hours', 0, 168], ['day_hours', 1, 24], ['default_estimate_minutes', 0, 2400]] as const) {
      if (b[k] === undefined) continue;
      if (!num(b[k], lo, hi) || (k === 'default_estimate_minutes' && !Number.isInteger(b[k]))) return c.json({ error: `workload.${k} must be a number from ${lo} to ${hi}` }, 400);
      w[k] = b[k] as number;
    }
    if (b.overrides !== undefined) {
      if (!b.overrides || typeof b.overrides !== 'object' || Array.isArray(b.overrides)) return c.json({ error: 'workload.overrides must be an object keyed by Monday' }, 400);
      const o = { ...w.overrides };
      for (const [k, v] of Object.entries(b.overrides as Record<string, unknown>)) {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(k) ? Date.parse(k + 'T00:00:00Z') : NaN;
        if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== k || new Date(day).getUTCDay() !== 1) return c.json({ error: 'workload.overrides keys must be Mondays (YYYY-MM-DD)' }, 400);
        if (v === null) { delete o[k]; continue; }
        const x = v as Record<string, unknown>;
        if (!x || typeof x !== 'object' || !num(x.work, 0, 168) || !num(x.personal, 0, 168)) return c.json({ error: 'workload.overrides values must be { work, personal } hours from 0 to 168' }, 400);
        o[k] = { work: x.work as number, personal: x.personal as number };
      }
      if (Object.keys(o).length > 104) return c.json({ error: 'workload.overrides can hold at most 104 weeks' }, 400);
      w.overrides = o;
    }
    patch.workload = w;
  }
  if (Array.isArray(body.work_email_domains)) {
    const d = body.work_email_domains;
    if (d.length > 10 || !d.every((x) => typeof x === 'string' && DOMAIN.test(x))) return c.json({ error: 'work_email_domains must be up to 10 lowercase domains' }, 400);
    patch.work_email_domains = d;
  }
  if (Number.isInteger(body.ai_monthly_cap_micro) && body.ai_monthly_cap_micro! >= 0 && body.ai_monthly_cap_micro! <= 1_000_000_000) patch.ai_monthly_cap_micro = body.ai_monthly_cap_micro!;
  else if (body.ai_monthly_cap_micro !== undefined) return c.json({ error: 'ai_monthly_cap_micro must be a whole number from 0 to 1000000000 (up to $1000)' }, 400);
  if (body.default_provider === 'claude' || body.default_provider === 'gemini') patch.default_provider = body.default_provider;
  else if (body.default_provider !== undefined) return c.json({ error: 'default_provider must be one of: claude, gemini' }, 400);
  if (body.last_review_at !== undefined) {
    const r = dateTime()(body.last_review_at, 'last_review_at');
    if ('error' in r) return c.json({ error: r.error }, 400);
    patch.last_review_at = r.value as string | null;
  }
  if (Array.isArray(body.saved_views)) patch.saved_views = body.saved_views.filter((v) => v && typeof v.name === 'string' && typeof v.query === 'string').slice(0, 50).map((v) => ({ name: v.name.slice(0, 60), query: v.query.slice(0, 500) }));
  const next = await patchSettings(c.env, patch);
  await audit(c.env, 'you', 'settings.edit', null, Object.keys(patch));
  return c.json(next);
});

export default settings;
