import type { Env } from '../types.ts';
import { encryptString, decryptString } from './crypto-box.js';

// Which text columns are ciphertext on a work row. AAD binds each value to its column (table.column).
export const ENC_COLS = {
  projects: ['name', 'rag_reason', 'sponsor', 'objectives', 'scope_in', 'scope_out', 'success_criteria', 'fields', 'wbs'],
  milestones: ['name'],
  tasks: ['title', 'notes', 'waiting_on', 'checklist', 'field_values'],
  task_events: ['data'],
  inbox_items: ['title', 'body', 'payload'],
  meeting_reviews: ['title', 'summary', 'decisions', 'action_items', 'open_questions', 'important_notes'],
  decisions: ['text'],
  raid_items: ['text', 'response', 'owner', 'trigger'],
  change_requests: ['title', 'description', 'impact_scope', 'impact_time', 'impact_cost', 'approver'],
  lessons: ['text'],
  documents: ['name'],
  ai_threads: ['title'],
  ai_messages: ['content', 'proposals'],
  // Phase 6. The locator is sealed too: a heading (`§ Budget risks`) or a sheet name says what the passage is about.
  knowledge_collections: ['name'],
  knowledge_items: ['title'],
  knowledge_chunks: ['text', 'locator'],
  // v2.1. A series' `key` is a hash for work (see 0014_v2_pm.sql), so only the name and the answered list are sealed.
  templates: ['name', 'body'],
  meeting_series: ['name', 'answered'],
  // v2.2. A baseline's snapshot holds ids and dates only, but it is sealed with the name so a work plan's shape is not readable at rest.
  baselines: ['name', 'snapshot'],
  stakeholders: ['name', 'role', 'channel', 'notes'],
  // v2.4. rag and kind stay plain.
  programs: ['name', 'rag_reason', 'notes'],
  // v2.5. Times, ids, source and flags stay plain.
  time_entries: ['note'],
  // v2.6. Children seal by their goal's kind; numbers, dates, type, status and confidence stay plain. Links hold ids only.
  goals: ['title', 'description'],
  key_results: ['title', 'unit'],
  goal_checkins: ['note'],
} as const;
export type EncTable = keyof typeof ENC_COLS;
type Row = { enc_v?: number; kind?: string | null }; // typed rows (Project, Milestone) have no index signature
type Cols = Record<string, unknown>;

/** Encrypts the table's text columns when the row (or the given kind) is work. Mutates and returns the row. */
export async function seal<T extends Row>(env: Env, table: EncTable, row: T, kind = row.kind): Promise<T> {
  if (kind !== 'work') return row;
  for (const col of ENC_COLS[table]) {
    const v = (row as Cols)[col];
    if (typeof v === 'string' && v !== '') (row as Cols)[col] = await encryptString(v, env.COMPASS_DATA_KEY, `${table}.${col}`);
  }
  row.enc_v = 2;
  return row;
}

/** Decrypts a row written by seal(); a plain row passes through. */
export async function open<T extends Row>(env: Env, table: EncTable, row: T): Promise<T> {
  if (row.enc_v !== 2) return row;
  for (const col of ENC_COLS[table]) {
    const v = (row as Cols)[col];
    if (typeof v === 'string' && v !== '') (row as Cols)[col] = await decryptString(v, env.COMPASS_DATA_KEY, `${table}.${col}`);
  }
  return row;
}

export const openAll = <T extends Row>(env: Env, table: EncTable, rows: T[]) => Promise.all(rows.map((r) => open(env, table, r)));

/** Raw bytes (a stored .eml) as one ciphertext string: base64, then the same AAD cipher as a column. Always sealed, work or not. */
export async function sealBytes(env: Env, bytes: ArrayBuffer | Uint8Array, context: string): Promise<string> {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return encryptString(btoa(bin), env.COMPASS_DATA_KEY, context);
}
export async function openBytes(env: Env, sealedText: string, context: string): Promise<Uint8Array> {
  const bin = atob(await decryptString(sealedText, env.COMPASS_DATA_KEY, context));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}
