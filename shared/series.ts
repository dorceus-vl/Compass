// Meeting series (v2.1 V6-V9): which meetings belong together, the open questions' hashes and the agenda for the next session.
// Pure and shared: the Worker keys series with it, the device builds the agenda with it.
import { list, table, sec, type TemplateDoc } from './doc-model.ts';
import type { MeetingReview } from './types.ts';

const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DAY = 'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?';
// What a recurring meeting changes from one week to the next, in the order it is taken out.
const NOISE = [
  /\([^)]*\d[^)]*\)|\[[^\]]*\d[^\]]*\]/g, // (2026-10-21) [14:30]
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g, // ISO date
  /\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b/g, // 14/10, 14.10.2026
  new RegExp(`\\b(?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, 'gi'), // Oct 14, October 14th, 2026
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH})\\b\\.?(?:,?\\s+\\d{4})?`, 'gi'), // 14 Oct 2026
  new RegExp(`\\b(?:${DAY})\\b\\.?`, 'gi'), // weekday names
  /\b(?:session|week|wk|sprint|episode|ep|part)\s*#?\s*\d+\b/gi, // session 4, week 12
  /#\s*\d+/g, // #3
  /\b\d+(?:st|nd|rd|th)?\b/g, // any number left over ("Q3" stays: the digit isn't a word of its own)
];
const strip = (title: string) => NOISE.reduce((s, re) => s.replace(re, ' '), title);

/** The title with its dates and numbers taken out and the case kept: what a series is called. */
export function seriesName(title: string): string {
  const s = strip(title).replace(/\s+/g, ' ').replace(/(?:\s*[-–—|:,]\s*){2,}/g, ' – ').replace(/^[\s\-–—|:,]+|[\s\-–—|:,]+$/g, '');
  return s || title.trim().slice(0, 120) || 'Meeting';
}
/** V6: meetings with the same key (in the same project, or all unfiled) are one series. Lowercase words only; dates, numbers, dashes and spaces are gone. */
export function seriesKey(title: string): string {
  return strip(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || 'meeting';
}

/** V8: a question is told apart by its words, not its place in a meeting. */
export const normQuestion = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').replace(/[\s.?!]+$/g, '').trim();
/** First 16 hex digits (64 bits) of SHA-256 of the normalised question. */
export async function questionHash(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normQuestion(text))));
  return Array.from(d.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
export const HASH = /^[0-9a-f]{16}$/;

export interface SeriesSummary { id: string; name: string; project_id: string | null; kind: 'personal' | 'work'; meetings: number; new_meetings: number; last_at: string | null; open_actions: number }
export interface SeriesAction { id: string; title: string; owner: string | null; due_at: string | null; status: string; review_id: string }
export interface SeriesQuestion { hash: string; text: string; at: string | null; review_id: string; answered: boolean }
export interface SeriesDecision { id: string; text: string; decided_at: string; at_ref: string | null; from_meeting_id: string | null }

/** V9: the agenda for the next session: open actions by owner, open questions, the last 3 decisions, and the last meeting's important notes carried over. */
export function buildAgenda(
  series: { name: string },
  reviews: Pick<MeetingReview, 'received_at' | 'important_notes'>[],
  tasks: Pick<SeriesAction, 'title' | 'owner' | 'due_at' | 'status'>[],
  decisions: Pick<SeriesDecision, 'text' | 'decided_at'>[],
  questions: Pick<SeriesQuestion, 'text' | 'answered'>[],
): TemplateDoc {
  const open = tasks.filter((t) => t.status !== 'done');
  const ownerOf = (t: { owner: string | null }) => t.owner?.trim() || 'No owner';
  const byOwner = [...open].sort((a, b) => (ownerOf(a) === 'No owner' ? 1 : 0) - (ownerOf(b) === 'No owner' ? 1 : 0) || ownerOf(a).localeCompare(ownerOf(b)) || (a.due_at ?? '9').localeCompare(b.due_at ?? '9'));
  const last3 = [...decisions].sort((a, b) => b.decided_at.localeCompare(a.decided_at)).slice(0, 3);
  const latest = [...reviews].sort((a, b) => b.received_at.localeCompare(a.received_at))[0];
  return {
    title: 'Agenda', subtitle: `${series.name} · next session`,
    sections: [
      sec('Open actions', table(['Owner', 'Action', 'Due'], byOwner.map((t) => [ownerOf(t), t.title, t.due_at ?? '']), 'No open actions.')),
      sec('Open questions', list(questions.filter((q) => !q.answered).map((q) => q.text), 'No open questions.')),
      sec('Recent decisions', list(last3.map((d) => `${d.text} (${d.decided_at})`), 'No decisions yet.')),
      sec('Carried over from the last meeting', list((latest?.important_notes ?? []).map((n) => n.text), 'Nothing carried over.')),
    ],
  };
}
