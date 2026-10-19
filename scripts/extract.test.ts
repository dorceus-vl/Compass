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
// Stored entries that overlap: 21 central-directory entries, all method 0, all at one local header, usize 0 and csize 9 MB; the file is 9 MB.
function overlapping(names: string[], csize: number): Uint8Array {
  const enc = new TextEncoder(), first = enc.encode(names[0]);
  const local = new Uint8Array(30 + first.length + csize), lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint32(18, csize, true); lv.setUint16(26, first.length, true); local.set(first, 30);
  const cds = names.map((n) => { const b = enc.encode(n), c = new Uint8Array(46 + b.length), v = new DataView(c.buffer);
    v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint32(20, csize, true); v.setUint16(28, b.length, true); v.setUint32(42, 0, true); c.set(b, 46); return c; });
  const cdLen = cds.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, names.length, true); ev.setUint16(10, names.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + cdLen + 22); out.set(local); let o = local.length; for (const c of cds) { out.set(c, o); o += c.length; } out.set(end, o);
  return out;
}
const bomb = overlapping(['word/document.xml', ...Array.from({ length: 20 }, (_, i) => `word/header${i + 1}.xml`)], 9 * 1024 * 1024);
assert.ok(bomb.length < 9.1 * 1024 * 1024);
assert.throws(() => docxPlaceholders(bomb), 'overlapping stored entries declaring usize 0');
assert.throws(() => docxText(overlapping(['word/document.xml', 'word/document.xml', 'word/document.xml'], 9 * 1024 * 1024)), 'duplicate document.xml entries are counted');
assert.deepEqual(docxPlaceholders(overlapping(['word/document.xml'], 100)), [], 'one small stored entry still reads');
const t0 = performance.now();
const open1 = zip({ 'word/document.xml': strToU8('<w:p '.repeat(200_000)) });
assert.equal(docxText(open1), '');
assert.deepEqual(docxPlaceholders(zip({ 'word/document.xml': strToU8('<w:p>{{'.repeat(100_000) + ' '.repeat(500_000)) })), []);
assert.ok(performance.now() - t0 < 200, `unclosed openers took ${performance.now() - t0} ms`);
console.log('extract.test ok');
