import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain ESM script
import { buildLibrary } from './library-build.mjs';

const real = buildLibrary('worker/library') as { pages: { slug: string; body: string }[]; errors: string[] };
assert.deepEqual(real.errors, [], 'the shipped library builds clean');
assert.ok(real.pages.length > 0 && real.pages.every((p) => p.body.length > 0));

const long = 'x'.repeat(320);
const dir = mkdtempSync(join(tmpdir(), 'lib-'));
mkdirSync(join(dir, 'a')); mkdirSync(join(dir, 'b'));
const page = (title: string, section: string, body: string) => `---\ntitle: ${title}\nsection: ${section}\n---\n${body}`;
writeFileSync(join(dir, 'a', 'same.md'), page('One', 'Frameworks', `${long} [[nowhere]]`));
writeFileSync(join(dir, 'b', 'same.md'), page('Two', 'Frameworks', long));
writeFileSync(join(dir, 'b', 'odd.md'), page('Odd', 'Nonsense', 'short'));
const bad = (buildLibrary(dir) as { errors: string[] }).errors.join('\n');
assert.match(bad, /duplicate slug "same"/);
assert.match(bad, /\[\[nowhere\]\] names no page/);
assert.match(bad, /unknown section "Nonsense"/);
assert.match(bad, /under 300 characters/);
console.log('library: ok');
