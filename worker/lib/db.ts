import type { Env } from '../types.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types.ts';

export const now = () => new Date().toISOString();

export async function audit(env: Env, actor: string, action: string, target: string | null, detail?: unknown) {
  await env.DB.prepare('INSERT INTO audit_log (id, at, actor, action, target, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(crypto.randomUUID(), now(), actor, action, target, detail === undefined ? null : JSON.stringify(detail)).run();
}

export async function getSettings(env: Env): Promise<Settings> {
  const row = await env.DB.prepare('SELECT json FROM settings WHERE id = 1').first<{ json: string }>();
  return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.json) : {}) };
}

export async function patchSettings(env: Env, patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings(env)), ...patch };
  await env.DB.prepare('INSERT INTO settings (id, json, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET json = ?1, updated_at = ?2')
    .bind(JSON.stringify(next), now()).run();
  return next;
}
