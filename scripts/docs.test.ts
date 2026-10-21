import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { Document, Packer, Paragraph } from 'docx';
import { buildReportModel } from '../shared/report-model.ts';
import { BUILTINS } from '../web/src/docs/templates.ts';
import { minutesDoc } from '../shared/doc-model.ts';
import { toDocx } from '../web/src/docs/to-docx.ts';
import { toMarkdown } from '../shared/to-md.ts';
import { fillTemplate } from '../web/src/docs/fill.ts';
import { fixture } from './fixtures/report-input.ts';
import type { MeetingReview } from '../shared/types.ts';

const TZ = 'America/Toronto';
const model = buildReportModel(fixture, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', '2026-10-19T12:00:00Z', TZ);
const xml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']);
const text = (bytes: Uint8Array) => xml(bytes).replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replaceAll('&amp;', '&');

const meeting: MeetingReview = { id: 'mt1', recording_id: 'r1', url: null, title: 'Steering', summary: 'All good', decisions: [{ text: 'Go with A', at: '00:10' }],
  action_items: [{ text: 'Send plan', owner: 'Ann', due: '2026-10-30', at: '00:20' }], open_questions: [{ text: 'Who pays?', at: '00:30' }], important_notes: [{ text: 'Freeze in Dec', at: '00:40' }],
  project_id: 'p1', state: 'reviewed', received_at: '2026-10-15T14:00:00Z', reviewed_at: null };

assert.equal(BUILTINS.length, 8);
for (const b of BUILTINS) {
  const doc = b.make(model);
  const out = text(await toDocx(doc));
  assert.ok(out.includes('Cutover'), `${b.id}: project name in the document`);
  assert.match(b.guide, /^template-/);
  assert.ok(doc.sections.every((s) => s.heading && s.blocks.length), `${b.id}: every section has a heading and a block`);
  if (b.id === 'raid_log') assert.ok(out.includes('Router shortage | single source'), 'the score-20 risk is in the RAID log');
}
const minutes = text(await toDocx(minutesDoc(meeting, 'Cutover')));
assert.ok(minutes.includes('Cutover') && minutes.includes('Send plan') && minutes.includes('Who pays?'));

// Word file shape: Letter page, Calibri 11 pt.
const files = unzipSync(await toDocx(BUILTINS[4].make(model)));
assert.match(strFromU8(files['word/document.xml']), /w:pgSz w:w="12240" w:h="15840"/);
assert.match(strFromU8(files['word/styles.xml']), /Calibri/);

const status = BUILTINS.find((b) => b.id === 'status_report')!;
const md = toMarkdown(status.make(model));
assert.ok(md.startsWith('# Status report'));
assert.ok(md.includes('| Risk | P | I |'));
assert.ok(md.includes('| Router shortage \\| single source | 4 | 5 | 20 | Bob | Second quote |'), 'risk row present');
// v2.2: the status report carries the key numbers and the schedule against the baseline, in Markdown and in Word.
const withBl = buildReportModel({ ...fixture, baseline: { name: 'Plan v1', taken_at: '2026-09-10T15:00:00Z', snapshot: { tasks: [], milestones: [{ id: 'm2', due_at: '2026-10-05' }], project: { start_at: null, end_at: null } } } }, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', 'now', TZ);
const mdS = toMarkdown(status.make(withBl));
assert.ok(mdS.includes('## Key numbers') && mdS.includes('Overdue now') && mdS.includes('## Schedule vs baseline'));
assert.ok(mdS.includes('Against "Plan v1", saved 2026-09-10.') && mdS.includes('| Milestone | Baseline | Now | Days late |') && mdS.includes('| Pilot | 2026-10-05 | 2026-10-10 | 5 |'));
assert.ok(toMarkdown(status.make(model)).includes('No baseline saved.'));
const wordS = text(await toDocx(status.make(withBl)));
assert.ok(wordS.includes('Key numbers') && wordS.includes('Schedule vs baseline') && wordS.includes('Pilot'));
assert.ok(toMarkdown(minutesDoc(meeting, null)).includes('- Go with A'));

// Change request: by id, else the newest pending, else blank fields.
const cr = BUILTINS.find((b) => b.id === 'change_request')!;
const pick = (opts?: { changeId?: string }, m = model) => (cr.make(m, opts).sections[0].blocks[0] as { t: 'fields'; pairs: [string, string][] }).pairs.find(([k]) => k === 'Title')![1];
assert.equal(pick(), 'Add six sites');
assert.equal(pick({ changeId: 'c2' }), 'Move date');
assert.equal(pick(undefined, buildReportModel({ ...fixture, changes: [] }, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', 'now', TZ)), '');

// WBS: open tasks under the first milestone dated on or after them; the rest in "Other work".
const wbsOf = (m: typeof model) => BUILTINS.find((b) => b.id === 'wbs')!.make(m);
const lines = (d: ReturnType<typeof wbsOf>) => d.sections.map((x) => [x.heading, ...x.blocks.map((k) => (k.t === 'p' ? k.text : k.t === 'list' ? k.items.join('/') : ''))]);
assert.deepEqual(lines(wbsOf(model)), [['1. Design', 'No open tasks.'], ['2. Pilot', 'No open tasks.'], ['3. Wave 2', '3.1 Chase customs'], ['4. Wave 3', '4.1 Book window', '4.2 Await invoice']]);
const loose = { ...fixture, tasks: [...fixture.tasks, { ...fixture.tasks[3], id: 'tx', title: 'Undated chore', due_at: null }] };
assert.deepEqual(lines(wbsOf(buildReportModel(loose, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', 'now', TZ))).at(-1), ['Other work', 'Undated chore']);

// Fill a user's own template.
const tpl = new Uint8Array(await Packer.toArrayBuffer(new Document({ sections: [{ children: [
  new Paragraph('Project {{project.name}} is {{project.rag_label}}'), new Paragraph('{{#risks.rows}}- {{text}} ({{score}}){{/risks.rows}}'),
] }] })));
const filled = text(fillTemplate(tpl, model));
assert.ok(filled.includes('Project Cutover is Amber'));
assert.ok(filled.includes('- Router shortage | single source (20)') && filled.includes('- Landlord access (6)'));
const broken = new Uint8Array(await Packer.toArrayBuffer(new Document({ sections: [{ children: [new Paragraph('{{#risks.rows}}never closed')] }] })));
const log = console.log; console.log = () => {}; // docxtemplater prints the error it is about to throw
try { assert.throws(() => fillTemplate(broken, model), /^Error: Template problem: Unclosed loop/); } finally { console.log = log; }
// Tags reach own properties only (fix round 1): the prototype chain renders nothing.
const proto = new Uint8Array(await Packer.toArrayBuffer(new Document({ sections: [{ children: [new Paragraph('[{{constructor.name}}][{{__proto__.constructor.name}}][{{toString}}][{{risks.rows.length}}]')] }] })));
assert.ok(text(fillTemplate(proto, model)).includes('[][][][2]'), 'prototype properties are empty, own ones still work');
console.log('docs: ok');
