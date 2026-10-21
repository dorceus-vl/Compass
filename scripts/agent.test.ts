import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_SCOPES, allowed, shared, parseNewTask, overLimit } from '../worker/lib/agent.ts';

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

// v2.1: Kelly's task shape does not grow (blocked_by and checklist stay on the device). The type and the object agentTask() builds list the same seven keys.
const src = readFileSync(new URL('../worker/routes/agent.ts', import.meta.url), 'utf8');
const KEYS = ['id', 'title', 'due_at', 'horizon', 'status', 'project', 'priority'];
assert.deepEqual([...(/type AgentTask = \{([^}]*)\}/.exec(src)![1]).matchAll(/(\w+):/g)].map((m) => m[1]), KEYS);
const built = /return \{ (id: t\.id[^\n]*) \};/.exec(src)![1];
assert.deepEqual([...built.matchAll(/(?:^|, )(\w+): /g)].map((m) => m[1]), KEYS);
assert.ok(!/blocked_by|checklist/.test(src), 'the agent route never mentions the v2.1 task columns');

console.log('agent: ok');
