// The document model the report and minutes builders share (web renders it to Word, Markdown and print; the Worker reads the minutes as Markdown for knowledge).
import type { MeetingReview } from './types.ts';

export type DocBlock = { t: 'p'; text: string } | { t: 'list'; items: string[] } | { t: 'table'; headers: string[]; rows: string[][] } | { t: 'fields'; pairs: [string, string][] };
export type TemplateDoc = { title: string; subtitle: string; sections: { heading: string; blocks: DocBlock[] }[] };

export const p = (text = ''): DocBlock => ({ t: 'p', text });
export const fields = (...pairs: [string, string][]): DocBlock => ({ t: 'fields', pairs });
export const list = (items: string[], none = 'None.'): DocBlock => (items.length ? { t: 'list', items } : p(none));
export const table = (headers: string[], rows: (string | number)[][], none = 'None.'): DocBlock => (rows.length ? { t: 'table', headers, rows: rows.map((r) => r.map(String)) } : p(none));
export const sec = (heading: string, ...blocks: DocBlock[]) => ({ heading, blocks });

/** A meeting review as minutes: the Minutes buttons (Word, Markdown) and "Add the notes to knowledge" use the same text. */
export function minutesDoc(meeting: MeetingReview, projectName: string | null): TemplateDoc {
  const date = meeting.received_at.slice(0, 10);
  return {
    title: 'Meeting minutes', subtitle: [meeting.title, projectName].filter(Boolean).join(' · '),
    sections: [
      sec('Meeting', fields(['Title', meeting.title], ['Date', date], ['Project', projectName ?? ''])),
      sec('Summary', p(meeting.summary ?? '')),
      sec('Decisions', list(meeting.decisions.map((d) => d.text))),
      sec('Action items', table(['Action', 'Owner', 'Due'], meeting.action_items.map((a) => [a.text, a.owner ?? '', a.due ?? '']), 'No action items.')),
      sec('Open questions', list(meeting.open_questions.map((q) => q.text))),
      sec('Important notes', list(meeting.important_notes.map((n) => n.text))),
    ],
  };
}
