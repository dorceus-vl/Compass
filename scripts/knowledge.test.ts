// node --experimental-strip-types scripts/knowledge.test.ts
// Which documents a Knowledge collection may take (worker/lib/knowledge.ts): every scope and document pairing.
import assert from 'node:assert/strict';
import { compatible, needsStepUp } from '../worker/lib/knowledge.ts';

const d = (projectKind: 'work' | 'personal' | null, sealed = false) => ({ projectKind, sealed });
// work collection
assert.equal(compatible('work', d('work', true)), true, 'a work project file (sealed)');
assert.equal(compatible('work', d('work')), true, 'a work project file, whatever its flag');
assert.equal(compatible('work', d(null, true)), true, 'an unfiled file uploaded sealed for work');
assert.equal(compatible('work', d(null)), false, 'an unfiled plain file would sit in R2 unsealed');
assert.equal(compatible('work', d('personal')), false, 'a personal project file');
// personal collection
assert.equal(compatible('personal', d('personal')), true, 'a personal project file');
assert.equal(compatible('personal', d(null)), true, 'an unfiled plain file');
assert.equal(compatible('personal', d('work', true)), false, 'a work project file, never');
assert.equal(compatible('personal', d('work')), false, 'a work project file, whatever its flag');
assert.equal(compatible('personal', d(null, true)), false, 'a sealed unfiled file is work');
// the passkey: a work collection becoming Cloud AI, on create (from null) or from Locked; nothing else
assert.equal(needsStepUp('work', null, 'cloud'), true, 'created as Cloud AI');
assert.equal(needsStepUp('work', 'locked', 'cloud'), true, 'Locked -> Cloud AI');
assert.equal(needsStepUp('work', null, 'locked'), false, 'created Locked');
assert.equal(needsStepUp('work', 'cloud', 'locked'), false, 'Cloud AI -> Locked is the safer way');
assert.equal(needsStepUp('work', 'cloud', 'cloud'), false, 'no change');
assert.equal(needsStepUp('personal', null, 'cloud'), false, 'personal is always Cloud AI');
console.log('knowledge: ok');
