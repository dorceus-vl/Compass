#!/usr/bin/env bash
# Creates what Compass needs on Cloudflare, without prompts. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
npx wrangler d1 list --json | grep -q '"name": "compass-db"' || npx wrangler d1 create compass-db
ID=$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).find(x=>x.name==="compass-db");console.log(r.uuid)})')
node -e 'const fs=require("fs");const p="wrangler.jsonc";fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace(/"database_id": "[^"]*"/,`"database_id": "${process.argv[1]}"`))' "$ID"
npx wrangler r2 bucket list | grep -q '^name:\s*compass-files' || npx wrangler r2 bucket create compass-files
if ! npx wrangler secret list | grep -q COMPASS_DATA_KEY; then node scripts/gen-secret.mjs | npx wrangler secret put COMPASS_DATA_KEY; fi
echo "setup: ok (db $ID)"
