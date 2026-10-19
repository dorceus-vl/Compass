// node --experimental-strip-types scripts/validate.test.ts
import assert from 'node:assert/strict';
import { httpsUrl } from '../worker/lib/validate.ts';

const c = httpsUrl();
assert.deepEqual(c('https://example.com/a?b=1', 'source_url'), { value: 'https://example.com/a?b=1' });
assert.deepEqual(c('', 'source_url'), { value: null });
assert.ok('error' in c('http://example.com', 'source_url'));
assert.ok('error' in c('javascript:alert(1)', 'source_url'));
assert.ok('error' in c('not a url', 'source_url'));
console.log('validate: ok');
