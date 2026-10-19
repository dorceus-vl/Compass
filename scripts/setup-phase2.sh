#!/usr/bin/env bash
# Phase 2 secrets. Generates only the missing values into .secrets/compass-inbox.env (dir 700, file 600, git-ignored); never prints a value.
# `--put` also pipes each non-empty value into `wrangler secret put` for names `wrangler secret list` doesn't show. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
D=.secrets; F=$D/compass-inbox.env
mkdir -p $D; chmod 700 $D; touch $F; chmod 600 $F
val() { sed -n "s/^$1=//p" $F | tail -1; }
drop() { local t; t=$(mktemp $D/.tmp.XXXXXX); grep -v "^$1=" $F > $t || true; mv $t $F; chmod 600 $F; }
add() { drop "$1"; printf '%s=%s\n' "$1" "$2" >> $F; echo "generated $1"; }

for N in INBOX_SECRET_KELLY INBOX_SECRET_ID INBOX_SECRET_HOLLOW; do
  [ -n "$(val $N)" ] || add $N "$(node scripts/gen-secret.mjs)"
done
if [ -z "$(val VAPID_PUBLIC_KEY)" ] || [ -z "$(val VAPID_PRIVATE_KEY)" ]; then # the pair belongs together: regenerate both
  V=$(node scripts/gen-vapid.mjs)
  for N in VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do add $N "$(printf '%s\n' "$V" | sed -n "s/^$N=//p")"; done
fi
# 10 random bytes = exactly 16 base32 characters (a-z, 2-7).
[ -n "$(val EMAIL_INBOX_ADDRESS)" ] || add EMAIL_INBOX_ADDRESS "compass-$(node -e 'const b=require("crypto").randomBytes(10);let n=0n;for(const x of b)n=n<<8n|BigInt(x);let s="";for(let i=0;i<16;i++){s=("abcdefghijklmnopqrstuvwxyz234567"[Number(n&31n)])+s;n>>=5n}process.stdout.write(s)')@knocturnlabs.com"
grep -q '^ALLOWED_FORWARDERS=' $F || echo 'ALLOWED_FORWARDERS=' >> $F # empty: nobody may forward until Vlad's addresses go here

if [ "${1:-}" = "--put" ]; then
  LISTED=$(npx wrangler secret list)
  for N in INBOX_SECRET_KELLY INBOX_SECRET_ID INBOX_SECRET_HOLLOW VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY EMAIL_INBOX_ADDRESS ALLOWED_FORWARDERS; do
    V=$(val $N)
    if [ -z "$V" ]; then echo "skip $N (empty)"
    elif printf '%s' "$LISTED" | grep -q "\"$N\""; then echo "skip $N (already set)"
    else printf '%s' "$V" | npx wrangler secret put $N >/dev/null && echo "put $N"; fi
  done
fi
echo "setup-phase2: ok"
