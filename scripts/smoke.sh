#!/usr/bin/env bash
# End-to-end against a local wrangler dev (DEV_LOGIN=1 in .dev.vars). Signs in, makes a project, a task, moves it, trashes and restores it; then posts to the inbox with the local test secrets from .dev.vars (never .secrets/).
set -euo pipefail
B=${BASE:-http://localhost:8790}; J=/tmp/compass-smoke.jar; rm -f $J
H=(-s -b $J -c $J -H "Origin: $B" -H "Content-Type: application/json")
fail() { echo "smoke: FAIL $1"; exit 1; }
curl "${H[@]}" -X POST $B/api/auth/dev-login | grep -q '"ok":true' || fail dev-login
P=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke project","kind":"work"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).project.id')
T=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke task\",\"project_id\":\"$P\",\"due_at\":\"2026-01-01\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).task.id')
curl "${H[@]}" $B/api/today | grep -q 'Smoke task' || fail today
curl "${H[@]}" -X POST $B/api/tasks/$T/move -d '{"status":"progress"}' | grep -q '"status":"progress"' || fail move
curl "${H[@]}" $B/api/board | grep -q '"progress":\[{' || fail board
curl "${H[@]}" -X DELETE $B/api/tasks/$T | grep -q '"ok":true' || fail trash
curl "${H[@]}" -X POST $B/api/trash/tasks/$T/restore | grep -q '"ok":true' || fail restore
curl "${H[@]}" -X DELETE $B/api/projects/$P >/dev/null; curl "${H[@]}" -X DELETE $B/api/tasks/$T >/dev/null
# Inbox (Phase 2): the secrets come from .dev.vars, the local test values.
dv() { sed -n "s/^$1=//p" "$(dirname "$0")/../.dev.vars" | tail -1; }
KELLY=$(dv INBOX_SECRET_KELLY); IDS=$(dv INBOX_SECRET_ID); [ -n "$KELLY" ] && [ -n "$IDS" ] || fail "INBOX_SECRET_KELLY/ID missing in .dev.vars"
R=$RANDOM$RANDOM
post() { curl -s -X POST $B/api/inbox -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2"; }
N="{\"app\":\"home\",\"kind\":\"notification\",\"title\":\"Smoke inbox $R\",\"ref\":\"smoke:home:$R\"}"
NT=$(post "$KELLY" "$N" | node -pe 'JSON.parse(require("fs").readFileSync(0)).task_id') || fail "inbox post"; [ -n "$NT" ] && [ "$NT" != null ] || fail "inbox notification made no task"
[ "$(post "$KELLY" "$N" | node -pe 'JSON.parse(require("fs").readFileSync(0)).task_id')" = "$NT" ] || fail "inbox repost made a second task"
curl "${H[@]}" $B/api/today | grep -q "Smoke inbox $R" || fail "inbox task not on today"
curl "${H[@]}" -X DELETE $B/api/tasks/$NT >/dev/null
M="{\"app\":\"sonarflow\",\"kind\":\"meeting\",\"title\":\"Smoke meeting $R\",\"ref\":\"sonarflow:recording:smoke$R\",\"payload\":{\"title\":\"Smoke meeting\",\"summary\":\"s\",\"decisions\":[],\"action_items\":[],\"important_notes\":[],\"open_questions\":[]}}"
post "$IDS" "$M" | grep -q '"state":"added"' || fail "inbox meeting"
MID=$(curl "${H[@]}" $B/api/meetings | node -pe "(JSON.parse(require('fs').readFileSync(0)).meetings.find(m=>m.recording_id==='smoke$R')||{}).id") || fail "meetings list"
curl "${H[@]}" -X POST $B/api/meetings/$MID/accept -d '{"tasks":[],"decisions":[]}' | grep -q '"state":"reviewed"' || fail "meeting accept"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/inbox -H 'Authorization: Bearer wrong-secret' -H 'Content-Type: application/json' -d "$N")" = 401 ] || fail "inbox wrong secret not 401"
curl "${H[@]}" -X POST $B/api/trash/empty | grep -q purged || fail empty
curl -s -o /dev/null -w '%{http_code}' $B/api/tasks | grep -q 401 || fail "guard (no cookie)"
echo "smoke: ok"
