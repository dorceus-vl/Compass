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
# Fix round: chunked upload refused (411); sealed work files capped at 10 MB (9.5 MB in, 10.5 MB out, round trip intact); an offline project's document stays out of the library and the model-facing query.
CK=$(curl -s -o /dev/null -w '%{http_code}' -b $J -H "Origin: $B" -H 'Transfer-Encoding: chunked' -H 'Content-Type: multipart/form-data; boundary=x' --data-binary @- $B/api/documents <<<'--x--'); [ "$CK" = 411 ] || fail "chunked upload not refused ($CK)"
BIG=$(mktemp -d); head -c 9961472 /dev/zero | tr '\0' 'a' > $BIG/ok.txt; head -c 11010048 /dev/zero | tr '\0' 'a' > $BIG/big.txt
SW=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke sealed big","kind":"work"}' | js d.project.id)
UB=$(up "@$BIG/ok.txt;type=text/plain" -F "project_id=$SW"); [ "$(printf '%s' "$UB" | tail -1)" = 201 ] || fail "9.5 MB sealed upload: $UB"
DB1=$(printf '%s' "$UB" | head -1 | js d.document.id); curl "${HF[@]}" $B/api/documents/$DB1/file -o $BIG/back.txt; cmp -s $BIG/ok.txt $BIG/back.txt || fail "9.5 MB sealed file did not round-trip"
UC=$(up "@$BIG/big.txt;type=text/plain" -F "project_id=$SW"); [ "$(printf '%s' "$UC" | tail -1)" = 400 ] && printf '%s' "$UC" | grep -q 'Work files must be 10 MB or smaller.' || fail "10.5 MB sealed upload not refused: $UC"
curl "${H[@]}" -X DELETE $B/api/documents/$DB1 >/dev/null; curl "${H[@]}" -X DELETE $B/api/projects/$SW >/dev/null; rm -rf $BIG
PF=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke offline docs","kind":"personal"}' | js d.project.id)
UF=$(up "@scripts/fixtures/hello.pdf;type=application/pdf" -F "project_id=$PF"); DF=$(printf '%s' "$UF" | head -1 | js d.document.id)
IF=$(curl "${H[@]}" -X POST $B/api/library/import -d "{\"document_id\":\"$DF\"}"); SF=$(printf '%s' "$IF" | js d.page.slug)
MODELQ() { D1X "SELECT count(*) AS n FROM library_pages lp LEFT JOIN documents d ON d.id = lp.import_doc_id LEFT JOIN projects dp ON dp.id = d.project_id WHERE lp.deleted_at IS NULL AND (dp.id IS NULL OR dp.data_boundary = 'cloud') AND lp.slug = '$SF'" | js 'd[0].results[0].n'; }
[ "$(MODELQ)" = 1 ] || fail "cloud-project import missing from the model-facing set"
curl "${H[@]}" -X PATCH $B/api/projects/$PF -d '{"data_boundary":"offline"}' >/dev/null
[ "$(MODELQ)" = 0 ] || fail "offline-project import still in the model-facing set"
curl "${H[@]}" $B/api/library/imports | grep -q "\"slug\":\"$SF\"" || fail "offline-project import missing from the device list"
OI=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/library/import -d "{\"document_id\":\"$DF\"}"); [ "$(printf '%s' "$OI" | tail -1)" = 409 ] && printf '%s' "$OI" | grep -q '"error":"offline_boundary"' || fail "offline import not refused: $OI"
curl "${H[@]}" -X DELETE $B/api/library/$SF >/dev/null; curl "${H[@]}" -X DELETE $B/api/documents/$DF >/dev/null; curl "${H[@]}" -X DELETE $B/api/projects/$PF >/dev/null
echo "smoke: (q2) chunked upload 411; sealed 9.5 MB round trip, 10.5 MB refused; offline-project import 409 and out of the model-facing set"
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
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/ai/chat -d '{"project_id":"","message":"x"}')" = 400 ] || fail "empty project_id not refused"
# Final review fix: Trash means the copilot stops reading an import (a trashed document, or a live document of a trashed project); "ask about this page" goes through modelPage.
PT=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke trash import","kind":"personal"}' | js d.project.id)
DT=$(up "@scripts/fixtures/hello.pdf;type=application/pdf" -F "project_id=$PT" | head -1 | js d.document.id)
ST=$(curl "${H[@]}" -X POST $B/api/library/import -d "{\"document_id\":\"$DT\",\"title\":\"Smoke trash import $R\"}" | js d.page.slug)
PAGEQ() { curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/ai/chat -d "{\"page\":\"$ST\",\"message\":\"Summarise this page\"}"; }
[ "$(PAGEQ)" = 200 ] || fail "a live import is not model-facing"
curl "${H[@]}" -X DELETE $B/api/projects/$PT >/dev/null
[ "$(PAGEQ)" = 404 ] || fail "a trashed project's import is still model-facing"
curl "${H[@]}" -X POST $B/api/trash/projects/$PT/restore | grep -q '"ok":true' || fail "restore project"
curl "${H[@]}" -X DELETE $B/api/documents/$DT >/dev/null
[ "$(PAGEQ)" = 404 ] || fail "a trashed document's import is still model-facing"
curl "${H[@]}" $B/api/library/imports | grep -q "\"slug\":\"$ST\"" || fail "a trashed document's import left the device list"
curl "${H[@]}" -X DELETE $B/api/library/$ST >/dev/null; curl "${H[@]}" -X DELETE $B/api/projects/$PT >/dev/null
echo "smoke: (p2) empty project_id 400; ask-about-page: live import 200, trashed project 404, trashed document 404 (device list keeps it)"
# Status report data (Phase 3 Task 10): W1 is a cloud work project here, so its rows are sealed and come back readable; the stub writes the summary.
curl "${H[@]}" -X POST $B/api/projects/$W1/raid -d '{"type":"risk","text":"Smoke report risk","probability":4,"impact":5}' >/dev/null
SR='{"project_id":"'$W1'","from":"2026-01-01","to":"2026-12-31","ai":true}'
curl "${H[@]}" -X POST $B/api/reports/status -d "$SR" | js "d.input.project.id==='$W1'&&d.input.raid.some(r=>r.text==='Smoke report risk')&&/^Stub answer/.test(d.ai_summary)&&d.ai_refused===null" | grep -q true || fail "status report data / stub summary"
curl "${H[@]}" -X PATCH $B/api/projects/$W1 -d '{"data_boundary":"offline"}' >/dev/null
N1=$(D1X "SELECT count(*) AS n FROM ai_usage" | js 'd[0].results[0].n')
curl "${H[@]}" -X POST $B/api/reports/status -d "$SR" | js "d.ai_summary===null&&d.ai_refused==='offline_boundary'&&d.input.raid.length===1" | grep -q true || fail "offline project not refused for the summary"
[ "$(D1X "SELECT count(*) AS n FROM ai_usage" | js 'd[0].results[0].n')" = "$N1" ] || fail "an offline report made a model call"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/reports/status -d '{"project_id":"'$W1'","from":"2026-02-30","to":"2026-12-31"}')" = 400 ] || fail "bad date accepted"
echo "smoke: (r) status report data readable for a work project; cloud -> stub summary; offline -> ai_refused offline_boundary, no model call"
# Task 12: today's brief on the stub (an offline project's task title must never reach the model input), the export, AI settings, a gate milestone.
BO=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke brief offline","kind":"work"}' | js d.project.id)
BC=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke brief cloud","kind":"personal"}' | js d.project.id)
curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke offline secret $R\",\"project_id\":\"$BO\",\"due_at\":\"2026-01-01\"}" | grep -q '"task"' || fail "brief offline task"
curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke cloud visible $R\",\"project_id\":\"$BC\",\"due_at\":\"2026-01-02\"}" | grep -q '"task"' || fail "brief cloud task"
curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke loose personal $R\",\"kind\":\"personal\",\"due_at\":\"2026-01-03\"}" | grep -q '"task"' || fail "brief loose task"
curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke loose work $R\",\"kind\":\"work\",\"due_at\":\"2026-01-04\"}" | grep -q '"task"' || fail "brief loose work task"
BR=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/ai/brief); [ "$(printf '%s' "$BR" | tail -1)" = 200 ] || fail "brief: $BR"
BT=$(printf '%s' "$BR" | head -1 | js d.text)
case "$BT" in "Stub answer for:"*) ;; *) fail "brief text: $BT";; esac
case "$BT" in *"Smoke cloud visible $R"*) ;; *) fail "cloud project task missing from the model input";; esac
case "$BT" in *"Smoke loose personal $R"*) ;; *) fail "personal task without a project missing from the model input";; esac
case "$BT" in *"Smoke offline secret"*) fail "offline project task reached the model input";; esac
case "$BT" in *"Smoke loose work"*) fail "work task without a project reached the model input";; esac
printf '%s' "$BT" | grep -Eq '\+[0-9]+ items from offline projects' || fail "no offline count line: $BT"
printf '%s' "$BT" | grep -Eq '\+[0-9]+ work items without a project' || fail "no no-project count line: $BT"
[ "$(D1X "SELECT count(*) AS n FROM ai_usage WHERE feature='brief'" | js 'd[0].results[0].n')" -ge 1 ] || fail "brief not counted in ai_usage"
echo "smoke: (s) brief on the stub: cloud and personal titles in, offline-project and no-project work titles out, both count lines present"
EX=$(curl "${H[@]}" -D $J.h -X GET $B/api/export -w '\n%{http_code}' ); [ "$(printf '%s' "$EX" | tail -1)" = 200 ] || fail "export: $(printf '%s' "$EX" | tail -1)"
curl "${H[@]}" -X POST $B/api/projects/$BO/raid -d "{\"type\":\"risk\",\"text\":\"Smoke export risk $R\",\"probability\":2,\"impact\":2}" | grep -q '"item"' || fail "export raid create"
curl "${H[@]}" -X DELETE $B/api/projects/$BC >/dev/null # trashed rows are exported too
EXJ=$(curl "${H[@]}" $B/api/export)
printf '%s' "$EXJ" | js "d.version===1&&d.raid_items.some(r=>r.text==='Smoke export risk $R')&&d.tasks.some(t=>t.title==='Smoke offline secret $R')&&d.projects.some(p=>p.id==='$BC'&&p.deleted_at)&&!('auth_sessions' in d)&&!('push_subscriptions' in d)&&!('audit_log' in d)&&!('ai_usage' in d)&&d.documents.every(x=>!('r2_key' in x))&&d.raid_items.every(r=>!('enc_v' in r))" | grep -q true || fail "export content"
grep -qi '^content-disposition: attachment; filename="compass-export-[0-9-]*\.json"' $J.h || fail "export is not an attachment: $(cat $J.h)"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE action='export'" | js 'd[0].results[0].n')" -ge 1 ] || fail "export not audited"
rm -f $J.h
echo "smoke: (t) export: 200 JSON attachment, work RAID text in plaintext, trashed project included, no sessions, push, audit or usage, audited"
AIS=$(curl "${H[@]}" -X PATCH $B/api/settings -d '{"ai_monthly_cap_micro":5000000,"default_provider":"gemini"}'); printf '%s' "$AIS" | js 'd.ai_monthly_cap_micro===5000000&&d.default_provider==="gemini"' | grep -q true || fail "ai settings: $AIS"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/settings -d '{"ai_monthly_cap_micro":-1}')" = 400 ] || fail "negative cap accepted"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/settings -d '{"default_provider":"openai"}')" = 400 ] || fail "unknown provider accepted"
curl "${H[@]}" -X PATCH $B/api/settings -d '{"ai_monthly_cap_micro":20000000,"default_provider":"claude"}' >/dev/null
echo "smoke: (u) AI settings: cap and default provider saved, bad values 400"
GM=$(curl "${H[@]}" -X POST $B/api/projects/$BO/milestones -d '{"name":"Smoke gate","due_at":"2026-12-01","gate":1}' | js d.milestone.id)
[ "$(curl "${H[@]}" -X PATCH $B/api/milestones/$GM -d '{"gate":0}' | js d.milestone.gate)" = 0 ] || fail "gate toggle off"
[ "$(curl "${H[@]}" -X PATCH $B/api/milestones/$GM -d '{"gate":1}' | js d.milestone.gate)" = 1 ] || fail "gate toggle on"
echo "smoke: (v) milestone created as a gate, toggled off and on"
curl "${H[@]}" -X DELETE $B/api/projects/$BO >/dev/null
for x in $TH $TW; do curl "${H[@]}" -X DELETE $B/api/ai/threads/$x | grep -q '"ok":true' || fail "thread trash"; done
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' $B/api/ai/threads/$TH)" = 404 ] || fail "trashed thread still served"
curl "${H[@]}" -X DELETE $B/api/projects/$P1 >/dev/null; curl "${H[@]}" -X DELETE $B/api/projects/$W1 >/dev/null
D1X "DELETE FROM ai_usage WHERE at >= '$AT0'" >/dev/null # local DB only: repeated runs must not hit the 30-an-hour limit
# (w) Phase 4 device push: fake tokens register, resolve to 'local' (no push secrets here) so the rows stay; the test push lands in the outbox.
APT=$(printf 'a%.0s' $(seq 64)); FCT="smokefcm${R}_$(printf 'x%.0s' $(seq 24))"
curl "${H[@]}" -X POST $B/api/push/device -d "{\"kind\":\"apns\",\"token\":\"$APT\",\"env\":\"development\",\"platform\":\"ios\",\"device_name\":\"Smoke iPhone\"}" | grep -q '"id"' || fail "apns register"
curl "${H[@]}" -X POST $B/api/push/device -d "{\"kind\":\"fcm\",\"token\":\"$FCT\",\"platform\":\"android\"}" | grep -q '"id"' || fail "fcm register"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/push/device -d '{"kind":"apns","token":"nothex","env":"production","platform":"ios"}')" = 400 ] || fail "bad apns token accepted"
NOENV="{\"kind\":\"apns\",\"token\":\"$APT\",\"platform\":\"ios\"}"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/push/device -d "$NOENV")" = 400 ] || fail "apns without env accepted"
SINCE=$(node -pe 'new Date(Date.now()-1000).toISOString()')
curl "${H[@]}" -X POST $B/api/push/test | grep -q '"sent":0' || fail "push test"
curl "${H[@]}" "$B/api/push/outbox?since=$SINCE" | js "d.items.some(i=>i.title==='Test from Compass'&&i.url==='/')" | grep -q true || fail "outbox missing the test push"
curl "${H[@]}" $B/api/push | js "d.subscriptions.filter(x=>x.platform==='ios'||x.platform==='android').length>=2" | grep -q true || fail "local device rows were removed or changed"
for x in $(curl "${H[@]}" $B/api/push | js "d.subscriptions.filter(x=>x.platform==='ios'||x.platform==='android').map(x=>x.id).join(' ')"); do curl "${H[@]}" -X DELETE $B/api/push/$x >/dev/null; done
NS=$(curl -s -o /tmp/compass-native.json -w '%{http_code}' -X POST $B/api/auth/native -H "Origin: $B" -H 'Content-Type: application/json' -d "{\"code\":\"badcode$R\",\"code_verifier\":\"$(printf 'v%.0s' $(seq 43))\"}")
case "$NS" in 401|502|503) ;; *) fail "native sign-in with a bad code answered $NS";; esac
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/auth/native -H 'Content-Type: application/json' -d '{}')" = 403 ] || fail "native sign-in skipped the same-origin check"
echo "smoke: (w) device push: apns+fcm registered, local (rows kept), outbox has the test push; /api/auth/native bad code -> $NS"
for f in apple-app-site-association assetlinks.json; do
  curl -s -i $B/.well-known/$f | tr -d '\r' | grep -iq '^content-type: application/json' || fail "/.well-known/$f is not application/json"
  curl -s $B/.well-known/$f | grep -q 'com.knocturnlabs.compass' || fail "/.well-known/$f does not name the app"
done
echo "smoke: (x) /.well-known trust files served as JSON"
# (y) Phase 5 agent API (Kelly): bearer secret, off by default, scopes, shared-only, audited, limits. Local D1 only.
AG=$(dv AGENT_SECRET_KELLY); [ -n "$AG" ] || fail "AGENT_SECRET_KELLY missing in .dev.vars"
ag() { curl -s -w '\n%{http_code}' -X "$1" "$B/api/agent$2" -H "Authorization: Bearer $AG" -H 'Content-Type: application/json' -d "${3:-}"; } # body, then the status on the last line
agc() { ag "$@" | tail -1; }
agb() { ag "$@" | sed '$d'; }
arows() { D1X "SELECT count(*) AS n FROM audit_log WHERE actor='kelly' AND action LIKE 'agent.%'" | js 'd[0].results[0].n'; }
kset() { D1X "INSERT INTO settings (id,json,updated_at) VALUES (1, json_object('kelly', json('$1')), '$TS') ON CONFLICT(id) DO UPDATE SET json = json_set(json,'\$.kelly',json('$1'))" >/dev/null; }
D1X "DELETE FROM audit_log WHERE actor='kelly' AND action LIKE 'agent.%'" >/dev/null # repeated runs must not hit the 30-writes-an-hour cap
kset '{"enabled":false,"scopes":[]}'
TODAY=$(curl "${H[@]}" $B/api/settings | js d.tz | node -pe "new Intl.DateTimeFormat('en-CA',{timeZone:require('fs').readFileSync(0,'utf8').trim()}).format(new Date())")
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/settings -d '{"kelly":{"enabled":true,"scopes":[]}}')" = 400 ] || fail "PATCH /api/settings accepted kelly"
[ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/agent/today)" = 401 ] || fail "agent without a secret not 401"
A0=$(arows); [ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/agent/today -H 'Authorization: Bearer wrong-secret')" = 401 ] || fail "agent wrong secret not 401"
[ "$(arows)" = "$A0" ] || fail "a bad secret wrote an audit row"
[ "$(agc GET /today)" = 403 ] && agb GET /today | grep -q kelly_disabled || fail "agent switched off is not 403 kelly_disabled"
AP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke agent offline","kind":"work"}' | js d.project.id)
AC=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke agent cloud","kind":"work"}' | js d.project.id)
curl "${H[@]}" -X PATCH $B/api/projects/$AC -d '{"data_boundary":"cloud"}' | grep -q '"data_boundary":"cloud"' || fail "agent cloud project"
PT=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke agent personal $R\",\"due_at\":\"$TODAY\"}" | js d.task.id)
OT=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke agent hidden $R\",\"project_id\":\"$AP\",\"due_at\":\"$TODAY\"}" | js d.task.id)
CT=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke agent work cloud $R\",\"project_id\":\"$AC\",\"due_at\":\"$TODAY\"}" | js d.task.id)
kset '{"enabled":true,"scopes":["compass:read.tasks"]}'
TD=$(agb GET /today)
echo "$TD" | grep -q "Smoke agent personal $R" || fail "agent today misses the personal task"
echo "$TD" | grep -q "Smoke agent work cloud $R" || fail "agent today misses the work-and-cloud task"
echo "$TD" | grep -q "Smoke agent hidden $R" && fail "agent today shows a work-offline task"
[ "$(echo "$TD" | js 'd.hidden>=1')" = true ] || fail "agent hidden does not count the offline task"
[ "$(agc GET "/tasks?view=today&limit=5")" = 200 ] || fail "agent tasks list"
[ "$(agc POST /tasks '{"title":"x"}')" = 403 ] && agb POST /tasks '{"title":"x"}' | grep -q scope_not_granted || fail "agent write without scope is not 403 scope_not_granted"
[ "$(agc GET /projects)" = 403 ] || fail "agent projects without scope not 403"
kset '{"enabled":true,"scopes":["compass:read.tasks","compass:write.tasks","compass:read.projects"]}'
[ "$(agb GET /projects | js "d.projects.some(p=>p.id==='$AC')&&!d.projects.some(p=>p.id==='$AP')")" = true ] || fail "agent projects: cloud in, offline out"
NEW=$(agb POST /tasks "{\"title\":\"Smoke agent made $R\",\"due_at\":\"$TODAY\"}"); NID=$(echo "$NEW" | js d.task.id)
[ -n "$NID" ] && [ "$NID" != undefined ] || fail "agent create"
[ "$(task $NID source_app)" = kelly ] || fail "agent task source_app is not kelly"
[ "$(D1X "SELECT actor AS a FROM task_events WHERE task_id='$NID' AND type='created'" | js 'd[0].results[0].a')" = kelly ] || fail "agent created event actor is not kelly"
IN="{\"title\":\"Smoke agent in work $R\",\"project_id\":\"$AC\"}"; [ "$(agc POST /tasks "$IN")" = 201 ] || fail "agent create in a cloud project"
[ "$(D1X "SELECT count(*) AS n FROM tasks WHERE title LIKE 'Smoke agent in work%'" | js 'd[0].results[0].n')" = 0 ] || fail "agent task in a work project is stored in plain"
OFF="{\"title\":\"x\",\"project_id\":\"$AP\"}"; [ "$(agc POST /tasks "$OFF")" = 404 ] || fail "agent create in an offline project not 404"
[ "$(agc POST /tasks '{"title":""}')" = 400 ] || fail "agent create with no title not 400"
[ "$(agc POST /tasks/$NID/done)" = 200 ] || fail "agent done"
[ "$(task $NID status)" = done ] || fail "agent done did not finish the task"
[ "$(D1X "SELECT actor AS a FROM task_events WHERE task_id='$NID' AND type='done'" | js 'd[0].results[0].a')" = kelly ] || fail "agent done event actor is not kelly"
[ "$(agc POST /tasks/$OT/done)" = 404 ] || fail "agent done on a hidden task not 404"
[ "$(task $OT status)" = new ] || fail "agent finished a hidden task"
[ "$(agc POST /tasks/$NID/done)" = 404 ] || fail "agent done on a finished task not 404"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE actor='kelly' AND action='agent.tasks.done' AND detail LIKE '%not_found%' AND target='$OT'" | js 'd[0].results[0].n')" = 1 ] || fail "hidden done not audited as not_found"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE actor='kelly' AND detail LIKE '%Smoke agent%'" | js 'd[0].results[0].n')" = 0 ] || fail "task text reached the audit log"
# A personal, project-less subtask under a work-offline parent is neither listed nor completable.
ST=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke agent subtask $R\",\"parent_id\":\"$OT\",\"due_at\":\"$TODAY\"}" | js d.task.id)
agb GET /today | grep -q "Smoke agent subtask $R" && fail "agent today lists a subtask"
agb GET "/tasks?view=today&limit=50" | grep -q "Smoke agent subtask $R" && fail "agent tasks lists a subtask"
[ "$(agc POST /tasks/$ST/done)" = 404 ] || fail "agent done on a subtask not 404"
[ "$(task $ST status)" = new ] || fail "agent finished a subtask"
A1=$(arows); agc GET /today >/dev/null; [ "$(arows)" = $((A1 + 1)) ] || fail "agent call did not write exactly one audit row"
# 2 creates and 1 done are in: 27 more writes make 30, the 31st is refused.
for i in $(seq 27); do BULK="{\"title\":\"Smoke agent bulk $i $R\"}"; [ "$(agc POST /tasks "$BULK")" = 201 ] || fail "agent write $i refused early"; done
[ "$(agc POST /tasks '{"title":"one too many"}')" = 429 ] && agb POST /tasks '{"title":"one too many"}' | grep -q write_limit || fail "31st agent write is not 429 write_limit"
echo "smoke: (y) agent API: 401 w/o audit, off by default, scopes, shared-only (hidden counted), kelly actor, 30 writes then 429"
kset '{"enabled":false,"scopes":[]}'
D1X "DELETE FROM audit_log WHERE actor='kelly' AND action LIKE 'agent.%'" >/dev/null
for x in $(curl "${H[@]}" "$B/api/tasks?status=all" | js "d.tasks.filter(t=>t.title.startsWith('Smoke agent')).map(t=>t.id).join(' ')"); do curl "${H[@]}" -X DELETE $B/api/tasks/$x >/dev/null; done
curl "${H[@]}" -X DELETE $B/api/projects/$AP >/dev/null; curl "${H[@]}" -X DELETE $B/api/projects/$AC >/dev/null
# (z) Phase 5 Kelly's side: PUT /api/kelly (dev session skips the passkey), the log, and the brief proxy against a local stub relay.
RS=$(dv KELLY_RELAY_SECRET); [ -n "$RS" ] || fail "KELLY_RELAY_SECRET missing in .dev.vars"
node "$(dirname "$0")/relay-stub.mjs" "$RS" 8791 & STUB=$!; trap 'kill $STUB 2>/dev/null' EXIT; sleep 1
BD=2031-$(printf %02d $((RANDOM % 12 + 1)))-$(printf %02d $((RANDOM % 28 + 1))) # a date nobody asked for in the last hour: the Worker caches briefs per date
hits() { curl -s localhost:8791/hits | js d.hits; }
kb() { curl "${H[@]}" "$B/api/kelly/brief?date=$1"; }
kput() { curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PUT $B/api/kelly -d "$1"; }
kset '{"enabled":false,"scopes":[]}'
H0=$(hits)
kb $BD | grep -q '"unavailable":true' || fail "brief answered while Kelly was off"
kput '{"enabled":true,"scopes":[]}' | grep -q 200 || fail "PUT /api/kelly enabled"
kb $BD | grep -q '"unavailable":true' || fail "brief answered without compass:read.tasks"
[ "$(hits)" = "$H0" ] || fail "relay was called while off or without the scope"
[ "$(kput '{"scopes":["compass:delete.tasks"]}')" = 400 ] || fail "PUT accepted an unknown scope"
[ "$(kput '{}')" = 400 ] || fail "PUT accepted an empty body"
[ "$(kput '{"scopes":["compass:read.tasks","compass:read.tasks"]}')" = 200 ] || fail "PUT scopes"
curl "${H[@]}" $B/api/kelly | grep -q '"scopes":\["compass:read.tasks"\]' || fail "GET /api/kelly scopes (duplicates not folded?)"
curl "${H[@]}" $B/api/kelly | js 'd.enabled===true && d.relay===true && typeof d.calls_today==="number"' | grep -q true || fail "GET /api/kelly shape"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE actor='you' AND action='kelly.scopes' AND at >= '$TS'" | js 'd[0].results[0].n')" = 2 ] || fail "kelly.scopes not audited once per change"
BR=$(kb $BD); echo "$BR" | grep -q 'water-bill' || fail "brief did not come through the relay"
[ "$(echo "$BR" | js 'Object.keys(d).sort().join()')" = generated_at,text ] || fail "brief shape"
[ "$(hits)" = $((H0 + 1)) ] || fail "relay not called once"
kb $BD | grep -q 'water-bill' || fail "cached brief lost"
[ "$(hits)" = $((H0 + 1)) ] || fail "second brief call was not served from the Worker cache"
[ "$(kb 2000-01-02 | js 'd.text.length<=1200 && d.text.startsWith("<script>")')" = true ] || fail "long relay text not capped (or HTML interpreted)"
kb 2000-01-03 | grep -q '"unavailable":true' || fail "relay 500 is not unavailable"
curl "${H[@]}" -o /dev/null -w '%{http_code}' "$B/api/kelly/log?limit=0" | grep -q 400 || fail "log limit 0 not 400"
LG=$(curl "${H[@]}" "$B/api/kelly/log?limit=100")
[ "$(echo "$LG" | js 'd.rows.length>=1 && d.rows.length<=100 && d.rows.every((r,i)=>r.actor==="kelly"||r.action==="kelly.scopes")')" = true ] || fail "log rows"
[ "$(echo "$LG" | js 'd.rows.some(r=>r.action==="kelly.scopes"&&r.detail&&r.detail.after)')" = true ] || fail "log has no kelly.scopes row with before/after"
kset '{"enabled":true,"scopes":["compass:write.tasks"]}'; LT=$(agb POST /tasks "{\"title\":\"Smoke kelly log $R\"}" | js d.task.id)
curl "${H[@]}" "$B/api/kelly/log?limit=5" | js "d.rows.some(r=>r.target==='$LT'&&r.action==='agent.tasks.create'&&r.task_live===true)" | grep -q true || fail "log does not show the live task"
curl "${H[@]}" -X DELETE $B/api/tasks/$LT >/dev/null
curl "${H[@]}" "$B/api/kelly/log?limit=5" | js "d.rows.some(r=>r.target==='$LT'&&r.task_live===false)" | grep -q true || fail "log still links a trashed task"
# The calendar proxy: validated before anything else, gated, capped, cached.
kset '{"enabled":true,"scopes":["compass:read.tasks"]}'
kc() { curl "${H[@]}" "$B/api/kelly/calendar?from=$1&to=$2"; }
code() { curl "${H[@]}" -o /dev/null -w '%{http_code}' "$1"; }
CM=$(printf %02d $((RANDOM % 12 + 1))); CF=2033-$CM-01; CT=2033-$CM-28 # a range nobody asked for in the last 5 minutes: the Worker caches per range
[ "$(code "$B/api/kelly/calendar?to=$CT")" = 400 ] || fail "calendar without from not 400"
[ "$(code "$B/api/kelly/calendar?from=$CT&to=$CF")" = 400 ] || fail "calendar from > to not 400"
[ "$(code "$B/api/kelly/calendar?from=2033-02-30&to=2033-03-02")" = 400 ] || fail "calendar accepted 2033-02-30"
[ "$(code "$B/api/kelly/calendar?from=2033-01-01&to=2033-03-04")" = 400 ] || fail "calendar accepted 63 days"
[ "$(code "$B/api/kelly/brief?date=2033-13-01")" = 400 ] || fail "brief accepted a bad date"
C0=$(curl -s localhost:8791/cal-hits | js d.hits)
CR=$(kc $CF $CT)
[ "$(echo "$CR" | js 'd.events.length===2 && d.events[0].title.length===200 && d.events[0].start.startsWith("'$CF'") && d.events[1].all_day===true && Object.keys(d).join()==="events"')" = true ] || fail "calendar did not come through capped and cleaned"
kc $CF $CT >/dev/null; [ "$(curl -s localhost:8791/cal-hits | js d.hits)" = $((C0 + 1)) ] || fail "second calendar call was not served from the Worker cache"
[ "$(kc 2000-01-02 2000-01-30 | js d.events.length)" = 500 ] || fail "calendar events not capped at 500"
kc 2000-01-03 2000-01-30 | grep -q '"unavailable":true' || fail "relay 500 is not unavailable (calendar)"
kset '{"enabled":true,"scopes":["compass:write.tasks"]}'
kc $CF $CT | grep -q '"unavailable":true' || fail "calendar served without compass:read.tasks (cache not behind the gate)"
kset '{"enabled":false,"scopes":["compass:read.tasks"]}'
kc $CF $CT | grep -q '"unavailable":true' || fail "cached calendar served after Kelly was switched off"
[ "$(code "$B/api/kelly/calendar?from=$CT&to=$CF")" = 400 ] || fail "calendar validation skipped while off"
kput '{"enabled":false}' >/dev/null; kb 2026-10-21 | grep -q '"unavailable":true' || fail "brief answered after Kelly was switched off"
kb $BD | grep -q '"unavailable":true' || fail "cached brief served after Kelly was switched off"
# Document hand-off (Task 4): "also let Kelly search it" reaches the stub only for a personal document of no project or a live cloud project, and only when the import held.
kd() { curl -s localhost:8791/docs | js "d.docs.$1"; }
kimp() { curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/library/import -d "{\"document_id\":\"$1\"$2}"; }
kdoc() { up "@scripts/fixtures/hello.pdf;type=application/pdf" "${@:2}" | head -1 | js d.document.id; }
KPR=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke kelly personal","kind":"personal"}' | js d.project.id)
KWK=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke kelly work","kind":"work"}' | js d.project.id)
KOF=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke kelly offline","kind":"personal"}' | js d.project.id)
curl "${H[@]}" -X PATCH $B/api/projects/$KOF -d '{"data_boundary":"offline"}' >/dev/null
K0=$(kd length)
KD1=$(kdoc x -F "project_id=$KPR"); KD2=$(kdoc x); KD3=$(kdoc x -F "project_id=$KWK"); KD4=$(kdoc x -F "project_id=$KOF"); KD5=$(kdoc x -F "project_id=$KPR"); KD6=$(kdoc x -F "project_id=$KPR")
R1=$(kimp $KD1 ''); [ "$(printf '%s' "$R1" | tail -1)" = 201 ] && ! printf '%s' "$R1" | head -1 | grep -q '"kelly"' || fail "import without also_kelly: $R1"
[ "$(kd length)" = "$K0" ] || fail "a plain import reached Kelly"
R2=$(kimp $KD1 ',"also_kelly":true'); [ "$(printf '%s' "$R2" | tail -1)" = 201 ] && [ "$(printf '%s' "$R2" | head -1 | js d.kelly)" = sent ] || fail "personal import with also_kelly: $R2"
[ "$(kd length)" = $((K0 + 1))  ] && [ "$(kd 'at(-1).name')" = hello.pdf ] && [ "$(kd 'at(-1).head')" = %PDF ] && [ "$(kd 'at(-1).size')" -gt 100 ] || fail "the stub did not get the file"
R3=$(kimp $KD2 ',"also_kelly":true'); [ "$(printf '%s' "$R3" | head -1 | js d.kelly)" = sent ] && [ "$(kd length)" = $((K0 + 2)) ] || fail "unfiled personal document not handed over: $R3"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE actor='you' AND action='kelly.document' AND target='$KD1' AND detail='{\"ok\":true}'" | js 'd[0].results[0].n')" = 1 ] || fail "kelly.document not audited once with no content"
[ "$(kimp $KD3 ',"also_kelly":true' | tail -1)" = 403 ] && [ "$(kd length)" = $((K0 + 2)) ] || fail "work document reached Kelly (or import not refused)"
[ "$(kimp $KD4 ',"also_kelly":true' | tail -1)" = 409 ] && [ "$(kd length)" = $((K0 + 2)) ] || fail "offline-project document reached Kelly (or import not refused)"
[ "$(kimp $KD1 ',"also_kelly":"yes"' | tail -1)" = 400 ] || fail "also_kelly accepted a string"
curl "${H[@]}" -X DELETE $B/api/documents/$KD5 >/dev/null
[ "$(kimp $KD5 ',"also_kelly":true' | tail -1)" = 404 ] && [ "$(kd length)" = $((K0 + 2)) ] || fail "trashed document reached Kelly"
curl "${H[@]}" -X PATCH $B/api/documents/$KD6 -d '{"name":"kelly-refuse.pdf"}' >/dev/null
R6=$(kimp $KD6 ',"also_kelly":true'); [ "$(printf '%s' "$R6" | tail -1)" = 201 ] && [ "$(printf '%s' "$R6" | head -1 | js d.kelly)" = failed ] && printf '%s' "$R6" | head -1 | grep -q '"page"' || fail "a refusing relay failed the import: $R6"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE action='kelly.document' AND target='$KD6' AND detail='{\"ok\":false}'" | js 'd[0].results[0].n')" = 1 ] || fail "failed hand-off not audited"
for x in $KD1 $KD2 $KD3 $KD4 $KD6; do curl "${H[@]}" -X DELETE $B/api/documents/$x >/dev/null; done
for x in $(curl "${H[@]}" $B/api/library/imports | js "d.pages.filter(p=>p.title.startsWith('hello')||p.title.startsWith('kelly-refuse')).map(p=>p.slug).join(' ')"); do curl "${H[@]}" -X DELETE $B/api/library/$x >/dev/null; done
for x in $KPR $KWK $KOF; do curl "${H[@]}" -X DELETE $B/api/projects/$x >/dev/null; done
D1X "DELETE FROM audit_log WHERE action='kelly.document'" >/dev/null
echo "smoke: (z2) kelly document hand-off: personal and unfiled reach the stub; plain, work, offline, trashed never; a refusing relay leaves the import done"
kill $STUB; wait $STUB 2>/dev/null || true; trap - EXIT
echo "smoke: (z) kelly: PUT validated + audited, brief and calendar gated (off / no scope), via the relay, capped, cached, log shows tasks while they exist"
kset '{"enabled":false,"scopes":[]}'; D1X "DELETE FROM audit_log WHERE actor='kelly' AND action LIKE 'agent.%'" >/dev/null
curl -s -o /dev/null -w '%{http_code}' $B/api/tasks | grep -q 401 || fail "guard (no cookie)"
echo "smoke: ok"
