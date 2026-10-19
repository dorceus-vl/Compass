import assert from 'node:assert/strict';
import { parseMarkdown, parseInline } from '../web/src/md.ts';

assert.deepEqual(parseInline('**Bold** and *it* `x`'), [{ t: 'b', c: [{ t: 'text', v: 'Bold' }] }, { t: 'text', v: ' and ' }, { t: 'i', c: [{ t: 'text', v: 'it' }] }, { t: 'text', v: ' ' }, { t: 'code', v: 'x' }]);
assert.deepEqual(parseInline('[site](https://pmi.org)'), [{ t: 'link', href: 'https://pmi.org', c: [{ t: 'text', v: 'site' }] }]);
assert.deepEqual(parseInline('[bad](javascript:alert(1))'), [{ t: 'text', v: '[bad](javascript:alert(1))' }], 'only https links');
assert.deepEqual(parseInline('see [[risk-management]] and [[raid-log|the RAID log]]'), [{ t: 'text', v: 'see ' }, { t: 'page', slug: 'risk-management', label: 'risk-management' }, { t: 'text', v: ' and ' }, { t: 'page', slug: 'raid-log', label: 'the RAID log' }]);
assert.deepEqual(parseInline('<b>x</b>'), [{ t: 'text', v: '<b>x</b>' }], 'HTML stays text');
const doc = parseMarkdown('# Title\n\nPara one\nstill one.\n\n- a\n- b\n\n1. x\n2. y\n\n> quote\n\n```\ncode\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---');
assert.deepEqual(doc.map((b) => b.t), ['h', 'p', 'ul', 'ol', 'quote', 'code', 'table', 'hr']);
assert.deepEqual(doc[1], { t: 'p', c: [{ t: 'text', v: 'Para one still one.' }] }, 'soft line breaks join with a space');
assert.equal((doc[6] as { rows: unknown[][] }).rows.length, 1);
assert.deepEqual(parseMarkdown(''), []);
// extras: unmatched markers stay text, snake_case is not italic, a list may follow a paragraph without a blank line
assert.deepEqual(parseInline('2 * 3 and a_b_c'), [{ t: 'text', v: '2 * 3 and a_b_c' }]);
assert.deepEqual(parseInline('**open'), [{ t: 'text', v: '**open' }]);
assert.deepEqual(parseMarkdown('Intro:\n- a').map((b) => b.t), ['p', 'ul']);
console.log('md: ok');
