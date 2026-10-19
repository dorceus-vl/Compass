import assert from 'node:assert/strict';
import { buildIndex, search, snippet, tokens } from '../shared/search.ts';

const docs = [
  { id: 'risk', title: 'Risk management', section: 'Risk and change', body: 'Identify risks, assess probability and impact, plan responses.' },
  { id: 'evm', title: 'Earned value', section: 'Reporting', body: 'Schedule performance index. Cost performance index compares earned value to actual cost. Risk is not covered here.' },
  { id: 'gloss', title: 'Glossaire', section: 'Reference', body: 'Échéancier: schedule. Risque: risk.' },
];
const ix = buildIndex(docs);
assert.deepEqual(tokens('Managing the risks'), ['managing', 'risk'], 'stop words dropped, plural s stripped');
assert.equal(search(ix, 'risk')[0].doc.id, 'risk', 'title outweighs body');
assert.equal(search(ix, 'echeancier')[0].doc.id, 'gloss', 'accents folded');
assert.equal(search(ix, 'ÉCHÉANCIER')[0].doc.id, 'gloss', 'case and accents folded in the query');
assert.equal(search(ix, 'earn')[0].doc.id, 'evm', 'the last word matches as a prefix');
assert.deepEqual(search(ix, 'the of'), [], 'stop words only');
assert.deepEqual(search(ix, ''), []);
assert.equal(search(ix, 'performance index', 1).length, 1, 'limit');
assert.equal(snippet(docs[1].body, 'cost'), 'Cost performance index compares earned value to actual cost.');
console.log('search: ok');
