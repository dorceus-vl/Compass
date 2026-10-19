import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { docxText, docxPlaceholders, pdfText, docText } from '../worker/lib/extract.ts';

const w = (body: string) => `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;
const xml = w('<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:t>Hello {{proj</w:t></w:r><w:r><w:t>ect.name}} &amp; co</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>{{#risks.rows}}{{text}}{{/risks.rows}}</w:t></w:r></w:p>');
const headerXml = '<w:hdr xmlns:w="x"><w:p><w:r><w:t>{{ report.date }}</w:t></w:r></w:p></w:hdr>';
const docx = zipSync({ 'word/document.xml': strToU8(xml), 'word/header1.xml': strToU8(headerXml) });
assert.deepEqual(docxPlaceholders(docx), ['project.name', '#risks.rows', 'text', '/risks.rows', 'report.date']);
assert.equal(docxText(docx), 'Hello {{project.name}} & co\n\n{{#risks.rows}}{{text}}{{/risks.rows}}');
assert.equal(docxText(zipSync({ 'word/document.xml': strToU8(w('<w:p><w:r><w:t>a &lt;b&gt; &quot;c&quot; &apos;d&apos; &amp;amp;</w:t></w:r></w:p>')) })), `a <b> "c" 'd' &amp;`);
assert.equal(docxText(zipSync({ 'word/document.xml': strToU8(w('<w:p><w:r><w:t>' + 'x'.repeat(250000) + '</w:t></w:r></w:p>')) })).length, 200000);
assert.throws(() => docxText(new Uint8Array([1, 2, 3])), 'not a zip');

assert.match(await pdfText(readFileSync('scripts/fixtures/hello.pdf')), /Hello Compass/);
assert.equal(await docText('md', strToU8('# Hi ✓')), '# Hi ✓');
assert.equal(await docText('txt', strToU8('plain')), 'plain');
assert.equal(await docText('xlsx', strToU8('PK')), '');

// Zip bombs and quadratic scans: refused or fast.
const zeros = (mb: number) => new Uint8Array(mb * 1024 * 1024);
const zip = (files: Record<string, Uint8Array>) => zipSync(files, { level: 1 });
assert.throws(() => docxText(zip({ 'word/document.xml': zeros(11) })), 'one part over 10 MB');
const many: Record<string, Uint8Array> = { 'word/document.xml': strToU8(xml) };
for (let i = 1; i <= 15; i++) many[`word/header${i}.xml`] = zeros(2); // each small, 30 MB in all
assert.throws(() => docxPlaceholders(zip(many)), 'parts over 20 MB in all');
const headers: Record<string, Uint8Array> = { 'word/document.xml': strToU8(xml) };
for (let i = 1; i <= 21; i++) headers[`word/footer${i}.xml`] = strToU8('<w:ftr/>');
assert.throws(() => docxPlaceholders(zip(headers)), 'more than 20 header/footer parts');
delete headers['word/footer21.xml'];
assert.deepEqual(docxPlaceholders(zip(headers)).slice(0, 2), ['project.name', '#risks.rows'], '20 parts are fine');
const t0 = performance.now();
const open1 = zip({ 'word/document.xml': strToU8('<w:p '.repeat(200_000)) });
assert.equal(docxText(open1), '');
assert.deepEqual(docxPlaceholders(zip({ 'word/document.xml': strToU8('<w:p>{{'.repeat(100_000) + ' '.repeat(500_000)) })), []);
assert.ok(performance.now() - t0 < 200, `unclosed openers took ${performance.now() - t0} ms`);
console.log('extract.test ok');
