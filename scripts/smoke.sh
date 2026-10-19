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
# Library (Phase 3 Task 3): bundled page found by search; a personal lesson is listed in full, a work lesson never.
PL=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke personal","kind":"personal"}' | js d.project.id)
PW=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke work","kind":"work"}' | js d.project.id)
curl "${H[@]}" -X POST $B/api/projects/$PL/lessons -d "{\"text\":\"Zebrafish lesson $R\"}" | grep -q '"item"' || fail "personal lesson create"
curl "${H[@]}" -X POST $B/api/projects/$PW/lessons -d "{\"text\":\"Walrus lesson $R\"}" | grep -q '"item"' || fail "work lesson create"
curl "${H[@]}" "$B/api/library?q=library" | grep -q '"slug":"how-to-use-the-library"' || fail "library search"
curl "${H[@]}" $B/api/library | grep -q '"slug":"how-to-use-the-library"' || fail "library tree"
IMP=$(curl "${H[@]}" $B/api/library/imports)
echo "$IMP" | grep -q "Zebrafish lesson $R" || fail "personal lesson missing from library imports"
echo "$IMP" | grep -q "Walrus lesson $R" && fail "work lesson leaked into library imports"
curl "${H[@]}" "$B/api/library?q=zebrafish" | grep -q '"source":"lesson"' || fail "lesson search"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' $B/api/library/no-such-page)" = 404 ] || fail "library 404"
# P3-6: a lesson of a personal project switched to offline stays on the device lists but is not model-facing (retrieve has no HTTP route; scripts/library-boundary.test.ts covers the split, this runs the model-facing SQL for real).
PO=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke offline personal","kind":"personal"}' | js d.project.id)
curl "${H[@]}" -X POST $B/api/projects/$PO/lessons -d "{\"text\":\"Narwhal lesson $R\"}" | grep -q '"item"' || fail "offline-personal lesson create"
curl "${H[@]}" -X PATCH $B/api/projects/$PO -d '{"data_boundary":"offline"}' | grep -q '"data_boundary":"offline"' || fail "personal boundary to offline"
curl "${H[@]}" $B/api/library/imports | grep -q "Narwhal lesson $R" || fail "offline-boundary lesson missing from device imports"
curl "${H[@]}" "$B/api/library?q=narwhal" | grep -q '"source":"lesson"' || fail "offline-boundary lesson missing from device search"
MODEL=$(D1X "SELECT count(*) AS n FROM lessons l JOIN projects p ON p.id = l.project_id WHERE p.kind = 'personal' AND l.deleted_at IS NULL AND l.enc_v = 0 AND p.deleted_at IS NULL AND p.data_boundary = 'cloud' AND l.text LIKE '%Narwhal lesson $R%'" | js 'd[0].results[0].n')
[ "$MODEL" = 0 ] || fail "offline-boundary lesson reached the model-facing query"
curl "${H[@]}" -X DELETE $B/api/projects/$PO >/dev/null
curl "${H[@]}" -X DELETE $B/api/projects/$PL >/dev/null; curl "${H[@]}" -X DELETE $B/api/projects/$PW >/dev/null
echo "smoke: (l) library search, tree, imports (personal lesson in, work lesson out), 404"
# Documents (Phase 3 Task 9): personal PDF imported to the library; work PDF sealed in R2 and refused by the library; template placeholders; a renamed .exe refused.
HF=(-s -b $J -c $J -H "Origin: $B"); SCR=$(mktemp -d)
up() { curl "${HF[@]}" -w '\n%{http_code}' -F "file=$1" "${@:2}" $B/api/documents; }
DP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke docs personal","kind":"personal"}' | js d.project.id)
DW=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke docs work","kind":"work"}' | js d.project.id)
U1=$(up "@scripts/fixtures/hello.pdf;type=application/pdf" -F "project_id=$DP"); [ "$(printf '%s' "$U1" | tail -1)" = 201 ] || fail "personal pdf upload: $U1"
D1=$(printf '%s' "$U1" | head -1 | js d.document.id)
printf '%s' "$U1" | grep -q 'r2_key' && fail "document response leaks r2_key"
IM=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/library/import -d "{\"document_id\":\"$D1\",\"title\":\"Smoke hello $R\"}"); [ "$(printf '%s' "$IM" | tail -1)" = 201 ] || fail "library import: $IM"
SLUG=$(printf '%s' "$IM" | head -1 | js d.page.slug)
curl "${H[@]}" "$B/api/library?q=hello" | grep -q "\"slug\":\"$SLUG\"" || fail "imported page not found by search"
[ "$(curl "${H[@]}" $B/api/documents/$D1 | js d.document.text_indexed)" = 1 ] || fail "text_indexed not set"
curl "${H[@]}" $B/api/documents/$D1/file -D $SCR/h -o $SCR/f; head -c4 $SCR/f | grep -q '%PDF' || fail "personal file did not download"
grep -qi '^content-disposition: attachment' $SCR/h || fail "document not served as attachment"
U2=$(up "@scripts/fixtures/hello.pdf;type=application/pdf" -F "project_id=$DW"); [ "$(printf '%s' "$U2" | tail -1)" = 201 ] || fail "work pdf upload: $U2"
D2=$(printf '%s' "$U2" | head -1 | js d.document.id)
npx wrangler r2 object get compass-files/docs/$D2 --local --file $SCR/raw >/dev/null 2>&1 || fail "could not read the sealed object"
head -c4 $SCR/raw | grep -q '%PDF' && fail "work file is stored unsealed"
curl "${H[@]}" $B/api/documents/$D2/file -o $SCR/w; head -c4 $SCR/w | grep -q '%PDF' || fail "sealed work file did not open"
[ "$(D1X "SELECT enc_v AS n FROM documents WHERE id='$D2'" | js 'd[0].results[0].n')" = 2 ] || fail "work document name not sealed"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/library/import -d "{\"document_id\":\"$D2\"}")" = 403 ] || fail "work document imported to the library"
node -e 'const f=require("fflate");const x=s=>f.strToU8(s);require("fs").writeFileSync(process.argv[1],f.zipSync({"word/document.xml":x("<w:document xmlns:w=\"x\"><w:body><w:p><w:r><w:t>Hi {{proj</w:t></w:r><w:r><w:t>ect.name}}</w:t></w:r></w:p></w:body></w:document>"),"word/header1.xml":x("<w:hdr xmlns:w=\"x\"><w:p><w:r><w:t>{{report.date}}</w:t></w:r></w:p></w:hdr>")}))' $SCR/t.docx
U3=$(up "@$SCR/t.docx;filename=t.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" -F "is_template=1"); [ "$(printf '%s' "$U3" | tail -1)" = 201 ] || fail "template upload: $U3"
printf '%s' "$U3" | head -1 | js 'JSON.stringify(d.document.placeholders)==="[\"project.name\",\"report.date\"]"&&d.document.is_template===1' | grep -q true || fail "template placeholders: $U3"
[ "$(up "@scripts/fixtures/hello.pdf;filename=evil.exe;type=application/pdf" | tail -1)" = 400 ] || fail "renamed .exe accepted"
[ "$(up "@scripts/fixtures/hello.pdf;type=application/pdf" -F "is_template=1" | tail -1)" = 400 ] || fail "pdf accepted as a template"
D3=$(printf '%s' "$U3" | head -1 | js d.document.id)
curl "${H[@]}" -X PATCH $B/api/documents/$D3 -d '{"name":"renamed.docx","is_template":0}' | js 'd.document.name==="renamed.docx"&&d.document.is_template===0&&d.document.placeholders.length===0' | grep -q true || fail "document patch"
curl "${H[@]}" -X DELETE $B/api/library/$SLUG | grep -q '"ok":true' || fail "library remove"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X DELETE $B/api/library/how-to-use-the-library)" = 404 ] || fail "a bundled page could be removed"
curl "${H[@]}" "$B/api/library?q=hello" | grep -q "\"slug\":\"$SLUG\"" && fail "removed import still searchable"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE action LIKE 'document.%' AND detail LIKE '%hello%'" | js 'd[0].results[0].n')" = 0 ] || fail "a file name reached the audit log"
for x in $D1 $D2 $D3; do curl "${H[@]}" -X DELETE $B/api/documents/$x | grep -q '"ok":true' || fail "document trash"; done
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' $B/api/documents/$D1/file)" = 404 ] || fail "trashed document still served"
curl "${H[@]}" -X DELETE $B/api/projects/$DP >/dev/null; curl "${H[@]}" -X DELETE $B/api/projects/$DW >/dev/null; rm -rf $SCR
echo "smoke: (q) pdf upload -> import -> searchable -> removed; work pdf sealed in R2 and opens, import 403; template placeholders; .exe 400"
# Copilot (Phase 3 Task 7), on the local stub (AI_STUB=1 with DEV_LOGIN=1 in .dev.vars; no key, no provider call).
AT0=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
P1=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke copilot personal","kind":"personal"}' | js d.project.id)
CH1=$(curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"project_id\":\"$P1\",\"message\":\"How do I log a risk?\"}")
TH=$(printf '%s' "$CH1" | js 'd.thread.id'); AM=$(printf '%s' "$CH1" | js 'd.messages[1].id')
printf '%s' "$CH1" | js 'd.messages.length===2&&d.messages[1].content.startsWith("Stub answer for:")&&d.messages[1].citations.length===1&&d.messages[1].proposals.tasks.length===1' | grep -q true || fail "copilot chat: $CH1"
[ "$(curl "${H[@]}" $B/api/ai/threads/$TH | js 'd.messages.length')" = 2 ] || fail "copilot thread should hold 2 messages"
[ "$(curl "${H[@]}" $B/api/ai/usage | js 'd.month_cost_micro>0')" = true ] || fail "copilot usage not counted"
curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"thread_id\":\"$TH\",\"rerun\":true,\"provider\":\"gemini\"}" | js 'd.messages.length===1&&d.messages[0].role==="assistant"&&d.messages[0].provider==="gemini"' | grep -q true || fail "copilot rerun"
echo "smoke: (m) copilot chat -> stub answer, 1 citation, 1 proposed task; rerun on gemini -> one assistant message"
NMSG() { D1X "SELECT (SELECT count(*) FROM ai_messages)*1000+(SELECT count(*) FROM ai_threads) AS n" | js 'd[0].results[0].n'; }
W1=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke copilot work","kind":"work"}' | js d.project.id)
N0=$(NMSG); OFF=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/ai/chat -d "{\"project_id\":\"$W1\",\"message\":\"x\"}")
[ "$(printf '%s' "$OFF" | tail -1)" = 409 ] && printf '%s' "$OFF" | grep -q '"error":"offline_boundary"' || fail "offline project not refused: $OFF"
curl "${H[@]}" -X PATCH $B/api/projects/$P1 -d '{"data_boundary":"offline"}' >/dev/null # the thread's project (not the body's) decides, rerun included
RR="{\"thread_id\":\"$TH\",\"project_id\":\"$W1\",\"rerun\":true}" # a variable: bash 3.2 brace-expands {a,b} inside "$(...)"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/ai/chat -d "$RR")" = 409 ] || fail "rerun on an offline thread not refused"
[ "$(NMSG)" = "$N0" ] || fail "an offline refusal stored rows"
echo "smoke: (n) offline work project -> 409 offline_boundary; thread switched offline -> rerun 409; nothing stored"
[ "$(curl "${H[@]}" -X PATCH $B/api/ai/messages/$AM -d '{"saved":1}' | js 'd.message.saved')" = 1 ] || fail "save answer"
curl "${H[@]}" $B/api/ai/saved | js "d.messages.some(m=>m.id==='$AM'&&m.thread_title==='How do I log a risk?'&&m.project_id==='$P1')" | grep -q true || fail "saved answer not listed"
UM=$(curl "${H[@]}" $B/api/ai/threads/$TH | js 'd.messages[0].id')
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/ai/messages/$UM -d '{"saved":1}')" = 400 ] || fail "a question could be saved"
echo "smoke: (o) saved answer listed (still readable on an offline project); a question cannot be saved"
curl "${H[@]}" -X PATCH $B/api/projects/$W1 -d '{"data_boundary":"cloud"}' | grep -q '"data_boundary":"cloud"' || fail "work boundary to cloud"
CW=$(curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"project_id\":\"$W1\",\"message\":\"Smoke sealed question\"}")
TW=$(printf '%s' "$CW" | js 'd.thread.id'); [ "$(printf '%s' "$CW" | js 'd.thread.title')" = "Smoke sealed question" ] || fail "work chat: $CW"
[ "$(D1X "SELECT count(*) AS n FROM ai_messages WHERE thread_id='$TW' AND enc_v=2 AND content NOT LIKE '%Smoke%'" | js 'd[0].results[0].n')" = 2 ] || fail "work copilot messages are not ciphertext"
[ "$(D1X "SELECT count(*) AS n FROM ai_threads WHERE id='$TW' AND enc_v=2 AND title NOT LIKE '%Smoke%'" | js 'd[0].results[0].n')" = 1 ] || fail "work thread title is not ciphertext"
curl "${H[@]}" $B/api/ai/threads/$TW | grep -q 'Stub answer for: Smoke sealed question' || fail "sealed thread does not read back"
echo "smoke: (p) work project switched to cloud -> chat 200, thread and messages stored as ciphertext (enc_v 2)"
for x in $TH $TW; do curl "${H[@]}" -X DELETE $B/api/ai/threads/$x | grep -q '"ok":true' || fail "thread trash"; done
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' $B/api/ai/threads/$TH)" = 404 ] || fail "trashed thread still served"
curl "${H[@]}" -X DELETE $B/api/projects/$P1 >/dev/null; curl "${H[@]}" -X DELETE $B/api/projects/$W1 >/dev/null
D1X "DELETE FROM ai_usage WHERE at >= '$AT0'" >/dev/null # local DB only: repeated runs must not hit the 30-an-hour limit
curl -s -o /dev/null -w '%{http_code}' $B/api/tasks | grep -q 401 || fail "guard (no cookie)"
echo "smoke: ok"
