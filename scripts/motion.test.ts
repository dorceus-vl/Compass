import assert from 'node:assert/strict';
import { lensFactor, lensOffset, angleTo, unwrap, springStep, hashIndex, nearestTurn } from '../web/src/motion.ts';
import { taskColor, projectColor, PROJECT_SWATCHES, HORIZON_COLOR } from '../web/src/ui/colors.ts';

const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} !≈ ${b}`);

near(lensFactor(500, 500, 1000), 1);
near(lensFactor(900, 500, 1000), 0.04);
assert.equal(lensFactor(2000, 500, 1000), 0);
near(lensOffset(900, 500, 1000), 0.4);

assert.equal(angleTo(0, 0, 0, -10), 0);
assert.equal(angleTo(0, 0, 10, 0), 90);
assert.equal(angleTo(0, 0, 0, 10), 180);
assert.equal(angleTo(0, 0, -10, 0), -90);

assert.equal(unwrap(350, 10), 370);
assert.equal(unwrap(10, 350), -10);
assert.equal(unwrap(0, 180), 180);

let p = 0, v = 0, max = 0;
for (let i = 0; i < 200; i++) { [p, v] = springStep(p, v, 100); max = Math.max(max, p); }
near(p, 100, 0.01);
assert.ok(max <= 130, `overshoot ${max}`);

assert.equal(hashIndex('abc', 6), hashIndex('abc', 6));
const seen = new Set<number>();
for (let i = 0; i < 1000; i++) {
  const id = Math.random().toString(36).slice(2) + i;
  const h = hashIndex(id, 6);
  assert.ok(Number.isInteger(h) && h >= 0 && h < 6);
  seen.add(h);
}
assert.equal(seen.size, 6);

assert.equal(PROJECT_SWATCHES.length, 6);
assert.deepEqual(Object.keys(HORIZON_COLOR), ['short', 'medium', 'long']);
const projects = [{ id: 'p1', colour: '#123456' }, { id: 'p2', colour: null }];
assert.equal(taskColor({ source_app: 'finance', project_id: 'p1' }, projects), 'var(--src-finance)');
assert.equal(taskColor({ source_app: 'manual', project_id: 'p1' }, projects), '#123456');
assert.equal(taskColor({ source_app: 'manual', project_id: null }, projects), 'var(--text-dim)');
assert.equal(taskColor({ source_app: 'manual', project_id: 'gone' }, projects), 'var(--text-dim)');
assert.ok(PROJECT_SWATCHES.includes(taskColor({ source_app: 'manual', project_id: 'p2' }, projects)));
assert.equal(projectColor({ id: 'p2', colour: null }), projectColor({ id: 'p2', colour: null }));
// ring: the turn that shows face `i` of 3, reached the short way from the current turn
assert.equal(nearestTurn(0, 0), 0);
assert.equal(nearestTurn(0, 1), 1);
assert.equal(nearestTurn(0, 2), -1, 'face 2 is one step back, not two forward');
assert.equal(nearestTurn(5, 0), 6, 'turn 5 shows face 2; face 0 is one step on');
assert.equal(nearestTurn(-4, 2), -4, 'already there (-4 shows face 2)');
assert.equal(nearestTurn(nearestTurn(7, 2), 2), nearestTurn(7, 2), 'idempotent');
console.log('motion ok');
