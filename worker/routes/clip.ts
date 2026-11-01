import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import { now, audit } from '../lib/db.ts';
import { checkDoc, MAX_IMAGE_BYTES } from '../lib/uploads.ts';
import { createTaskFromSource, addEvent } from './tasks.ts';

/**
 * v2.12 clip: the PWA's share target (manifest.webmanifest) posts here. A shared page becomes a personal task in the Inbox column (title, link, any selected text);
 * a shared screenshot (PNG or JPG) is stored as a document linked to that task. Always answers with a redirect to the app, because the browser is showing this response.
 */
const clip = new Hono<{ Bindings: Env; Variables: Variables }>();

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const link = (s: string) => { try { const u = new URL(s); return u.protocol === 'https:' ? u.href : null; } catch { return null; } };

clip.post('/', async (c) => {
  const len = c.req.header('content-length');
  if (len && Number(len) > MAX_IMAGE_BYTES + 256 * 1024) return c.redirect('/?clip=too_big', 303);
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.redirect('/?clip=failed', 303);
  const text = str(form.get('text'), 2000), url = link(str(form.get('url'), 2048) || (text.match(/https:\/\/\S+/)?.[0] ?? ''));
  const title = str(form.get('title'), 200) || text.split('\n')[0].slice(0, 200) || (url ? new URL(url).hostname : '');
  const file = form.get('screenshot');
  if (!title && !(file instanceof File)) return c.redirect('/?clip=empty', 303);
  let shot = 'none', ok: ReturnType<typeof checkDoc> | null = null, name = '';
  if (file instanceof File && file.size) {
    name = (file.name.split(/[\\/]/).pop() ?? '').trim().slice(0, 200) || 'screenshot.png';
    ok = checkDoc({ name, type: file.type, size: file.size }, new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if ('error' in ok || (ok.kind !== 'png' && ok.kind !== 'jpg')) { ok = null; shot = 'bad'; } // an image only: a clip never lands a PDF or Office file
  }
  if (shot === 'bad' && !title) return c.redirect('/?clip=empty&shot=bad', 303);
  const task = await createTaskFromSource(c.env, { title: title || 'Clipped screenshot', notes: text && text !== title ? text : null, source_url: url });
  await addEvent(c.env, task, 'you', 'created');
  await audit(c.env, 'you', 'task.clip', task.id);
  if (ok && file instanceof File) {
    const id = crypto.randomUUID(), t = now(), r2_key = `docs/${id}`;
    try {
      await c.env.FILES.put(r2_key, new Uint8Array(await file.arrayBuffer()), { httpMetadata: { contentType: ok.type } });
      await c.env.DB.prepare('INSERT INTO documents (id, name, kind, size, content_type, r2_key, project_id, task_id, is_template, placeholders, text_indexed, created_at, updated_at, enc_v) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,0,\'[]\',0,?8,?8,0)')
        .bind(id, name, 'error' in ok ? 'png' : ok.kind, file.size, ok.type, r2_key, task.id, t).run();
      shot = 'ok';
    } catch { await c.env.FILES.delete(r2_key).catch(() => {}); shot = 'failed'; }
  }
  return c.redirect(`/?clip=${task.id}&shot=${shot}`, 303);
});

export default clip;
