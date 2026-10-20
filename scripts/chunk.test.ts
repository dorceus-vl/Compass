// node --experimental-strip-types scripts/chunk.test.ts
// The Knowledge chunker (worker/lib/chunk.ts, ruling KN3): sizes, overlap, locators for every kind, the 2,000 cap, empty input.
import assert from 'node:assert/strict';
import { chunk, TARGET, OVERLAP, MAX_CHUNKS } from '../worker/lib/chunk.ts';

const para = (n: number, ch = 'a') => `${ch}`.repeat(n);
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

// Empty and whitespace-only input has no passages; images have no text.
for (const kind of ['pdf', 'docx', 'xlsx', 'pptx', 'csv', 'md', 'txt', 'png', 'jpg'] as const) assert.deepEqual(chunk(kind === 'pdf' ? [] : '  \n\n ', kind), [], kind);
assert.deepEqual(chunk([' ', ''], 'pdf'), [], 'blank pages');
assert.deepEqual(chunk('text', 'png'), []);

// A short text is one passage; text kinds are `part N`.
assert.deepEqual(chunk('One.\n\nTwo.', 'txt'), [{ locator: 'part 1', text: 'One.\n\nTwo.' }]);

// Sizes: about 3,200 characters, never more; cut at paragraph boundaries; 200 characters of overlap taken from the previous passage's end.
const paras = Array.from({ length: 60 }, (_, i) => `P${i} ${words(60)}`).join('\n\n'); // ~ 60 paragraphs of ~300 chars
const ps = chunk(paras, 'txt');
assert.ok(ps.length >= 5 && ps.length <= 9, `count ${ps.length}`);
for (const [i, p] of ps.entries()) {
  assert.ok(p.text.length <= TARGET, `passage ${i} is ${p.text.length}`);
  assert.equal(p.locator, `part ${i + 1}`);
  if (i < ps.length - 1) assert.ok(p.text.length > TARGET - 700, `passage ${i} is filled (${p.text.length})`);
}
for (let i = 1; i < ps.length; i++) {
  const tail = ps[i - 1].text.slice(-OVERLAP + 40); // the overlap is the previous end, begun at a word
  assert.ok(ps[i].text.slice(0, OVERLAP + 10).includes(tail), `passage ${i} starts with the end of passage ${i - 1}`);
}
// Every paragraph is somewhere in the output.
for (let i = 0; i < 60; i++) assert.ok(ps.some((p) => p.text.includes(`P${i} `)), `P${i} kept`);

// A single paragraph longer than a passage is cut at spaces, and nothing is lost.
const long = words(2000); // ~ 12,000 chars, no blank line
const lp = chunk(long, 'txt');
assert.ok(lp.length >= 4);
for (const p of lp) assert.ok(p.text.length <= TARGET);
assert.ok(lp[0].text.startsWith('w0 ') && lp.at(-1)!.text.endsWith('w1999'));
// No space at all: still cut.
for (const p of chunk(para(10_000), 'txt')) assert.ok(p.text.length <= TARGET);

// PDF: `p. N`, adjacent small pages share a passage as `p. a-b`, a long page keeps its number, empty pages keep the numbering.
const pdf = chunk(['Page one text.', 'Page two text.', '', 'Page four text.'], 'pdf');
assert.deepEqual(pdf, [{ locator: 'p. 1-4', text: 'Page one text.\n\nPage two text.\n\nPage four text.' }]);
const big = chunk(['x '.repeat(1000), 'y '.repeat(1000), 'z '.repeat(1000)], 'pdf'); // 2,000 chars a page
assert.deepEqual(big.map((p) => p.locator), ['p. 1', 'p. 2', 'p. 3'], 'a page too big to share starts its own passage');
const bigPage = chunk(['q '.repeat(5000), 'next page'], 'pdf');
assert.ok(bigPage.length > 2 && bigPage.slice(0, -1).every((p) => p.locator === 'p. 1'));
assert.equal(bigPage.at(-1)!.locator, 'p. 1-2', 'the last piece of page 1 shares a passage with page 2');
assert.deepEqual(chunk('first\fsecond', 'pdf'), [{ locator: 'p. 1-2', text: 'first\n\nsecond' }], 'one string, a form feed between pages');

// PowerPoint: `slide N`, from pptxText's "Slide N:" blocks.
const slides = chunk('Slide 1: Intro\nhello\n\nSlide 2: Scope\nNotes: later\n\nSlide 3: Risks', 'pptx');
assert.deepEqual(slides.map((p) => p.locator), ['slide 1-3']);
const slides2 = chunk(Array.from({ length: 4 }, (_, i) => `Slide ${i + 1}: ${para(1500, 's')}`).join('\n\n'), 'pptx');
assert.deepEqual(slides2.map((p) => p.locator), ['slide 1-2', 'slide 3', 'slide 4'], 'the overlap takes room, so slide 3 starts a passage');

// Excel: `Sheet!A1:F40`, the box around the passage's cells; a sheet never shares a passage with another; a quoted sheet name stays quoted.
const cells = [['A', 1], ['B', 1], ['F', 2], ['C', 40]].map(([c, r]) => `Sheet1!${c}${r}: v`).join('\n');
assert.deepEqual(chunk(cells, 'xlsx'), [{ locator: 'Sheet1!A1:F40', text: cells }]);
const two = chunk("Budget!A1: 1\nBudget!B2: 2\n'Q1 plan'!C3: 3", 'xlsx');
assert.deepEqual(two.map((p) => p.locator), ['Budget!A1:B2', "'Q1 plan'!C3:C3"]);
assert.ok(!two[1].text.includes('Budget'), 'no overlap across sheets');
const rows = Array.from({ length: 300 }, (_, i) => `Data!A${i + 1}: ${para(30, 'v')}\nData!B${i + 1}: ${i}`).join('\n');
const xp = chunk(rows, 'xlsx');
assert.ok(xp.length > 1 && xp.every((p) => p.text.length <= TARGET && /^Data!A\d+:B\d+$/.test(p.locator)), xp.map((p) => p.locator).join());
assert.equal(chunk('Sheet1!A1: 1\n[Cut: only the first 1 cells are shown; the workbook has more.]', 'xlsx')[0].locator, 'Sheet1!A1:A1', 'the closing note joins the last passage');

// Markdown and Word: `§ heading`, the heading in effect where the passage begins; `part N` before any heading.
const md = chunk('Intro text.\n\n# Budget risks\n\nThe vendor will slip.\n\n## Detail ##\n\nMore.', 'md');
assert.deepEqual(md, [{ locator: 'part 1', text: 'Intro text.\n\n# Budget risks\n\nThe vendor will slip.\n\n## Detail ##\n\nMore.' }]);
const mdLong = chunk(`# Overview\n\n${Array.from({ length: 30 }, () => para(300, 'o')).join('\n\n')}\n\n# Plan\n\n${Array.from({ length: 30 }, () => para(300, 'p')).join('\n\n')}`, 'md');
assert.equal(mdLong[0].locator, '§ Overview');
assert.ok(mdLong.some((p) => p.locator === '§ Plan'), mdLong.map((p) => p.locator).join('|'));
assert.equal(chunk('# Title\n\ntext', 'docx')[0].locator, '§ Title', 'Word headings come as Markdown');
assert.equal(chunk('# ' + para(300), 'md')[0].locator.length, '§ '.length + 80, 'a heading is cut at 80 characters');

// CSV: one row a line, `part N`.
const csv = chunk(Array.from({ length: 400 }, (_, i) => `${i},${para(20, 'c')}`).join('\r\n'), 'csv');
assert.ok(csv.length > 1 && csv.every((p, i) => p.locator === `part ${i + 1}` && p.text.length <= TARGET));

// The cap: at most 2,000 passages an item.
const huge = chunk(Array.from({ length: 2500 }, () => para(TARGET - 300, 'h')).join('\n\n'), 'txt');
assert.equal(huge.length, MAX_CHUNKS);
assert.equal(huge.at(-1)!.locator, `part ${MAX_CHUNKS}`);
assert.equal(chunk(Array.from({ length: 3000 }, (_, i) => para(TARGET - 300, 'h') + i), 'pdf').length, MAX_CHUNKS);
console.log('chunk: ok');
