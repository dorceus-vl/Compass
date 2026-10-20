// node --experimental-strip-types scripts/attachments.test.ts
// Which documents may join a chat thread (worker/lib/attachments.ts), and how a message remembers them (shared/attachments.ts).
import assert from 'node:assert/strict';
import { checkAttachments } from '../worker/lib/attachments.ts';
import { withAttachments, splitAttachments } from '../shared/attachments.ts';

const live = (project_id: string | null) => ({ project_id, deleted_at: null });
const cloud = { P1: 'cloud', P2: 'cloud', OFF: 'offline' } as const;
const ok = (ids: string[], docs: Record<string, ReturnType<typeof live> | null>, thread: string | null) => checkAttachments(ids, docs, thread, { ...cloud });

assert.equal(ok(['a'], { a: live('P1') }, 'P1'), 'ok', "a document of the thread's project");
assert.equal(ok(['a'], { a: live(null) }, null), 'ok', 'unfiled while the thread is personal');
assert.equal(ok([], {}, 'P1'), 'ok', 'no documents');
assert.equal(ok(['a', 'b', 'c'], { a: live('P1'), b: live('P1'), c: live('P1') }, 'P1'), 'ok', 'three is the limit');
assert.equal(ok(['a', 'a', 'a', 'a'], { a: live('P1') }, 'P1'), 'ok', 'the same document four times is one');
assert.equal(ok(['a', 'b', 'c', 'd'], { a: live('P1'), b: live('P1'), c: live('P1'), d: live('P1') }, 'P1'), 'too_many');
assert.equal(ok(['a'], { a: { ...live(null), enc_v: 2 } }, null), 'document_boundary', 'unfiled but sealed (a work knowledge upload) never joins a thread');
assert.equal(ok(['a'], { a: { ...live(null), enc_v: 0 } }, null), 'ok', 'unfiled and plain');
assert.equal(ok(['a'], { a: live('P2') }, 'P1'), 'document_boundary', "another project's document");
assert.equal(ok(['a'], { a: live('P1') }, null), 'document_boundary', 'a project document never joins a personal thread');
assert.equal(ok(['a'], { a: live(null) }, 'P1'), 'document_boundary', "an unfiled document does not join a project's thread");
assert.equal(ok(['a'], { a: live('OFF') }, 'OFF'), 'document_boundary', 'Offline only, even in its own project');
assert.equal(ok(['a'], { a: live('GONE') }, 'GONE'), 'document_boundary', 'its project is in Trash');
assert.equal(ok(['a'], { a: { project_id: 'P1', deleted_at: '2026-10-20T00:00:00.000Z' } }, 'P1'), 'document_boundary', 'a trashed document');
assert.equal(ok(['a'], { a: null }, 'P1'), 'document_boundary', 'no such document');
assert.equal(ok(['a', 'b'], { a: live('P1'), b: live('P2') }, 'P1'), 'document_boundary', 'one bad document refuses all');

// The stored user message: names and ids in a last line, never the text.
const list = [{ id: 'd1', name: 'Budget (v2).xlsx' }, { id: 'd2', name: 'a "q" b.png' }];
const stored = withAttachments('Review this', list);
assert.deepEqual(splitAttachments(stored), { text: 'Review this', attachments: list });
assert.equal(withAttachments('plain', []), 'plain');
assert.deepEqual(splitAttachments('plain'), { text: 'plain', attachments: [] });
const odd = 'He wrote [[attachments]] [1,2]\n\n[[attachments]] not json';
assert.deepEqual(splitAttachments(odd), { text: odd, attachments: [] }, 'a message that only resembles the marker is left alone');
assert.deepEqual(splitAttachments(withAttachments('x\n\n[[attachments]] y', list)).attachments, list, 'the last marker wins');
console.log('attachments: ok');
