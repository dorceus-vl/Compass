// node --experimental-strip-types scripts/trust-files.test.ts
// The app-link trust files (ruling N5) parse and name the right app ids; _headers serves them as JSON.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../web/public/${p}`, import.meta.url), 'utf8');

const aasa = JSON.parse(read('.well-known/apple-app-site-association'));
const appId = 'K948BT44PM.com.knocturnlabs.compass';
assert.deepEqual(aasa.applinks.details[0].appIDs, [appId]);
assert.deepEqual(aasa.applinks.details[0].components, [{ '/': '/api/*', exclude: true }, { '/': '*' }]);
assert.deepEqual(aasa.webcredentials.apps, [appId]);

const links = JSON.parse(read('.well-known/assetlinks.json'));
assert.equal(links.length, 1);
assert.deepEqual(links[0].relation, ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds']);
assert.equal(links[0].target.namespace, 'android_app');
assert.equal(links[0].target.package_name, 'com.knocturnlabs.compass');
assert.match(links[0].target.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

const headers = read('_headers');
for (const f of ['apple-app-site-association', 'assetlinks.json'])
  assert.match(headers, new RegExp(`/\\.well-known/${f}\\n  Content-Type: application/json`));
console.log('trust files ok');
