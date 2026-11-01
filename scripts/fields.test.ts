// node --experimental-strip-types scripts/fields.test.ts
import assert from 'node:assert/strict';
import { parseFieldDefs, parseFieldValues, fieldValue, setFieldValue, type FieldDef } from '../shared/fields.ts';

// definitions
assert.deepEqual(parseFieldDefs(null), [], 'none');
const defs: FieldDef[] = [{ id: 'a', name: 'Cost', type: 'number' }, { id: 'b', name: 'Vendor', type: 'choice', options: ['Bell', 'Cisco'] }, { id: 'c', name: 'Go-live', type: 'date' }];
assert.deepEqual(parseFieldDefs(JSON.stringify(defs)), defs, 'round trip from JSON text');
assert.deepEqual(parseFieldDefs([{ id: 'x', name: 'N', type: 'text', options: ['junk'] }]), [{ id: 'x', name: 'N', type: 'text' }], 'options dropped off a non-choice');
assert.equal(parseFieldDefs([{ id: 'a', name: 'A', type: 'text' }, { id: 'a', name: 'B', type: 'text' }]), null, 'repeated id');
assert.equal(parseFieldDefs([{ id: 'a', name: ' ', type: 'text' }]), null, 'blank name');
assert.equal(parseFieldDefs([{ id: 'a', name: 'A', type: 'colour' }]), null, 'unknown type');
assert.equal(parseFieldDefs([{ id: 'a', name: 'A', type: 'choice', options: [] }]), null, 'choice needs options');
assert.equal(parseFieldDefs(Array.from({ length: 21 }, (_, i) => ({ id: `f${i}`, name: 'n', type: 'text' }))), null, 'over 20');
assert.equal(parseFieldDefs('{bad'), null, 'bad JSON');

// values
assert.deepEqual(parseFieldValues(''), {}, 'none');
assert.deepEqual(parseFieldValues('{"a":3,"b":"Bell"}'), { a: 3, b: 'Bell' });
assert.equal(parseFieldValues('[1]'), null, 'array refused');
assert.equal(parseFieldValues({ a: '' }), null, 'empty string refused (cleared values are removed)');
assert.equal(parseFieldValues({ a: true }), null, 'boolean refused');
assert.equal(parseFieldValues({ a: 'x'.repeat(501) }), null, 'over 500');

// typed-in values
assert.equal(fieldValue(defs[0], ' 12.5 '), 12.5);
assert.equal(fieldValue(defs[0], 'abc'), null, 'not a number');
assert.equal(fieldValue(defs[0], ''), undefined, 'empty clears');
assert.equal(fieldValue(defs[1], 'Bell'), 'Bell');
assert.equal(fieldValue(defs[1], 'Juniper'), null, 'not an option');
assert.equal(fieldValue(defs[2], '2026-11-02'), '2026-11-02');
assert.equal(fieldValue(defs[2], 'Nov 2'), null, 'not a date');

// setting one keeps only the project's current fields; empty is null
assert.equal(setFieldValue(defs, '{"a":1,"old":"x"}', 'b', 'Cisco'), '{"a":1,"b":"Cisco"}', 'other project and removed fields dropped');
assert.equal(setFieldValue(defs, '{"a":1}', 'a', undefined), null, 'last value cleared');
assert.equal(setFieldValue(defs, 'garbage', 'c', '2026-11-02'), '{"c":"2026-11-02"}', 'a bad stored value starts afresh');
console.log('fields ok');
