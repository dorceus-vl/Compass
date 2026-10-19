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
console.log('extract.test ok');
