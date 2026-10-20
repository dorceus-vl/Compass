// A stand-in for Kelly-Cloud's Compass relay, for scripts/smoke.sh (and screenshots): node scripts/relay-stub.mjs <secret> [port]
// GET /api/compass-relay/brief?date= with X-Relay-Secret -> { text, generated_at }. 2000-01-02 answers long HTML-ish text, 2000-01-03 a 500. GET /hits counts authorised brief calls.
// POST /api/compass-relay/documents (raw bytes, X-File-Name URI-encoded) -> { id }; a name starting "kelly-refuse" answers 500. GET /docs lists what arrived: { docs: [{ name, size, head }] }.
// GET /api/compass-relay/calendar?from=&to= -> { events }: one event on `from`, one all-day on `to`, junk the Worker must drop. from 2000-01-03 -> 500, 2000-01-02 -> 600 events. GET /cal-hits counts them.
import { createServer } from 'node:http';
const [secret, port = '8791'] = process.argv.slice(2);
if (!secret) { console.error('usage: relay-stub.mjs <secret> [port]'); process.exit(1); }
let hits = 0, calHits = 0;
const docs = [];
createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (u.pathname === '/hits') return send(200, { hits });
  if (u.pathname === '/docs') return send(200, { docs });
  if (u.pathname === '/api/compass-relay/documents' && req.method === 'POST') {
    if (req.headers['x-relay-secret'] !== secret) return send(401, { error: 'bad secret' });
    const chunks = [];
    return req.on('data', (c) => chunks.push(c)).on('end', () => {
      const body = Buffer.concat(chunks), name = decodeURIComponent(String(req.headers['x-file-name'] ?? ''));
      docs.push({ name, size: body.length, head: body.subarray(0, 4).toString('latin1') });
      if (name.startsWith('kelly-refuse')) return send(500, { error: 'boom' });
      send(201, { id: `stub-${docs.length}` });
    });
  }
  if (u.pathname === '/cal-hits') return send(200, { hits: calHits });
  if (u.pathname === '/api/compass-relay/calendar') {
    if (req.headers['x-relay-secret'] !== secret) return send(401, { error: 'bad secret' });
    calHits++;
    const from = u.searchParams.get('from'), to = u.searchParams.get('to');
    if (from === '2000-01-03') return send(500, { error: 'boom' });
    if (from === '2000-01-02') return send(200, { events: Array.from({ length: 600 }, (_, i) => ({ title: `E${i}`, start: `${from}T09:00:00-05:00`, end: `${from}T10:00:00-05:00`, all_day: false, location: null, source: 'google' })) });
    return send(200, { events: [
      { title: `Dentist <b>${'x'.repeat(400)}</b>`, start: `${from}T14:30:00-04:00`, end: `${from}T15:30:00-04:00`, all_day: false, location: 'Main St', source: 'google' },
      { title: 'Conference', start: to, end: to, all_day: true, location: null, source: 'google' },
      { title: 'Bad date', start: 'tomorrow', end: 'soon', all_day: false, source: 'google' }, 'junk', null] });
  }
  if (u.pathname !== '/api/compass-relay/brief') return send(404, {});
  if (req.headers['x-relay-secret'] !== secret) return send(401, { error: 'bad secret' });
  hits++;
  const date = u.searchParams.get('date');
  if (date === '2000-01-03') return send(500, { error: 'boom' });
  if (date === '2000-01-02') return send(200, { text: `<script>alert(1)</script>${'x'.repeat(3000)}`, generated_at: '2000-01-02T08:00:00Z' });
  send(200, { text: `Good morning, Vlad. Two things need you today: the water-bill reminder and the sprint demo prep.\n\nThe rest can wait until after lunch. (${date})`, generated_at: new Date().toISOString() });
}).listen(Number(port), '127.0.0.1');
