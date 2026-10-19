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
curl "${H[@]}" -X DELETE $B/api/tasks/$T >/dev/null # the project goes to Trash after a meeting is filed under it (below)
# Inbox (Phase 2): the secrets come from .dev.vars, the local test values.
dv() { sed -n "s/^$1=//p" "$(dirname "$0")/../.dev.vars" | tail -1; }
KELLY=$(dv INBOX_SECRET_KELLY); IDS=$(dv INBOX_SECRET_ID); HOLLOW=$(dv INBOX_SECRET_HOLLOW)
[ -n "$KELLY" ] && [ -n "$IDS" ] && [ -n "$HOLLOW" ] || fail "INBOX_SECRET_KELLY/ID/HOLLOW missing in .dev.vars"
R=$RANDOM$RANDOM
post() { curl -s -X POST $B/api/inbox -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2"; }
js() { node -pe "const d=JSON.parse(require('fs').readFileSync(0)); $1"; } # reads JSON on stdin, prints the expression
tid() { post "$1" "$2" | js d.task_id; }
task() { curl "${H[@]}" $B/api/tasks/$1 | js "d.task.$2"; }
N="{\"app\":\"home\",\"kind\":\"notification\",\"title\":\"Smoke inbox $R\",\"ref\":\"smoke:home:$R\"}"
NT=$(post "$KELLY" "$N" | node -pe 'JSON.parse(require("fs").readFileSync(0)).task_id') || fail "inbox post"; [ -n "$NT" ] && [ "$NT" != null ] || fail "inbox notification made no task"
[ "$(post "$KELLY" "$N" | node -pe 'JSON.parse(require("fs").readFileSync(0)).task_id')" = "$NT" ] || fail "inbox repost made a second task"
curl "${H[@]}" $B/api/today | grep -q "Smoke inbox $R" || fail "inbox task not on today"
curl "${H[@]}" -X DELETE $B/api/tasks/$NT >/dev/null
M="{\"app\":\"sonarflow\",\"kind\":\"meeting\",\"title\":\"Smoke meeting $R\",\"ref\":\"sonarflow:recording:smoke$R\",\"payload\":{\"title\":\"Smoke meeting\",\"summary\":\"s\",\"decisions\":[],\"action_items\":[],\"important_notes\":[],\"open_questions\":[]}}"
post "$IDS" "$M" | grep -q '"state":"added"' || fail "inbox meeting"
MID=$(curl "${H[@]}" $B/api/meetings | node -pe "(JSON.parse(require('fs').readFileSync(0)).meetings.find(m=>m.recording_id==='smoke$R')||{}).id") || fail "meetings list"
# (a) the meeting is filed under the project with a decision; then the project goes to Trash (Empty Trash below must still succeed).
curl "${H[@]}" -X POST $B/api/meetings/$MID/accept -d "{\"project_id\":\"$P\",\"tasks\":[],\"decisions\":[{\"text\":\"Smoke decision\"}]}" | grep -q '"state":"reviewed"' || fail "meeting accept"
curl "${H[@]}" -X DELETE $B/api/projects/$P | grep -q '"ok":true' || fail "project trash"
# (b) a needs-reply email reposted by Kelly makes one task, and never a new one after it is done.
E="{\"app\":\"kelly\",\"kind\":\"email\",\"title\":\"Smoke reply $R\",\"ref\":\"smoke:mail:$R\",\"payload\":{\"from\":\"Ann\",\"account\":\"me@gmail.com\"}}"
ET=$(tid "$KELLY" "$E"); [ -n "$ET" ] && [ "$ET" != null ] || fail "kelly email made no task"
[ "$(tid "$KELLY" "$E")" = "$ET" ] || fail "kelly email repost made a second task"
curl "${H[@]}" -X POST $B/api/tasks/$ET/done | grep -q '"status":"done"' || fail "email task done"
[ "$(tid "$KELLY" "$E")" = "$ET" ] || fail "kelly email repost after done made a new task"
[ "$(task $ET status)" = done ] || fail "kelly email repost reopened the task"
echo "smoke: (b) email repost x3 -> one task $ET, still done"
# (c) Hollow's secret reusing a finance ref doesn't touch the finance task.
FT=$(tid "$KELLY" "{\"app\":\"finance\",\"kind\":\"notification\",\"title\":\"Smoke bill $R\",\"suggest\":\"pay_bill\",\"ref\":\"smoke:fin:$R\"}")
[ -n "$FT" ] && [ "$FT" != null ] || fail "finance post made no task"
HT=$(tid "$HOLLOW" "{\"app\":\"hollow\",\"kind\":\"notification\",\"title\":\"Smoke hijack $R\",\"ref\":\"smoke:fin:$R\"}")
[ "$(task $FT title)" = "Smoke bill $R" ] || fail "hollow post rewrote the finance task"
[ "$HT" != "$FT" ] || fail "hollow post landed on the finance task"
echo "smoke: (c) finance task $FT kept its title; hollow got its own task $HT"
# (d) a repost whose rule now gives a later due never postpones the task; an earlier one moves it; a user-edited title stays.
RID=$(curl "${H[@]}" -X POST $B/api/rules -d "{\"name\":\"Smoke due $R\",\"app\":\"home\",\"mode\":\"task\",\"dedupe\":\"update\",\"sort\":1,\"match\":{\"title_regex\":\"smokedue$R\"},\"then_set\":{\"due_offset_days\":10}}" | js d.rule.id)
D="{\"app\":\"home\",\"kind\":\"notification\",\"title\":\"Smoke smokedue$R\",\"ref\":\"smoke:due:$R\"}"
DT=$(tid "$KELLY" "$D"); D1=$(task $DT due_at); [ -n "$D1" ] && [ "$D1" != null ] || fail "due rule set no due"
curl "${H[@]}" -X PATCH $B/api/rules/$RID -d '{"then_set":{"due_offset_days":30}}' >/dev/null
[ "$(tid "$KELLY" "$D")" = "$DT" ] || fail "due repost made a second task"
[ "$(task $DT due_at)" = "$D1" ] || fail "repost postponed the due date ($D1 -> $(task $DT due_at))"
curl "${H[@]}" -X PATCH $B/api/tasks/$DT -d '{"title":"Smoke due edited by me"}' >/dev/null
curl "${H[@]}" -X PATCH $B/api/rules/$RID -d '{"then_set":{"due_offset_days":1}}' >/dev/null
tid "$KELLY" "{\"app\":\"home\",\"kind\":\"notification\",\"title\":\"Smoke smokedue$R again\",\"ref\":\"smoke:due:$R\"}" >/dev/null
D3=$(task $DT due_at); [[ "$D3" < "$D1" ]] || fail "an earlier due did not move the task ($D1 -> $D3)"
[ "$(task $DT title)" = "Smoke due edited by me" ] || fail "repost overwrote a title the user edited"
echo "smoke: (d) due $D1 kept on a later repost, moved to $D3 on an earlier one; edited title kept"
curl "${H[@]}" -X DELETE $B/api/rules/$RID >/dev/null
for x in $ET $FT $HT $DT; do curl "${H[@]}" -X DELETE $B/api/tasks/$x >/dev/null; done
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/inbox -H 'Authorization: Bearer wrong-secret' -H 'Content-Type: application/json' -d "$N")" = 401 ] || fail "inbox wrong secret not 401"
EMPTY=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/trash/empty)
[ "$(printf '%s' "$EMPTY" | tail -1)" = 200 ] && printf '%s' "$EMPTY" | grep -q purged || fail "empty ($(printf '%s' "$EMPTY" | tail -1))"
echo "smoke: (a) Empty Trash after a project with an accepted meeting -> $(printf '%s' "$EMPTY" | head -1)"
# Phase 3: every table that references a project (or a document / thread) must clear in the one purge batch, or the project delete fails on its FK.
# The four governance logs go in through the API (a work project, so they are sealed); documents / imports / threads / messages stay raw until their routes exist.
P3=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke PM project","kind":"work"}' | js d.project.id)
TS=$(date -u +%Y-%m-%dT%H:%M:%S.000Z); D1X() { npx wrangler d1 execute compass-db --local --json --command "$1" 2>/dev/null; }
RK=$(curl "${H[@]}" -X POST $B/api/projects/$P3/raid -d '{"type":"risk","text":"Smoke risk","probability":4,"impact":5}' | js d.item.id); [ -n "$RK" ] && [ "$RK" != undefined ] || fail "raid create"
CH=$(curl "${H[@]}" -X POST $B/api/projects/$P3/changes -d '{"title":"Smoke change"}' | js d.item.id); [ -n "$CH" ] && [ "$CH" != undefined ] || fail "change create"
curl "${H[@]}" -X POST $B/api/projects/$P3/lessons -d '{"text":"Smoke lesson"}' | grep -q '"item"' || fail "lesson create"
curl "${H[@]}" -X POST $B/api/projects/$P3/decisions -d '{"text":"Smoke decision"}' | grep -q '"item"' || fail "decision create"
curl "${H[@]}" $B/api/projects/$P3/raid | grep -q 'Smoke risk' || fail "raid list (sealed rows must come back readable)"
[ "$(D1X "SELECT text AS t FROM raid_items WHERE id='$RK'" | js 'd[0].results[0].t.startsWith("Smoke risk")')" = false ] || fail "work raid text is stored in plain"
[ "$(curl "${H[@]}" $B/api/portfolio | js "d.projects.find(p=>p.id==='$P3').high_risks")" = 1 ] || fail "portfolio high_risks"
echo "smoke: (f) risk P4xI5 -> portfolio high_risks 1; stored text is ciphertext"
[ "$(curl "${H[@]}" -X PATCH $B/api/changes/$CH -d '{"decision":"approved"}' | js 'd.item.decided_at')" != null ] || fail "approved change has no decided_at"
[ "$(curl "${H[@]}" -X PATCH $B/api/changes/$CH -d '{"decision":"pending"}' | js 'd.item.decided_at')" = null ] || fail "pending change kept decided_at"
curl "${H[@]}" -X PATCH $B/api/changes/$CH -d '{"decision":"approved"}' >/dev/null
echo "smoke: (g) approving a change sets decided_at"
curl "${H[@]}" -X PATCH $B/api/projects/$P3 -d '{"data_boundary":"cloud"}' | grep -q '"data_boundary":"cloud"' || fail "boundary switch"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE action='project.boundary' AND target='$P3'" | js 'd[0].results[0].n')" = 1 ] || fail "no project.boundary audit row"
echo "smoke: (h) boundary switch passed step-up (dev session) and was audited"
M2="{\"app\":\"sonarflow\",\"kind\":\"meeting\",\"title\":\"Smoke raid meeting $R\",\"ref\":\"sonarflow:recording:raid$R\",\"payload\":{\"title\":\"Smoke raid meeting\",\"summary\":\"s\",\"decisions\":[],\"action_items\":[],\"important_notes\":[],\"open_questions\":[]}}"
post "$IDS" "$M2" | grep -q '"state":"added"' || fail "inbox raid meeting"
MID2=$(curl "${H[@]}" $B/api/meetings | js "(d.meetings.find(m=>m.recording_id==='raid$R')||{}).id")
ACC=$(curl "${H[@]}" -X POST $B/api/meetings/$MID2/accept -d "{\"project_id\":\"$P3\",\"tasks\":[],\"decisions\":[],\"raid\":[{\"type\":\"issue\",\"text\":\"Smoke raid from meeting\",\"at\":\"12:30\"}]}")
[ "$(printf '%s' "$ACC" | js d.raid)" = 1 ] || fail "accept with raid: $ACC"
curl "${H[@]}" $B/api/projects/$P3/raid | js "d.items.some(i=>i.text==='Smoke raid from meeting'&&i.from_meeting_id==='$MID2'&&i.trigger==='Meeting 12:30')" | grep -q true || fail "meeting RAID item not listed with from_meeting_id"
echo "smoke: (i) meeting accepted with one RAID item -> listed with from_meeting_id"
curl "${H[@]}" "$B/api/meetings?project=$P3" | js "d.meetings.length===1&&d.meetings[0].id==='$MID2'&&d.meetings[0].state==='reviewed'" | grep -q true || fail "GET /api/meetings?project= should list only that project's meeting (any state)"
echo "smoke: (i2) GET /api/meetings?project= lists the meeting filed under the project and not others"
D1X "INSERT INTO documents (id,name,kind,size,content_type,r2_key,project_id,created_at,updated_at) VALUES ('smk-doc','smoke.md','md',1,'text/markdown','docs/smk-doc','$P3','$TS','$TS');
INSERT INTO library_pages (id,slug,section,title,body,import_doc_id,created_at,updated_at) VALUES ('smk-lib','smoke-lib','Smoke','Smoke page','x','smk-doc','$TS','$TS');
INSERT INTO ai_threads (id,project_id,title,provider,created_at,updated_at) VALUES ('smk-thr','$P3','Smoke thread','claude','$TS','$TS');
INSERT INTO ai_messages (id,thread_id,role,content,created_at) VALUES ('smk-msg','smk-thr','user','hi','$TS');" >/dev/null
SEEDED=$(D1X "SELECT (SELECT count(*) FROM raid_items WHERE project_id='$P3')+(SELECT count(*) FROM change_requests WHERE project_id='$P3')+(SELECT count(*) FROM lessons WHERE project_id='$P3')+(SELECT count(*) FROM decisions WHERE project_id='$P3')+(SELECT count(*) FROM documents WHERE id='smk-doc')+(SELECT count(*) FROM library_pages WHERE id='smk-lib')+(SELECT count(*) FROM ai_threads WHERE id='smk-thr')+(SELECT count(*) FROM ai_messages WHERE id='smk-msg') AS n" | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].results[0].n')
[ "$SEEDED" = 9 ] || fail "PM seed inserts did not land ($SEEDED of 9)"
curl "${H[@]}" -X DELETE $B/api/projects/$P3 | grep -q '"ok":true' || fail "pm project trash"
EMPTY=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/trash/empty)
[ "$(printf '%s' "$EMPTY" | tail -1)" = 200 ] || fail "empty with PM rows ($(printf '%s' "$EMPTY" | tail -1))"
LEFT=$(D1X "SELECT (SELECT count(*) FROM raid_items WHERE project_id='$P3')+(SELECT count(*) FROM change_requests WHERE project_id='$P3')+(SELECT count(*) FROM lessons WHERE project_id='$P3')+(SELECT count(*) FROM decisions WHERE project_id='$P3')+(SELECT count(*) FROM documents WHERE id='smk-doc')+(SELECT count(*) FROM library_pages WHERE id='smk-lib')+(SELECT count(*) FROM ai_threads WHERE id='smk-thr')+(SELECT count(*) FROM ai_messages WHERE id='smk-msg')+(SELECT count(*) FROM projects WHERE id='$P3') AS n" | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].results[0].n')
[ "$LEFT" = 0 ] || fail "PM rows survived Empty Trash ($LEFT left)"
echo "smoke: (e) Empty Trash with RAID, change, lesson, decision, document, import, thread and message rows -> $(printf '%s' "$EMPTY" | head -1)"
curl -s -o /dev/null -w '%{http_code}' $B/api/tasks | grep -q 401 || fail "guard (no cookie)"
echo "smoke: ok"
