#!/usr/bin/env bash
# Phase 2 secrets. Generates only the missing values into .secrets/compass-inbox.env (dir 700, file 600, git-ignored); never prints a value.
# `--put` also pipes each non-empty value into `wrangler secret put` for names `wrangler secret list` doesn't show. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
D=.secrets; F=$D/compass-inbox.env; t=
trap 'rm -f "$t"' EXIT
mkdir -p "$D"; chmod 700 "$D"; touch "$F"; chmod 600 "$F"
val() { sed -n "s/^$1=//p" "$F" | tail -1; }
drop() { t=$(mktemp "$D/.tmp.XXXXXX"); grep -v "^$1=" "$F" > "$t" || [ $? -eq 1 ]; mv "$t" "$F"; t=; chmod 600 "$F"; } # grep 1 = no lines left; 2 = read error → abort
add() {
  [ -n "$2" ] || { echo "setup-phase2: no value generated for $1" >&2; exit 1; }
  drop "$1"
  [ ! -s "$F" ] || [ -z "$(tail -c1 "$F")" ] || echo >> "$F" # the file must end in a newline before appending
  printf '%s=%s\n' "$1" "$2" >> "$F"; echo "generated $1"
}

for N in INBOX_SECRET_KELLY INBOX_SECRET_ID INBOX_SECRET_HOLLOW AGENT_SECRET_KELLY KELLY_RELAY_SECRET; do # Phase 5: the last two are also Kelly-Cloud's COMPASS_AGENT_SECRET and COMPASS_RELAY_SECRET (same values)
  if [ -z "$(val $N)" ]; then v=$(node scripts/gen-secret.mjs); add $N "$v"; fi
done
if [ -z "$(val VAPID_PUBLIC_KEY)" ] || [ -z "$(val VAPID_PRIVATE_KEY)" ]; then # the pair belongs together: regenerate both
  V=$(node scripts/gen-vapid.mjs)
  pub=$(printf '%s\n' "$V" | sed -n 's/^VAPID_PUBLIC_KEY=//p'); priv=$(printf '%s\n' "$V" | sed -n 's/^VAPID_PRIVATE_KEY=//p')
  [ -n "$pub" ] && [ -n "$priv" ] || { echo "setup-phase2: no VAPID pair generated" >&2; exit 1; }
  add VAPID_PUBLIC_KEY "$pub"; add VAPID_PRIVATE_KEY "$priv"
fi
if [ -z "$(val EMAIL_INBOX_ADDRESS)" ]; then
  # 10 random bytes = exactly 16 base32 characters (a-z, 2-7).
  s=$(node -e 'const b=require("crypto").randomBytes(10);let n=0n;for(const x of b)n=n<<8n|BigInt(x);let s="";for(let i=0;i<16;i++){s=("abcdefghijklmnopqrstuvwxyz234567"[Number(n&31n)])+s;n>>=5n}process.stdout.write(s)')
  if [ -n "$s" ]; then add EMAIL_INBOX_ADDRESS "compass-$s@knocturnlabs.com"; else add EMAIL_INBOX_ADDRESS ""; fi # never left of && (errexit off there)
fi
if ! grep -q '^ALLOWED_FORWARDERS=' "$F"; then # empty: nobody may forward until Vlad's addresses go here
  [ ! -s "$F" ] || [ -z "$(tail -c1 "$F")" ] || echo >> "$F"
  echo 'ALLOWED_FORWARDERS=' >> "$F"
fi

if [ "${1:-}" = "--put" ]; then
  LISTED=$(npx wrangler secret list)
  for N in INBOX_SECRET_KELLY INBOX_SECRET_ID INBOX_SECRET_HOLLOW AGENT_SECRET_KELLY KELLY_RELAY_SECRET VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY EMAIL_INBOX_ADDRESS ALLOWED_FORWARDERS; do
    V=$(val $N)
    if [ -z "$V" ]; then echo "skip $N (empty)"; continue; fi
    if printf '%s' "$LISTED" | grep -q "\"$N\""; then echo "skip $N (already set)"; continue; fi
    printf '%s' "$V" | npx wrangler secret put "$N" >/dev/null
    echo "put $N"
  done
fi
echo "setup-phase2: ok"
