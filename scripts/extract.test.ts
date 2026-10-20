import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { docxText, docxPlaceholders, pdfText, docText, xlsxText, pptxText, csvText, attachmentText, CHAT_MAX } from '../worker/lib/extract.ts';

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
assert.equal(await docText('png', strToU8('x')), '');

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

// Excel: shared strings, inline strings, booleans, errors, formulas with cached values, sheets in workbook order (not file order).
const X = (b: string) => `<?xml version="1.0"?><worksheet xmlns="x"><sheetData>${b}</sheetData></worksheet>`;
const sheet1 = X('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="2"/><c r="C1"><v>42</v></c></row><row r="2"><c r="A2"><v>10</v></c><c r="B2"><f>SUM(A2:A2)*2</f><v>20</v></c><c r="C2" t="str"><f>"a"&amp;"b"</f><v>ab</v></c></row>');
const sheet2 = X('<row r="1"><c r="A1" t="inlineStr"><is><t xml:space="preserve">inline &amp; sure</t></is></c><c r="B1" t="b"><v>1</v></c><c r="C1" t="e"><v>#DIV/0!</v></c><c r="D1"><f>NA()</f></c></row>');
const book = zipSync({
  'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Budget" sheetId="1" r:id="rId2"/><sheet name="Q1 Plan" sheetId="2" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="/xl/worksheets/sheet2.xml"/></Relationships>'),
  'xl/sharedStrings.xml': strToU8('<sst><si><t>Total</t></si><si><r><t>x</t></r><rPh sb="0"><t>PHONETIC</t></rPh></si></sst>'),
  'xl/worksheets/sheet1.xml': strToU8(sheet1), 'xl/worksheets/sheet2.xml': strToU8(sheet2),
});
const xl = xlsxText(book);
assert.deepEqual(xl.text.split('\n'), [
  "Budget!A1: inline & sure", 'Budget!B1: TRUE', 'Budget!C1: #DIV/0!', 'Budget!D1: =NA()',
  "'Q1 Plan'!A1: Total", "'Q1 Plan'!C1: 42", "'Q1 Plan'!A2: 10", "'Q1 Plan'!B2: =SUM(A2:A2)*2 → 20", "'Q1 Plan'!C2: =\"a\"&\"b\" → ab",
], 'sheets in workbook order, formulas with cached values');
assert.equal(xl.truncated, false);
assert.equal(xlsxText(zipSync({ 'xl/workbook.xml': strToU8('<workbook/>') })).text, '', 'a workbook with no sheets is empty');
assert.throws(() => xlsxText(new Uint8Array([1, 2, 3])), 'not a zip');
assert.throws(() => xlsxText(zip({ 'xl/sharedStrings.xml': zeros(11) })), 'one part over 10 MB');
const bigBook = (cells: string, extra: Record<string, Uint8Array> = {}) => zip({
  'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml': strToU8(X(cells)), ...extra,
});
const many20k = Array.from({ length: 20_001 }, () => '<c r="A1"><v>1</v></c>').join(''); // short lines: the cell cap is reached before the character cap
const cut1 = xlsxText(bigBook(many20k));
assert.equal(cut1.truncated, true);
assert.equal(cut1.text.split('\n').length, 20_001, '20,000 cells and the closing line');
assert.match(cut1.text.split('\n').pop()!, /^\[Cut: only the first 20,000 cells/);
assert.equal(xlsxText(bigBook(many20k.slice(0, many20k.lastIndexOf('<c ')))).truncated, false, 'exactly 20,000 cells is not cut');
const wide = Array.from({ length: 300 }, (_, i) => `<c r="A${i + 1}" t="inlineStr"><is><t>${'w'.repeat(1000)}</t></is></c>`).join('');
const cut2 = xlsxText(bigBook(wide));
assert.ok(cut2.truncated && cut2.text.length < 200_300 && /\[Cut: /.test(cut2.text), '200,000 characters');
assert.deepEqual(xlsxText(bigBook('<c r="A1"><v>1</v></c>', Object.fromEntries(Array.from({ length: 190 }, (_, i) => [`xl/worksheets/s${i}.xml`, strToU8(X(''))])))).text, 'S!A1: 1', 'under 200 parts is fine');
assert.throws(() => xlsxText(bigBook('', Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`xl/worksheets/s${i}.xml`, strToU8(X(''))])))), 'more than 200 parts');
const tx = performance.now();
xlsxText(bigBook('<c r="A1" '.repeat(300_000) + '<rPh'.repeat(10)));
assert.ok(performance.now() - tx < 500, 'unclosed cells are linear');

// PowerPoint: presentation order (not file order), runs joined, line breaks, notes from the body placeholder only.
const sl = (t: string) => `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p><a:p><a:r><a:t>second</a:t></a:r><a:br/><a:r><a:t>line</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const notes = '<p:notes><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Say &amp; pause</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld><a:t>9</a:t></a:fld></a:p></p:txBody></p:sp></p:notes>';
const deck = zipSync({
  'ppt/presentation.xml': strToU8('<p:presentation xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId5"/><p:sldId id="2" r:id="rId4"/></p:sldIdLst></p:presentation>'),
  'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="rId4" Target="slides/slide1.xml"/><Relationship Id="rId5" Target="slides/slide2.xml"/></Relationships>'),
  'ppt/slides/slide1.xml': strToU8(sl('Alpha')), 'ppt/slides/slide2.xml': strToU8(sl('Bravo')),
  'ppt/slides/_rels/slide2.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Target="../notesSlides/notesSlide1.xml"/></Relationships>'),
  'ppt/notesSlides/notesSlide1.xml': strToU8(notes),
});
assert.equal(pptxText(deck), 'Slide 1: Bravo\nsecond\nline\nNotes: Say & pause\n\nSlide 2: Alpha\nsecond\nline', 'slides in presentation order, with notes');
assert.equal(pptxText(zipSync({ 'ppt/slides/slide10.xml': strToU8(sl('Ten')), 'ppt/slides/slide2.xml': strToU8(sl('Two')) })).split('\n\n').map((x) => x.split('\n')[0]).join('|'), 'Slide 1: Two|Slide 2: Ten', 'with no slide list, by file number');
assert.throws(() => pptxText(new Uint8Array([1, 2])), 'not a zip');

// CSV, and the 60,000-character cap with its closing line.
assert.equal(csvText(strToU8('a,b\n1,"é ✓"\n')), 'a,b\n1,"é ✓"\n');
assert.equal(csvText(strToU8('x'.repeat(70_000))).length, 60_000);
assert.deepEqual(await attachmentText('csv', strToU8('a,b')), { text: 'a,b', truncated: false });
const capped = await attachmentText('txt', strToU8('x'.repeat(CHAT_MAX + 1)));
assert.ok(capped.truncated && capped.text.startsWith('x'.repeat(CHAT_MAX)) && /\[Cut: only the first 60,000 characters/.test(capped.text));
assert.deepEqual(await attachmentText('xlsx', book), xl);
assert.match((await attachmentText('pptx', deck)).text, /^Slide 1: Bravo/);
assert.deepEqual(await attachmentText('png', strToU8('x')), { text: '', truncated: false });
console.log('extract.test ok');
