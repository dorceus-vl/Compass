// node --experimental-strip-types scripts/access.test.ts
// Who may use the app, and from where (worker/lib/access.ts).
import assert from 'node:assert/strict';
import { sameOrigin, subOf, userAllowed } from '../worker/lib/access.ts';

const A = '7cad1bd5-760b-4423-9b02-406c74d5a6e4';
const B = 'ab39fa67-0a88-40b6-824b-9718500e5f47';
const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.sig`;

// The account in a Knocturn ID access token (base64url payload).
assert.equal(subOf(jwt({ sub: A })), A);
for (const bad of ['', 'nodots', 'a.%%%.b', jwt({ aud: 'x' }), jwt({ sub: 42 })]) assert.equal(subOf(bad), null, bad);

// Only listed accounts; an empty or missing list lets nobody in.
assert.equal(userAllowed(`${A}, ${B}`, A), true);
assert.equal(userAllowed(`${A}, ${B}`, B), true);
assert.equal(userAllowed(`${A}, ${B}`, 'someone-else'), false);
assert.equal(userAllowed(`${A}, ${B}`, null), false);
assert.equal(userAllowed('', A), false);
assert.equal(userAllowed(undefined, A), false);

// Changes made with the cookie only from this site's own pages.
const SITE = 'https://compass.knocturnlabs.com';
const req = (method: string, origin?: string, url = `${SITE}/api/tasks`) =>
  new Request(url, { method, headers: origin ? { origin } : {}, body: method === 'GET' ? undefined : '{}' });
assert.equal(sameOrigin(req('POST', SITE)), true);
assert.equal(sameOrigin(req('POST', 'https://aura.knocturnlabs.com')), false, 'a sibling site');
assert.equal(sameOrigin(req('DELETE')), false, 'no Origin');
assert.equal(sameOrigin(req('GET')), true, 'reads are untouched');
assert.equal(sameOrigin(req('POST', 'http://localhost:5173', 'http://localhost:8787/api/x')), true, 'local dev');
assert.equal(sameOrigin(req('POST', 'http://localhost:5173')), false, 'never against the real site');

console.log('access: ok');
