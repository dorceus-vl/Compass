// node scripts/gen-secret.mjs  -> prints a 32-byte base64 secret for COMPASS_DATA_KEY. Paste into .dev.vars, and
// `wrangler secret put COMPASS_DATA_KEY` reads it from stdin (see scripts/setup-cloudflare.sh).
import { randomBytes } from 'node:crypto';
console.log(randomBytes(32).toString('base64'));
