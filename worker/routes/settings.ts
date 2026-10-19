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
  if (Array.isArray(body.work_email_domains)) {
    const d = body.work_email_domains;
    if (d.length > 10 || !d.every((x) => typeof x === 'string' && DOMAIN.test(x))) return c.json({ error: 'work_email_domains must be up to 10 lowercase domains' }, 400);
    patch.work_email_domains = d;
  }
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
