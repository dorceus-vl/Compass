import assert from 'node:assert/strict';
import { exportMarkdown } from '../web/src/docs/export-md.ts';
import type { ExportBundle } from '../shared/types.ts';

const at = '2026-10-19T12:00:00.000Z';
const base = { created_at: at, updated_at: at, deleted_at: null };
const b = {
  exported_at: at, version: 1, settings: {},
  projects: [
    { ...base, id: 'abc123-0000', name: 'Apollo: Launch!', kind: 'work', status: 'active', rag: 'amber', rag_reason: 'Vendor late', phase: 'Build', sponsor: 'Ann', objectives: 'Ship it', data_boundary: 'cloud' },
    { ...base, id: 'gone99-0000', name: 'Trashed project', kind: 'personal', status: 'active', rag: 'none', data_boundary: 'cloud', deleted_at: at },
  ],
  milestones: [{ ...base, id: 'm1', project_id: 'abc123-0000', name: 'Go live', due_at: '2026-11-01', done_at: null, gate: 1 }],
  tasks: [
    { ...base, id: 't1', project_id: 'abc123-0000', parent_id: null, title: 'Draft plan', status: 'progress', due_at: '2026-10-20', notes: 'line one\nline two' },
    { ...base, id: 't2', project_id: 'abc123-0000', parent_id: 't1', title: 'Outline', status: 'new' },
    { ...base, id: 't3', project_id: 'abc123-0000', parent_id: null, title: 'Kickoff', status: 'done', done_at: at },
    { ...base, id: 't4', project_id: null, parent_id: null, title: 'Buy milk', status: 'new' },
    { ...base, id: 't5', project_id: null, parent_id: null, title: 'Trashed task', status: 'new', deleted_at: at },
  ],
  raid_items: [{ ...base, id: 'r1', project_id: 'abc123-0000', type: 'risk', text: 'Vendor slips', probability: 4, impact: 5, status: 'open', owner: 'Bob' }],
  change_requests: [{ ...base, id: 'c1', project_id: 'abc123-0000', title: 'Add SSO', decision: 'approved', approver: 'Ann' }],
  decisions: [{ ...base, id: 'd1', project_id: 'abc123-0000', text: 'Use Postgres', decided_at: '2026-10-01' }],
  lessons: [{ ...base, id: 'l1', project_id: 'abc123-0000', text: 'Book vendors early' }],
} as unknown as ExportBundle;

const files = exportMarkdown(b);
assert.deepEqual(Object.keys(files).sort(), ['projects/apollo-launch-abc123.md', 'tasks-without-project.md']);
const p = files['projects/apollo-launch-abc123.md'];
assert.deepEqual(p.split('\n').filter((l) => /^#{1,3} /.test(l)), ['# Apollo: Launch!', '## Milestones', '## Tasks', '### Open', '### Done', '## RAID', '## Changes', '## Decisions', '## Lessons']);
assert.ok(p.includes('- [ ] ◆ Go live (due 2026-11-01)'));
assert.ok(p.includes('  - [ ] Outline') && p.includes('  > line two'), 'subtask nested, notes quoted');
assert.ok(files['tasks-without-project.md'].includes('Buy milk') && !JSON.stringify(files).includes('Trashed'));
console.log('export-md: ok');
