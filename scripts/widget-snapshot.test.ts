// node --experimental-strip-types scripts/widget-snapshot.test.ts            checks the snapshot builder against the committed sample
// node --experimental-strip-types scripts/widget-snapshot.test.ts --write    rewrites scripts/fixtures/widget-snapshot.sample.json (what Task 1's Swift Codable and previews read)
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildWidgetSnapshot, dueLabel, MAX_ITEMS, MAX_PROJECTS, MAX_SNAPSHOT_BYTES, WEEK_DAYS, type WidgetInput } from '../shared/widget-snapshot.ts';
import type { Milestone, Project, Task } from '../shared/types.ts';

const TZ = 'America/Toronto';
const NOW = new Date('2026-10-21T15:00:00Z'); // Wed 21 Oct 2026, 11:00 in Toronto
const task = (id: string, o: Partial<Task> = {}): Task => ({
  id, project_id: null, parent_id: null, title: `Task ${id}`, notes: 'SECRET NOTE', kind: 'personal', horizon: 'short', status: 'new', priority: 0, start_at: null, due_at: null, done_at: null,
  estimate_minutes: null, waiting_on: 'SECRET PERSON', waiting_since: null, nudge_every_days: null, recur: null, source_app: 'manual', source_kind: null, source_ref: null, source_url: null,
  blocked_by: null, checklist: '[{"id":"c","text":"SECRET ITEM","done":false}]', sort_in_column: 0, tags: '[]', enc_v: 0, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', deleted_at: null, ...o });
const project = (id: string, o: Partial<Project> = {}): Project => ({
  id, name: `Project ${id}`, kind: 'personal', status: 'active', rag: 'green', rag_reason: null, sponsor: 'SECRET SPONSOR', objectives: null, scope_in: null, scope_out: null, success_criteria: null, phase: null,
  start_at: null, end_at: null, budget_planned: null, budget_spent: null, data_boundary: 'cloud', colour: null, sort: 0, enc_v: 0, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', deleted_at: null, ...o });
const ms = (id: string, project_id: string, o: Partial<Milestone> = {}): Milestone => ({ id, project_id, name: `Milestone ${id}`, due_at: null, done_at: null, gate: 0, sort: 0, enc_v: 0, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', deleted_at: null, ...o });
const build = (o: Partial<WidgetInput> = {}) => buildWidgetSnapshot({ tasks: [], projects: [], milestones: [], tz: TZ, hide_work_on_lock: true, now: NOW, ...o });

// Labels: the app's own words; "late" ones count back from today.
assert.equal(dueLabel(null, '2026-10-21'), '');
assert.equal(dueLabel('2026-10-21', '2026-10-21'), 'Today');
assert.equal(dueLabel('2026-10-22', '2026-10-21'), 'Tomorrow');
assert.equal(dueLabel('2026-10-20', '2026-10-21'), 'Yesterday');
assert.equal(dueLabel('2026-10-18', '2026-10-21'), '3d late');
assert.equal(dueLabel('2026-10-23', '2026-10-21'), 'Fri');
assert.equal(dueLabel('2026-10-28', '2026-10-21'), 'Oct 28', 'a week or more away is a date');

// Empty: a valid snapshot with nothing in it.
const empty = build();
assert.equal(empty.v, 1);
assert.deepEqual(empty.today, { due: 0, late: 0, done: 0, total: 0, next: null });
assert.deepEqual([empty.items, empty.projects, empty.blocked], [[], [], 0]);
assert.equal(empty.week.length, WEEK_DAYS);
assert.equal(empty.tz, TZ);
assert.equal(empty.at, NOW.toISOString());

// Today: due today or earlier, open, top-level, live, not blocked; blocked counted apart; done today counted from the zone's day.
const day = build({ tasks: [
  task('late', { due_at: '2026-10-19' }), task('now', { due_at: '2026-10-21', horizon: 'medium' }), task('soon', { due_at: '2026-10-23' }), task('none'),
  task('blk', { due_at: '2026-10-21', blocked_by: '["now"]' }), task('sub', { due_at: '2026-10-21', parent_id: 'now' }), task('gone', { due_at: '2026-10-21', deleted_at: '2026-10-20T00:00:00Z' }),
  task('d1', { status: 'done', due_at: '2026-10-21', done_at: '2026-10-21T04:00:00Z' }),   // 00:00 EDT Wed: today
  task('d2', { status: 'done', due_at: '2026-10-20', done_at: '2026-10-21T03:59:00Z' }),   // 23:59 EDT Tue: yesterday, in the user's zone
] });
assert.deepEqual({ ...day.today, next: undefined }, { due: 2, late: 1, done: 1, total: 3, next: undefined });
assert.equal(day.today.next?.id, 'now', 'next prefers what is due today over what is late');
assert.equal(day.blocked, 1, 'the blocked task is counted apart');
assert.deepEqual(day.items.map((x) => x.id), ['late', 'now', 'soon', 'none'], 'by due date, undated last; no blocked, subtask, trashed or done');
assert.deepEqual(day.items.map((x) => [x.due_label, x.late]), [['2d late', true], ['Today', false], ['Fri', false], ['', false]]);
assert.deepEqual(day.horizons.medium.map((x) => x.id), ['now']);
assert.deepEqual(day.horizons.short.map((x) => x.id), ['late', 'soon', 'none']);
assert.equal(build({ tasks: [task('only', { due_at: '2026-10-19' })] }).today.next?.id, 'only', 'with only late tasks, next is the oldest late one');

// Weeks run Monday to Sunday of the zone's current week; counts by horizon, blocked left out.
assert.deepEqual(day.week.map((w) => w.day), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
assert.deepEqual(day.week[0], { day: '2026-10-19', short: 1, medium: 0, long: 0 });
assert.deepEqual(day.week[2], { day: '2026-10-21', short: 0, medium: 1, long: 0 });
assert.deepEqual(day.week[4], { day: '2026-10-23', short: 1, medium: 0, long: 0 });
// 00:30 UTC on Thursday is still Wednesday evening in Toronto: the zone decides which day "today" is.
const late = build({ now: new Date('2026-10-22T00:30:00Z'), tasks: [task('x', { due_at: '2026-10-21' })] });
assert.equal(late.today.next?.due_label, 'Today');
assert.equal(late.week.find((w) => w.day === '2026-10-21')!.short, 1);

// Offline-only: counted, never named. Items, project name and milestone name all lose their titles; work is flagged apart.
const off = project('off', { kind: 'work', data_boundary: 'offline', name: 'OFFLINE NAME' });
const wk = project('wk', { kind: 'work', name: 'Work cloud' });
const priv = build({
  projects: [off, wk, project('home')],
  milestones: [ms('m1', 'off', { name: 'OFFLINE MILESTONE', due_at: '2026-10-25' }), ms('m2', 'wk', { name: 'Go live', due_at: '2026-10-16' })],
  tasks: [task('o1', { project_id: 'off', kind: 'work', title: 'OFFLINE TITLE', due_at: '2026-10-21' }), task('w1', { project_id: 'wk', kind: 'work', title: 'Work title', due_at: '2026-10-21' }), task('p1', { title: 'Personal title', due_at: '2026-10-21' })],
});
const byId = Object.fromEntries(priv.items.map((x) => [x.id, x]));
assert.deepEqual([byId.o1.title, byId.o1.offline, byId.o1.work], [null, true, true]);
assert.deepEqual([byId.w1.title, byId.w1.offline, byId.w1.work], ['Work title', false, true]);
assert.deepEqual([byId.p1.title, byId.p1.offline, byId.p1.work], ['Personal title', false, false]);
assert.equal(priv.today.due, 3, 'the Offline task is still counted');
assert.ok(!JSON.stringify(priv).includes('OFFLINE'), 'no Offline-only title or name anywhere in the snapshot');
const pj = Object.fromEntries(priv.projects.map((p) => [p.id, p]));
assert.deepEqual([pj.off.name, pj.off.next_milestone, pj.off.offline, pj.off.work], [null, { name: null, late_days: 0 }, true, true]);
assert.deepEqual([pj.wk.name, pj.wk.next_milestone, pj.wk.work], ['Work cloud', { name: 'Go live', late_days: 5 }, true]);
// No notes, checklists or people leave the device, whatever the rows hold.
assert.ok(!/SECRET/.test(JSON.stringify(priv)));

// hide_work comes from the setting.
assert.deepEqual(build({ hide_work_on_lock: false }).lock, { hide_work: false });
assert.deepEqual(build().lock, { hide_work: true });

// Projects: % done over the live top-level tasks, overdue, risks and slip only with what the device holds (null otherwise).
const raidRow = (o: object) => ({ type: 'risk', status: 'open', probability: 5, impact: 4, deleted_at: null, ...o });
const pr = build({
  projects: [project('a', { rag: 'amber', start_at: '2026-10-01', end_at: '2026-12-01' }), project('closed', { status: 'closed' }), project('trash', { deleted_at: '2026-10-02T00:00:00Z' })],
  milestones: [ms('far', 'a', { due_at: '2026-11-30' }), ms('near', 'a', { due_at: '2026-10-14' }), ms('done', 'a', { due_at: '2026-10-01', done_at: '2026-10-02T00:00:00Z' }), ms('nodate', 'a')],
  tasks: [task('t1', { project_id: 'a', status: 'done', done_at: '2026-10-10T12:00:00Z' }), task('t2', { project_id: 'a', due_at: '2026-10-10' }), task('t3', { project_id: 'a' }), task('t4', { project_id: 'a', parent_id: 't3' }), task('t5', { project_id: 'a', status: 'done', done_at: '2026-10-11T12:00:00Z', deleted_at: '2026-10-12T00:00:00Z' })],
  raid: { a: [raidRow({}), raidRow({ probability: 1, impact: 1 }), raidRow({ status: 'closed' })] },
  baselines: { a: { tasks: [{ id: 't2', start_at: null, due_at: '2026-10-05' }], milestones: [{ id: 'near', due_at: '2026-10-07' }], project: { start_at: null, end_at: null } } },
});
assert.deepEqual(pr.projects.map((p) => p.id), ['a'], 'closed and trashed projects are left out');
assert.deepEqual(pr.projects[0], { id: 'a', name: 'Project a', rag: 'amber', pct: 33, next_milestone: { name: 'Milestone near', late_days: 7 }, slip_days: 7, high_risks: 1, overdue: 1, work: false, offline: false });
const bare = build({ projects: [project('a')], tasks: [task('t', { project_id: 'a' })] }).projects[0];
assert.deepEqual([bare.slip_days, bare.high_risks, bare.pct, bare.next_milestone], [null, null, 0, null]);

// Caps: 20 items, 10 projects, 7 days; and the file stays far under what the bridge accepts, even with long titles.
const many = build({
  projects: Array.from({ length: 14 }, (_, n) => project(`p${n}`, { sort: n })),
  tasks: Array.from({ length: 300 }, (_, n) => task(`t${String(n).padStart(3, '0')}`, { title: 'x'.repeat(500), due_at: '2026-10-2' + (n % 8), horizon: (['short', 'medium', 'long'] as const)[n % 3], project_id: `p${n % 14}` })),
});
assert.equal(many.items.length, MAX_ITEMS);
assert.equal(many.projects.length, MAX_PROJECTS);
assert.deepEqual(many.projects.map((p) => p.id), Array.from({ length: 10 }, (_, n) => `p${n}`), 'in the portfolio order');
assert.equal(many.week.length, 7);
assert.ok(many.horizons.short.length <= 5 && many.horizons.medium.length === 5 && many.horizons.long.length === 5);
assert.ok(many.items.every((x) => x.title!.length === 120), 'titles are cut');
assert.ok(JSON.stringify(many).length < MAX_SNAPSHOT_BYTES / 2);

// The committed sample (Task 1's Codable and previews) is exactly what this builder gives for this seed.
const sample = build({
  projects: [project('p-branch', { name: 'Branch network refresh', kind: 'work', rag: 'amber', start_at: '2026-09-01', end_at: '2026-12-15' }), project('p-vendor', { name: 'Vendor onboarding', kind: 'work', rag: 'green', sort: 1 }),
    project('p-secret', { name: 'Client engagement', kind: 'work', rag: 'red', data_boundary: 'offline', sort: 2 }), project('p-home', { name: 'Home projects', rag: 'none', sort: 3 })],
  milestones: [ms('m-pilot', 'p-branch', { name: 'Pilot site live', due_at: '2026-10-16' }), ms('m-uat', 'p-vendor', { name: 'UAT sign-off', due_at: '2026-11-06' }), ms('m-secret', 'p-secret', { name: 'Kickoff', due_at: '2026-10-30' })],
  tasks: [
    task('t-vendor', { title: 'Call the vendor about the test env', due_at: '2026-10-21', project_id: 'p-branch', kind: 'work' }),
    task('t-status', { title: 'Send the status report', due_at: '2026-10-20', project_id: 'p-branch', kind: 'work', horizon: 'medium' }),
    task('t-sow', { title: 'Review the SOW', due_at: '2026-10-23', project_id: 'p-vendor', kind: 'work' }),
    task('t-cab', { title: 'Book the CAB slot', due_at: '2026-10-26', project_id: 'p-vendor', kind: 'work', horizon: 'medium' }),
    task('t-secret', { title: 'Prepare the client deck', due_at: '2026-10-21', project_id: 'p-secret', kind: 'work', sort_in_column: 1 }),
    task('t-cutover', { title: 'Wave 1 cutover', due_at: '2026-10-28', project_id: 'p-branch', kind: 'work', horizon: 'long', blocked_by: '["t-vendor"]' }),
    task('t-dentist', { title: 'Book the dentist', due_at: '2026-10-22', project_id: 'p-home', horizon: 'long' }),
    task('t-groceries', { title: 'Order groceries', status: 'done', done_at: '2026-10-21T13:00:00Z', due_at: '2026-10-21' }),
    task('t-done-a', { title: 'Done a', status: 'done', done_at: '2026-10-14T13:00:00Z', project_id: 'p-branch', kind: 'work' }),
    task('t-done-b', { title: 'Done b', status: 'done', done_at: '2026-10-15T13:00:00Z', project_id: 'p-branch', kind: 'work' }),
  ],
  raid: { 'p-branch': [raidRow({}), raidRow({}), raidRow({ probability: 4, impact: 4 })] },
  baselines: { 'p-branch': { tasks: [], milestones: [{ id: 'm-pilot', due_at: '2026-10-09' }], project: { start_at: null, end_at: null } } },
});
const path = new URL('./fixtures/widget-snapshot.sample.json', import.meta.url);
const text = JSON.stringify(sample, null, 2) + '\n';
if (process.argv.includes('--write')) writeFileSync(path, text);
assert.equal(readFileSync(path, 'utf8'), text, 'the sample fixture is stale: node --experimental-strip-types scripts/widget-snapshot.test.ts --write');
console.log('widget-snapshot: all checks passed');
