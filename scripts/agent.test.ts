import assert from 'node:assert/strict';
import { AGENT_SCOPES, allowed, shared, parseNewTask, overLimit, agentProject } from '../worker/lib/agent.ts';

// allowed: switched on and the scope listed.
assert.equal(allowed({ enabled: false, scopes: [...AGENT_SCOPES] }, 'compass:read.tasks'), false);
assert.equal(allowed({ enabled: true, scopes: [] }, 'compass:read.tasks'), false);
assert.equal(allowed({ enabled: true, scopes: ['compass:read.tasks'] }, 'compass:write.tasks'), false);
assert.equal(allowed({ enabled: true, scopes: ['compass:read.tasks'] }, 'compass:read.tasks'), true);

// A hand-edited row means off, never a throw.
assert.equal(allowed({ enabled: true } as never, 'compass:read.tasks'), false);
assert.equal(allowed({ enabled: true, scopes: 'compass:read.tasks' } as never, 'compass:read.tasks'), false);
assert.equal(allowed({ enabled: 'true', scopes: ['compass:read.tasks'] } as never, 'compass:read.tasks'), false);
assert.equal(allowed(undefined, 'compass:read.tasks'), false);

// shared: personal with no project, or a live cloud project.
const cloud = { data_boundary: 'cloud' as const, deleted_at: null };
assert.equal(shared({ kind: 'personal', project_id: null }, null), true);
assert.equal(shared({ kind: 'work', project_id: null }, null), false);
assert.equal(shared({ kind: 'work', project_id: 'p' }, { ...cloud, data_boundary: 'offline' }), false);
assert.equal(shared({ kind: 'work', project_id: 'p' }, cloud), true);
assert.equal(shared({ kind: 'personal', project_id: 'p' }, cloud), true);
assert.equal(shared({ kind: 'work', project_id: 'p' }, { ...cloud, deleted_at: '2026-10-01T00:00:00.000Z' }), false);
assert.equal(shared({ kind: 'personal', project_id: 'p' }, null), false); // its project is missing

// parseNewTask: trims, defaults, limits, real dates only.
assert.deepEqual(parseNewTask({ title: '  Call Ann ' }), { title: 'Call Ann', due_at: null, horizon: 'short', project_id: null, notes: null });
assert.deepEqual(parseNewTask({ title: 'x', due_at: '2026-02-28', horizon: 'long', project_id: 'p1', notes: ' hi ' }), { title: 'x', due_at: '2026-02-28', horizon: 'long', project_id: 'p1', notes: 'hi' });
assert.ok('error' in (parseNewTask(null) as object));
assert.ok('error' in (parseNewTask({ title: '   ' }) as object));
assert.ok('error' in (parseNewTask({ title: 'x'.repeat(121) }) as object));
assert.ok(!('error' in (parseNewTask({ title: 'x'.repeat(120) }) as object)));
assert.ok('error' in (parseNewTask({ title: 'x', due_at: '2026-02-30' }) as object));
assert.ok('error' in (parseNewTask({ title: 'x', due_at: '10/20/2026' }) as object));
assert.ok('error' in (parseNewTask({ title: 'x', horizon: 'someday' }) as object));
assert.ok('error' in (parseNewTask({ title: 'x', notes: 'n'.repeat(2001) }) as object));
assert.ok(!('error' in (parseNewTask({ title: 'x', notes: 'n'.repeat(2000) }) as object)));
assert.ok('error' in (parseNewTask({ title: 'x', project_id: 7 }) as object));

// overLimit: counts include the call being made.
assert.equal(overLimit(60, 0, false), null);
assert.equal(overLimit(61, 0, false), 'rate');
assert.equal(overLimit(10, 30, true), null);
assert.equal(overLimit(10, 31, true), 'writes');
assert.equal(overLimit(10, 99, false), null); // reads ignore the write cap
assert.equal(overLimit(61, 31, true), 'rate');

console.log('agent: ok');

// The projects shape is exactly seven keys: v2.4's program, forecast and currency never reach Kelly.
const proj = agentProject({ id: 'p', name: 'n', rag: 'green', rag_reason: null, pct_done: 50, next_milestone: null, open_risks: 1, program_id: 'g', budget_forecast: 10, currency: 'CAD', budget_planned: 5 } as never);
assert.deepEqual(Object.keys(proj).sort(), ['id', 'name', 'next_milestone', 'open_risks', 'pct_done', 'rag', 'rag_reason']);

// v2.5: the task shape Kelly gets is still exactly seven keys, and the agent routes never read time entries.
import { readFileSync } from 'node:fs';
const agentSrc = readFileSync(new URL('../worker/routes/agent.ts', import.meta.url), 'utf8');
const shape = /type AgentTask = \{([^}]*)\}/.exec(agentSrc)?.[1] ?? '';
assert.deepEqual(shape.split(';').map((f) => f.split(':')[0]!.trim()).filter(Boolean).sort(), ['due_at', 'horizon', 'id', 'priority', 'project', 'status', 'title']);
assert.ok(!/time_entries|\/time\b/.test(agentSrc + readFileSync(new URL('../worker/lib/agent.ts', import.meta.url), 'utf8')), 'Kelly never sees time entries');
assert.ok(!/goals|key_results|goal_links|goal_checkins|\/goals\b/.test(agentSrc + readFileSync(new URL('../worker/lib/agent.ts', import.meta.url), 'utf8')), 'Kelly never sees goals');
