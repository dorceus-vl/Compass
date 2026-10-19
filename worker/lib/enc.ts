import type { Env } from '../types.ts';
import { encryptString, decryptString } from './crypto-box.js';

// Which text columns are ciphertext on a work row. AAD binds each value to its column (table.column).
export const ENC_COLS = {
  projects: ['name', 'rag_reason', 'sponsor', 'objectives', 'scope_in', 'scope_out', 'success_criteria'],
  milestones: ['name'],
  tasks: ['title', 'notes', 'waiting_on'],
  task_events: ['data'],
  inbox_items: ['title', 'body', 'payload'],
  meeting_reviews: ['title', 'summary', 'decisions', 'action_items', 'open_questions', 'important_notes'],
  decisions: ['text'],
} as const;
export type EncTable = keyof typeof ENC_COLS;
type Row = { enc_v?: number; kind?: string }; // typed rows (Project, Milestone) have no index signature
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
