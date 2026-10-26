#!/usr/bin/env bash
# End-to-end against a local wrangler dev (DEV_LOGIN=1 in .dev.vars). Signs in, makes a project, a task, moves it, trashes and restores it; then posts to the inbox with the local test secrets from .dev.vars (never .secrets/).
set -euo pipefail
B=${BASE:-http://localhost:8790}; J=/tmp/compass-smoke.jar; rm -f $J
H=(-s -b $J -c $J -H "Origin: $B" -H "Content-Type: application/json")
T0=$(date -u +%Y-%m-%dT%H:%M:%S.000Z) # rows made before this are not the smoke's: its cleanup (end of file) only touches rows created at or after it
unpark() { [ -z "${PARK:-}" ] || D1X "UPDATE tasks SET deleted_at = NULL WHERE deleted_at = '$PARK'" >/dev/null; PARK=; }
fail() { unpark; declare -F restore_quiet >/dev/null && restore_quiet; echo "smoke: FAIL $1"; exit 1; }
# The hourly AI limits count the local ai_usage rows, so a run starts from none. Local only: --local touches the dev D1 file, never a remote database, and a non-local BASE is refused.
case "$B" in http://localhost:*|http://127.0.0.1:*) ;; *) fail "BASE must be a local wrangler dev (got $B)";; esac
npx wrangler d1 execute compass-db --local --command "DELETE FROM ai_usage" >/dev/null 2>&1 || fail "could not clear the local ai_usage"
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
# Phase 5b Task 1: Athena reads any document (stub). An xlsx and a png go in through the documents pipeline; the boundary refuses everything else before anything is stored.
AD=$(mktemp -d)
node --input-type=module -e "
import { zipSync, strToU8 } from 'fflate'; import { writeFileSync } from 'node:fs';
const wb = zipSync({ 'xl/workbook.xml': strToU8('<workbook xmlns:r=\"r\"><sheets><sheet name=\"Sheet1\" r:id=\"rId1\"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/></Relationships>'),
  'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r=\"1\"><c r=\"A1\"><v>10</v></c><c r=\"B1\"><f>A1*2</f><v>20</v></c></row></sheetData></worksheet>') });
writeFileSync('$AD/book.xlsx', wb);
writeFileSync('$AD/dot.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
writeFileSync('$AD/data.csv', 'a,b\n1,2\n');" || fail "could not build the attachment fixtures"
XLSX_T=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
AP1=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke athena personal","kind":"personal"}' | js d.project.id)
AW=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke athena work","kind":"work"}' | js d.project.id)
AO=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke athena offline","kind":"personal"}' | js d.project.id)
XU=$(up "@$AD/book.xlsx;type=$XLSX_T" -F "project_id=$AP1"); [ "$(printf '%s' "$XU" | tail -1)" = 201 ] || fail "xlsx upload: $XU"; AX=$(printf '%s' "$XU" | head -1 | js d.document.id)
PU=$(up "@$AD/dot.png;type=image/png" -F "project_id=$AP1"); [ "$(printf '%s' "$PU" | tail -1)" = 201 ] || fail "png upload: $PU"; APN=$(printf '%s' "$PU" | head -1 | js d.document.id)
CU=$(up "@$AD/data.csv;type=text/csv" -F "project_id=$AP1"); [ "$(printf '%s' "$CU" | tail -1)" = 201 ] || fail "csv upload: $CU"; ACS=$(printf '%s' "$CU" | head -1 | js d.document.id)
WU=$(up "@$AD/data.csv;type=text/csv" -F "project_id=$AW"); [ "$(printf '%s' "$WU" | tail -1)" = 201 ] || fail "work csv upload: $WU"; AWD=$(printf '%s' "$WU" | head -1 | js d.document.id)
OU=$(up "@$AD/data.csv;type=text/csv" -F "project_id=$AO"); [ "$(printf '%s' "$OU" | tail -1)" = 201 ] || fail "offline csv upload: $OU"; AOD=$(printf '%s' "$OU" | head -1 | js d.document.id)
FU=$(up "@$AD/data.csv;type=text/csv"); [ "$(printf '%s' "$FU" | tail -1)" = 201 ] || fail "unfiled csv upload: $FU"; AFD=$(printf '%s' "$FU" | head -1 | js d.document.id)
[ "$(up "@$AD/dot.png;type=image/jpeg" | tail -1)" = 400 ] || fail "a png declared as jpeg was accepted"
curl "${H[@]}" -X PATCH $B/api/projects/$AO -d '{"data_boundary":"offline"}' >/dev/null
AC=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/ai/chat -d "{\"project_id\":\"$AP1\",\"preset\":\"optimize_spreadsheet\",\"message\":\"Optimize this workbook\",\"document_ids\":[\"$AX\"]}")
[ "$(printf '%s' "$AC" | tail -1)" = 200 ] || fail "chat with an xlsx: $AC"
ACJ=$(printf '%s' "$AC" | head -1); ATH=$(printf '%s' "$ACJ" | js d.thread.id)
printf '%s' "$ACJ" | js 'd.messages[1].content.includes("<<<data document book.xlsx")&&d.messages[1].content.includes("Sheet1!B1: =A1*2 → 20")&&d.messages[1].content.includes("[stub: 0 image(s)]")' | grep -q true || fail "the stub did not see the fenced workbook: $ACJ"
printf '%s' "$ACJ" | js "d.messages[0].content.includes('[[attachments]]')&&d.messages[0].content.includes('$AX')&&!d.messages[0].content.includes('Sheet1!')" | grep -q true || fail "the stored question should hold the attachment, not its text"
[ "$(curl "${H[@]}" $B/api/ai/threads/$ATH | js 'JSON.stringify(d.messages[0].content).includes("Sheet1!")')" = false ] || fail "extracted text was stored"
curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"thread_id\":\"$ATH\",\"rerun\":true}" | js 'd.messages[0].content.includes("<<<data document book.xlsx")' | grep -q true || fail "a rerun lost its document"
IM=$(curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"project_id\":\"$AP1\",\"message\":\"What is this?\",\"document_ids\":[\"$APN\",\"$ACS\"]}")
printf '%s' "$IM" | js 'd.messages[1].content.includes("[stub: 1 image(s)]")&&d.messages[1].content.includes("<<<data document data.csv")&&!d.messages[1].content.includes("<<<data document dot.png")' | grep -q true || fail "the stub did not report one image: $IM"
N0=$(NMSG); AUSE=$(D1X "SELECT count(*) AS n FROM ai_usage" | js 'd[0].results[0].n')
refused() { # what, body: 409 document_boundary
  local r; r=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/ai/chat -d "$2")
  [ "$(printf '%s' "$r" | tail -1)" = 409 ] && printf '%s' "$r" | grep -q '"error":"document_boundary"' || fail "$1 not refused: $r"
}
refused "an offline project's document" "{\"message\":\"x\",\"document_ids\":[\"$AOD\"]}"
refused "a work document in a personal chat" "{\"message\":\"x\",\"document_ids\":[\"$AWD\"]}"
refused "another project's document" "{\"project_id\":\"$AP1\",\"message\":\"x\",\"document_ids\":[\"$AWD\"]}"
refused "an unfiled document in a project chat" "{\"project_id\":\"$AP1\",\"message\":\"x\",\"document_ids\":[\"$AFD\"]}"
refused "a document that does not exist" "{\"message\":\"x\",\"document_ids\":[\"nope\"]}"
curl "${H[@]}" -X DELETE $B/api/documents/$ACS >/dev/null
refused "a trashed document" "{\"project_id\":\"$AP1\",\"message\":\"x\",\"document_ids\":[\"$ACS\"]}"
MORE="{\"project_id\":\"$AP1\",\"message\":\"x\",\"document_ids\":[\"$AX\",\"$AX\",\"$APN\",\"a\",\"b\"]}" # four distinct ids
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/ai/chat -d "$MORE")" = 400 ] || fail "more than 3 documents"
[ "$(NMSG)" = "$N0" ] || fail "a refusal stored rows ($N0 -> $(NMSG))"
[ "$(D1X "SELECT count(*) AS n FROM ai_usage" | js 'd[0].results[0].n')" = "$AUSE" ] || fail "a refusal made a model call"
FREE="{\"message\":\"x\",\"document_ids\":[\"$AFD\"]}"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/ai/chat -d "$FREE")" = 200 ] || fail "an unfiled document in a personal chat"
echo "smoke: (p3) athena: xlsx -> fenced workbook in the stub, the stored question keeps names and ids only, a rerun keeps its document, png -> 1 image; offline, work-in-personal, other-project, unfiled-in-project, missing, trashed -> 409 document_boundary with nothing stored and no model call; more than 3 -> 400"
for x in $AX $APN $AWD $AOD $AFD; do curl "${H[@]}" -X DELETE $B/api/documents/$x >/dev/null; done
for x in $AP1 $AW $AO; do curl "${H[@]}" -X DELETE $B/api/projects/$x >/dev/null; done; rm -rf $AD
# Phase 5b Task 3: Athena's clips (private R2, served with Range): upload checks, 206 slices, 416, the 415s, Trash and the purge of the file.
AM=$(mktemp -d); { printf '\000\000\000\030ftypisom\000\000\002\000isomiso2'; head -c 480 /dev/zero; } > $AM/c.mp4; printf '%%PDF-1.7 not a video' > $AM/fake.mp4; ASZ=$(wc -c < $AM/c.mp4 | tr -d ' ')
clip() { curl -s -w '\n%{http_code}' -b $J -c $J -H "Origin: $B" -H "Content-Type: ${CT:-video/mp4}" -H "X-File-Name: $2" --data-binary @$1 "$B/api/athena/clips?state=${3:-idle}"; }
CU=$(clip $AM/c.mp4 'idle%201.mp4'); [ "$(printf '%s' "$CU" | tail -1)" = 201 ] || fail "clip upload: $CU"; AC1=$(printf '%s' "$CU" | head -1 | js d.clip.id)
printf '%s' "$CU" | head -1 | js 'd.clip.state==="idle"&&d.clip.name==="idle 1.mp4"&&d.clip.bytes==='$ASZ'&&!("r2_key" in d.clip)' | grep -q true || fail "clip row: $CU"
curl "${H[@]}" $B/api/athena/clips | js "d.clips.some(c=>c.id==='$AC1')&&d.portrait_id===null" | grep -q true || fail "clip list"
curl -s -D $AM/h -o $AM/b -b $J -H "Range: bytes=0-9" $B/api/athena/media/$AC1; head -1 $AM/h | grep -q 206 || fail "range status"
[ "$(wc -c < $AM/b | tr -d ' ')" = 10 ] && [ "$(head -c 10 $AM/c.mp4 | cmp - $AM/b; echo $?)" = 0 ] || fail "range body"
tr -d '\r' < $AM/h | grep -qi "^content-range: bytes 0-9/$ASZ$" && grep -qi '^accept-ranges: bytes' $AM/h && grep -qi '^content-type: video/mp4' $AM/h && grep -qi '^cache-control: private, max-age=86400' $AM/h || fail "range headers"
curl -s -D $AM/h -o $AM/b -b $J -H "Range: bytes=-5" $B/api/athena/media/$AC1; [ "$(wc -c < $AM/b | tr -d ' ')" = 5 ] && head -1 $AM/h | grep -q 206 || fail "suffix range"
curl -s -D $AM/h -o $AM/b -b $J $B/api/athena/media/$AC1; head -1 $AM/h | grep -q 200 && [ "$(wc -c < $AM/b | tr -d ' ')" = "$ASZ" ] && grep -qi '^accept-ranges: bytes' $AM/h || fail "full GET"
curl -s -D $AM/h -o /dev/null -b $J -H "Range: bytes=$ASZ-" $B/api/athena/media/$AC1; head -1 $AM/h | grep -q 416 && tr -d '\r' < $AM/h | grep -qi "^content-range: bytes \*/$ASZ$" || fail "416"
[ "$(curl -s -o /dev/null -w '%{http_code}' -b $J -H 'Range: bytes=0-1,4-5' $B/api/athena/media/$AC1)" = 416 ] || fail "two ranges"
[ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/athena/media/$AC1)" = 401 ] || fail "media without a cookie"
ANL() { D1X "SELECT count(*) AS n FROM athena_clips" | js 'd[0].results[0].n'; }; ANB=$(ANL)
[ "$(CT=text/plain clip $AM/c.mp4 x.mp4 | tail -1)" = 415 ] || fail "wrong type was not 415"
[ "$(clip $AM/fake.mp4 fake.mp4 | tail -1)" = 415 ] || fail "a non-mp4 body declared video/mp4 was accepted"
[ "$(clip $AM/c.mp4 x.mp4 dancing | tail -1)" = 400 ] || fail "a bad state was accepted"
[ "$(curl -s -o /dev/null -w '%{http_code}' -b $J -H "Origin: $B" -H 'Content-Type: video/mp4' -H 'X-File-Name: c.mp4' -H 'Transfer-Encoding: chunked' --data-binary @$AM/c.mp4 "$B/api/athena/clips?state=idle")" = 411 ] || fail "a chunked upload was not 411"
{ cat $AM/c.mp4; head -c $((15 * 1024 * 1024)) /dev/zero; } > $AM/big.mp4
[ "$(curl -s -o /dev/null -w '%{http_code}' -b $J -H "Origin: $B" -H 'Content-Type: video/mp4' -H 'X-File-Name: big.mp4' --data-binary @$AM/big.mp4 "$B/api/athena/clips?state=idle")" = 413 ] || fail "an oversize clip was not 413"
[ "$(ANL)" = "$ANB" ] || fail "a refused upload left a row"
printf '\211PNG\r\n\032\n' > $AM/p.png; head -c 300 /dev/zero >> $AM/p.png
PU=$(curl -s -w '\n%{http_code}' -b $J -H "Origin: $B" -H 'Content-Type: image/png' -H 'X-File-Name: her.png' --data-binary @$AM/p.png $B/api/athena/portrait); [ "$(printf '%s' "$PU" | tail -1)" = 201 ] || fail "portrait: $PU"; APID=$(printf '%s' "$PU" | head -1 | js d.portrait_id)
curl "${H[@]}" $B/api/athena/clips | js "d.portrait_id==='$APID'&&!d.clips.some(c=>c.id==='$APID')" | grep -q true || fail "portrait id not reported"
curl "${H[@]}" $B/api/settings | js "d.athena.portrait_id==='$APID'&&d.athena.voice_id===null&&d.athena.speak_answers===false" | grep -q true || fail "athena settings"
[ "$(curl -s -o /dev/null -w '%{http_code}' -b $J -H "Origin: $B" -H 'Content-Type: image/jpeg' --data-binary @$AM/p.png $B/api/athena/portrait)" = 415 ] || fail "a png declared jpeg was accepted"
curl "${H[@]}" -X PATCH $B/api/settings -d '{"athena":{"voice_id":"abc123","speak_answers":true,"portrait_id":"hacked"}}' | js 'd.athena.voice_id==="abc123"&&d.athena.speak_answers===true&&d.athena.portrait_id==="'$APID'"' | grep -q true || fail "settings patch (portrait_id must stay put)"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/settings -d '{"athena":{"voice_id":"a b/../c"}}')" = 400 ] || fail "a bad voice id was accepted"
curl "${H[@]}" -X PATCH $B/api/settings -d '{"athena":{"voice_id":null,"speak_answers":false}}' >/dev/null
curl "${H[@]}" -X DELETE $B/api/athena/portrait | grep -q '"ok":true' || fail "portrait delete"
curl "${H[@]}" -X DELETE $B/api/athena/clips/$AC1 | grep -q '"ok":true' || fail "clip delete"
[ "$(curl -s -o /dev/null -w '%{http_code}' -b $J $B/api/athena/media/$AC1)" = 404 ] || fail "a removed clip is still served"
[ "$(D1X "SELECT count(*) AS n FROM athena_clips WHERE id='$AC1' AND deleted_at IS NOT NULL" | js 'd[0].results[0].n')" = 1 ] || fail "a removed clip was hard-deleted"
npx wrangler r2 object get compass-files/athena/$AC1 --local --file $AM/still >/dev/null 2>&1 || fail "the removed clip's file went before the purge"
D1X "UPDATE athena_clips SET deleted_at='2020-01-01T00:00:00.000Z' WHERE id IN ('$AC1','$APID')" >/dev/null
curl -s "http://localhost:8790/cdn-cgi/handler/scheduled?cron=*%2F15+*+*+*+*" >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do [ "$(D1X "SELECT count(*) AS n FROM athena_clips WHERE id IN ('$AC1','$APID')" | js 'd[0].results[0].n')" = 0 ] && break; sleep 1; done
[ "$(D1X "SELECT count(*) AS n FROM athena_clips WHERE id IN ('$AC1','$APID')" | js 'd[0].results[0].n')" = 0 ] || fail "the purge left the clip rows"
! npx wrangler r2 object get compass-files/athena/$AC1 --local --file $AM/gone >/dev/null 2>&1 || fail "the purge left the clip's file in R2"
rm -rf $AM
echo "smoke: (a3) athena clips: upload (mp4 only, first bytes, 15 MB, 411/413/415), Range 206/416 with Content-Range, full GET 200, portrait, settings patch, soft delete, purge removes the R2 file"
# (a4) Athena's voice on the stub (AI_STUB=1: a silent mp3 and "stub transcript", usage rows written as if billed; ElevenLabs never called).
AV=$(mktemp -d)
VU() { D1X "SELECT count(*) AS n FROM ai_usage WHERE feature='$1'" | js 'd[0].results[0].n'; }
speak() { curl -s -D $AV/h -o $AV/$2 -w '%{http_code}' -b $J -H "Origin: $B" -H 'Content-Type: application/json' -X POST $B/api/athena/speak -d "$1"; }
SPP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke voice personal","kind":"personal"}' | js d.project.id)
SWP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke voice work","kind":"work"}' | js d.project.id)
curl "${H[@]}" -X PATCH $B/api/projects/$SWP -d '{"data_boundary":"cloud"}' | grep -q '"data_boundary":"cloud"' || fail "voice work project to cloud" # work projects start Offline only
SPC=$(curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"project_id\":\"$SPP\",\"message\":\"Smoke personal voice\"}")
SPA=$(printf '%s' "$SPC" | js 'd.messages[1].id'); SPQ=$(printf '%s' "$SPC" | js 'd.messages[0].id')
[ "$(speak "{\"message_id\":\"$SPA\"}" off)" = 409 ] && grep -q '"error":"voice_off"' $AV/off || fail "no voice picked: not voice_off"
curl "${H[@]}" -X PATCH $B/api/settings -d '{"athena":{"voice_id":"SmokeVoice1","speak_answers":true}}' >/dev/null
V0=$(VU athena_voice)
[ "$(speak "{\"message_id\":\"$SPA\"}" a1.mp3)" = 200 ] && grep -qi '^content-type: audio/mpeg' $AV/h || fail "speak a personal answer"
[ "$(head -c 2 $AV/a1.mp3 | xxd -p)" = fffb ] && [ "$(wc -c < $AV/a1.mp3 | tr -d ' ')" -lt 5120 ] || fail "the stub's audio is not a short mp3"
[ "$(VU athena_voice)" = $((V0 + 1)) ] || fail "speak wrote no usage row"
[ "$(speak "{\"message_id\":\"$SPA\"}" a2.mp3)" = 200 ] && cmp -s $AV/a1.mp3 $AV/a2.mp3 || fail "replay"
[ "$(VU athena_voice)" = $((V0 + 1)) ] || fail "a replay was billed again (not served from R2)"
npx wrangler r2 object get compass-files/athena-tts/$SPA --local --file $AV/r2 >/dev/null 2>&1 && cmp -s $AV/r2 $AV/a1.mp3 || fail "the personal answer's audio is not cached plain in R2"
[ "$(speak "{\"message_id\":\"$SPQ\"}" q)" = 400 ] || fail "a question was read aloud"
[ "$(speak '{"message_id":"nope"}' n)" = 404 ] || fail "a missing message"
SW=$(curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"project_id\":\"$SWP\",\"message\":\"Smoke work voice\"}" | js 'd.messages[1].id')
[ "$(speak "{\"message_id\":\"$SW\"}" w.mp3)" = 200 ] && [ "$(head -c 2 $AV/w.mp3 | xxd -p)" = fffb ] || fail "speak a work answer"
npx wrangler r2 object get compass-files/athena-tts/$SW --local --file $AV/wr2 >/dev/null 2>&1 && ! cmp -s $AV/wr2 $AV/w.mp3 && [ "$(head -c 2 $AV/wr2 | xxd -p)" != fffb ] || fail "the work answer's audio is not sealed in R2"
VW=$(VU athena_voice)
[ "$(speak "{\"message_id\":\"$SW\"}" w2.mp3)" = 200 ] && cmp -s $AV/w.mp3 $AV/w2.mp3 && [ "$(VU athena_voice)" = "$VW" ] || fail "a sealed work answer's replay (opened from R2, not billed)"
curl "${H[@]}" -X PATCH $B/api/settings -d '{"athena":{"voice_id":"SmokeVoice2"}}' >/dev/null
[ "$(speak "{\"message_id\":\"$SPA\"}" a3.mp3)" = 200 ] && [ "$(VU athena_voice)" = $((VW + 1)) ] || fail "a new voice did not speak the answer again"
SOP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke voice offline","kind":"personal"}' | js d.project.id)
SO=$(curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"project_id\":\"$SOP\",\"message\":\"Smoke offline voice\"}" | js 'd.messages[1].id')
curl "${H[@]}" -X PATCH $B/api/projects/$SOP -d '{"data_boundary":"offline"}' >/dev/null
V1=$(VU athena_voice)
[ "$(speak "{\"message_id\":\"$SO\"}" o)" = 409 ] && grep -q '"error":"offline_boundary"' $AV/o || fail "an Offline-only answer was read aloud"
[ "$(VU athena_voice)" = "$V1" ] || fail "an Offline-only refusal was billed"
curl "${H[@]}" -X PATCH $B/api/projects/$SPP -d '{"data_boundary":"offline"}' >/dev/null # its answer is already cached: the cache must not be served
[ "$(speak "{\"message_id\":\"$SPA\"}" oc)" = 409 ] && grep -q '"error":"offline_boundary"' $AV/oc || fail "a cached answer was served after its project went Offline only"
curl "${H[@]}" -X PATCH $B/api/projects/$SPP -d '{"data_boundary":"cloud"}' >/dev/null
[ "$(speak '{"test":true}' t.mp3)" = 200 ] && [ "$(VU athena_voice)" = $((V1 + 1)) ] || fail "voice test"
[ "$(speak '{"test":true,"voice_id":"a b/../c"}' tb)" = 400 ] || fail "a bad test voice id"
printf '\x1a\x45\xdf\xa3smoke-webm-recording' > $AV/rec.webm; printf 'ID3not-a-recording' > $AV/rec.mp3
listen() { curl -s -o $AV/l -w '%{http_code}' -b $J -H "Origin: $B" -H "Content-Type: $1" -H "X-Duration-Ms: $2" ${4:+-H "$4"} --data-binary @$3 $B/api/athena/listen; }
L0=$(VU athena_listen)
[ "$(listen audio/webm 1500 $AV/rec.webm "X-Project-Id: $SOP")" = 409 ] && grep -q '"error":"offline_boundary"' $AV/l || fail "listen in an Offline-only project: $(cat $AV/l)"
[ "$(listen audio/webm 1500 $AV/rec.webm "X-Thread-Id: $(curl "${H[@]}" $B/api/ai/threads?project=$SOP | js 'd.threads[0].id')")" = 409 ] || fail "listen in an Offline-only thread"
[ "$(listen audio/webm 1500 $AV/rec.webm "X-Thread-Id: nope")" = 404 ] && [ "$(listen audio/webm 1500 $AV/rec.webm "X-Project-Id: nope")" = 404 ] || fail "listen with an unknown thread or project"
[ "$(VU athena_listen)" = "$L0" ] || fail "a boundary refusal was billed"
[ "$(listen audio/webm 1500 $AV/rec.webm "X-Thread-Id: $(curl "${H[@]}" $B/api/ai/threads?project=$SWP | js 'd.threads[0].id')")" = 200 ] && [ "$(js d.text < $AV/l)" = "stub transcript" ] || fail "listen in a cloud work thread"
L0=$(VU athena_listen)
[ "$(listen 'audio/webm;codecs=opus' 1500 $AV/rec.webm)" = 200 ] && [ "$(js d.text < $AV/l)" = "stub transcript" ] || fail "listen: $(cat $AV/l)"
[ "$(VU athena_listen)" = $((L0 + 1)) ] || fail "listen wrote no usage row"
[ "$(listen audio/webm 61000 $AV/rec.webm)" = 400 ] || fail "a recording over 60 s"
[ "$(listen audio/mp4 1500 $AV/rec.webm)" = 415 ] || fail "a webm declared mp4"
[ "$(listen audio/mpeg 1500 $AV/rec.mp3)" = 415 ] || fail "an mp3 upload"
head -c 2100000 /dev/zero > $AV/big.webm; [ "$(listen audio/webm 1500 $AV/big.webm)" = 413 ] || fail "a recording over 2 MB"
[ "$(VU athena_listen)" = $((L0 + 1)) ] || fail "a refused recording was billed"
[ "$(D1X "SELECT count(*) AS n FROM ai_usage WHERE feature IN ('athena_voice','athena_listen') AND provider='elevenlabs' AND at >= '$AT0'" | js 'd[0].results[0].n')" -ge 3 ] || fail "voice rows are not elevenlabs"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE action IN ('ai.athena_voice','ai.athena_listen') AND (detail LIKE '%stub transcript%' OR detail LIKE '%Stub answer%')" | js 'd[0].results[0].n')" = 0 ] || fail "voice audit rows hold content"
curl "${H[@]}" -X PATCH $B/api/settings -d '{"athena":{"voice_id":null,"speak_answers":false}}' >/dev/null
for x in $SOP $SPP $SWP; do curl "${H[@]}" -X DELETE $B/api/projects/$x >/dev/null; done
rm -rf $AV
echo "smoke: (a4) athena voice: voice_off without a voice; personal answer -> audio/mpeg, replay from R2 (no new usage row); work answer sealed in R2; work replay opened from R2 (not billed); a new voice speaks again; question 400; Offline-only 409 (not billed), cached answer refused once its project is Offline only; test line; listen: Offline-only project or thread 409, unknown 404 (none billed), cloud thread ok, stub transcript with one usage row; 60 s, type, first bytes and 2 MB refused"
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
# The brief reads every live task and the stub echoes only the first 4,000 characters, so the check must not depend on how many tasks the local dev D1 holds:
# park the live ones (a marker in deleted_at, undone right after the checks or by fail) and look at the smoke's own four.
PARK="parked-$R"; D1X "UPDATE tasks SET deleted_at = '$PARK' WHERE deleted_at IS NULL" >/dev/null
BO=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke brief offline","kind":"work"}' | js d.project.id)
BC=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke brief cloud","kind":"personal"}' | js d.project.id)
KTO=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke offline secret $R\",\"project_id\":\"$BO\",\"due_at\":\"2026-01-01\"}" | js d.task.id)
[ -n "$KTO" ] || fail "brief offline task"
KTC=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke cloud visible $R\",\"project_id\":\"$BC\",\"due_at\":\"2026-01-02\"}" | js d.task.id)
[ -n "$KTC" ] || fail "brief cloud task"
KTP=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke loose personal $R\",\"kind\":\"personal\",\"due_at\":\"2026-01-03\"}" | js d.task.id)
[ -n "$KTP" ] || fail "brief loose task"
KTW=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke loose work $R\",\"kind\":\"work\",\"due_at\":\"2026-01-04\"}" | js d.task.id)
[ -n "$KTW" ] || fail "brief loose work task"
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
unpark
for T in $KTO $KTC $KTP $KTW; do curl "${H[@]}" -X DELETE $B/api/tasks/$T >/dev/null; done # soft delete: the next run's counts must not include these
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
# The lookup Kelly makes before a done: a shared undated task answers (open, then done); hidden and subtasks are 404 like done.
UT=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke agent undated $R\"}" | js d.task.id)
[ "$(agb GET /tasks/$UT | js "d.task.id==='$UT' && d.task.title==='Smoke agent undated $R' && d.task.due_at===null && !('notes' in d.task)")" = true ] || fail "agent lookup of a shared undated task"
[ "$(agc GET /tasks/$OT)" = 404 ] || fail "agent lookup of a hidden task not 404"
[ "$(agc GET /tasks/$ST)" = 404 ] || fail "agent lookup of a subtask not 404"
[ "$(agc GET /tasks/no-such-task)" = 404 ] || fail "agent lookup of a missing task not 404"
[ "$(agc POST /tasks/$UT/done)" = 200 ] && [ "$(agb GET /tasks/$UT | js d.task.status)" = done ] || fail "agent lookup of a done task"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE actor='kelly' AND action='agent.tasks.get' AND target='$OT' AND detail LIKE '%not_found%'" | js 'd[0].results[0].n')" = 1 ] || fail "hidden lookup not audited as not_found"
[ "$(task $ST status)" = new ] || fail "agent finished a subtask"
A1=$(arows); agc GET /today >/dev/null; [ "$(arows)" = $((A1 + 1)) ] || fail "agent call did not write exactly one audit row"
# 2 creates and 2 dones are in: 26 more writes make 30, the 31st is refused.
for i in $(seq 26); do BULK="{\"title\":\"Smoke agent bulk $i $R\"}"; [ "$(agc POST /tasks "$BULK")" = 201 ] || fail "agent write $i refused early"; done
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
kput '{"scopes":["compass:read.tasks","compass:read.projects"]}' | grep -q 200 || fail "PUT scopes (2)"
kb $BD | grep -q 'water-bill' && [ "$(hits)" = $((H0 + 2)) ] || fail "a change to Kelly's access did not start the brief cache afresh"
[ "$(kb 2000-01-02 | js 'd.text.length<=1200 && d.text.startsWith("<script>")')" = true ] || fail "long relay text not capped (or HTML interpreted)"
kb 2000-01-03 | grep -q '"unavailable":true' || fail "relay 500 is not unavailable"
curl "${H[@]}" -o /dev/null -w '%{http_code}' "$B/api/kelly/log?limit=0" | grep -q 400 || fail "log limit 0 not 400"
LG=$(curl "${H[@]}" "$B/api/kelly/log?limit=100")
[ "$(echo "$LG" | js 'd.rows.length>=1 && d.rows.length<=100 && d.rows.every((r,i)=>r.actor==="kelly"||r.action==="kelly.scopes"||r.action==="kelly.document")')" = true ] || fail "log rows"
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
KD7=$(kdoc x -F "project_id=$KPR")
kset '{"enabled":false,"scopes":[]}' # Kelly's master switch off: the import holds, nothing goes to her, no relay call, no kelly.document row
R7=$(kimp $KD7 ',"also_kelly":true'); [ "$(printf '%s' "$R7" | tail -1)" = 201 ] && [ "$(printf '%s' "$R7" | head -1 | js d.kelly)" = off ] && printf '%s' "$R7" | head -1 | grep -q '"page"' || fail "also_kelly with Kelly off: $R7"
[ "$(kd length)" = "$K0" ] || fail "a document reached Kelly while she was switched off"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE action='kelly.document' AND target='$KD7'" | js 'd[0].results[0].n')" = 0 ] || fail "kelly.document audited with Kelly off"
kset '{"enabled":true,"scopes":[]}'
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
for x in $KD1 $KD2 $KD3 $KD4 $KD6 $KD7; do curl "${H[@]}" -X DELETE $B/api/documents/$x >/dev/null; done
for x in $(curl "${H[@]}" $B/api/library/imports | js "d.pages.filter(p=>p.title.startsWith('hello')||p.title.startsWith('kelly-refuse')).map(p=>p.slug).join(' ')"); do curl "${H[@]}" -X DELETE $B/api/library/$x >/dev/null; done
for x in $KPR $KWK $KOF; do curl "${H[@]}" -X DELETE $B/api/projects/$x >/dev/null; done
curl "${H[@]}" "$B/api/kelly/log?limit=100" | js "d.rows.some(r=>r.action==='kelly.document'&&r.target==='$KD1'&&r.detail.ok===true)" | grep -q true || fail "Kelly's activity does not show the document given to her"
D1X "DELETE FROM audit_log WHERE action='kelly.document'" >/dev/null
echo "smoke: (z2) kelly document hand-off: personal and unfiled reach the stub; plain, work, offline, trashed never; Kelly off sends nothing; a refusing relay leaves the import done"
kill $STUB; wait $STUB 2>/dev/null || true; trap - EXIT
echo "smoke: (z) kelly: PUT validated + audited, brief and calendar gated (off / no scope), via the relay, capped, cached, log shows tasks while they exist"
kset '{"enabled":false,"scopes":[]}'; D1X "DELETE FROM audit_log WHERE actor='kelly' AND action LIKE 'agent.%'" >/dev/null
# (a5) Split an email into tasks (Task 4b) on the stub: proposals only for an email whose project lets it go; accept makes the ticked tasks, marks the item added, writes events.
SRID=$(curl "${H[@]}" -X POST $B/api/rules -d "{\"name\":\"Smoke split $R\",\"app\":\"kelly\",\"mode\":\"inbox\",\"dedupe\":\"always\",\"sort\":1,\"match\":{\"title_regex\":\"smokesplit$R\"},\"then_set\":{}}" | js d.rule.id)
semail() { post "$KELLY" "{\"app\":\"kelly\",\"kind\":\"email\",\"title\":\"Smoke smokesplit$R $1\",\"ref\":\"smoke:split:$R:$1\",\"body\":\"Please send the budget by Friday and book the room.\",\"payload\":{\"from\":\"Ann\",\"account\":\"$2\"}}" | js d.id; }
sapi() { curl -s -o $AV/s -w '%{http_code}' -b $J -H "Origin: $B" -H 'Content-Type: application/json' -X POST $B/api/inbox/$1 -d "$2"; }
SU() { D1X "SELECT count(*) AS n FROM ai_usage WHERE feature='copilot'" | js 'd[0].results[0].n'; }
AV=$(mktemp -d)
SPE=$(semail personal me@gmail.com); SWE=$(semail work me@bell.ca)
[ -n "$SPE" ] && [ "$SPE" != null ] && [ -n "$SWE" ] && [ "$SWE" != null ] || fail "split: the emails did not land in the inbox"
SE() { D1X "SELECT count(*) AS n FROM tasks WHERE source_app='email' AND source_kind='email'" | js 'd[0].results[0].n'; }
SE0=$(SE); U0=$(SU)
[ "$(sapi $SPE/split '{}')" = 200 ] && [ "$(js 'd.proposals.length+","+d.proposals[0].due_at+","+d.proposals[2].due_at+","+d.proposals[2].horizon' < $AV/s)" = "3,2033-01-14,null,long" ] || fail "split of a personal email: $(cat $AV/s)"
[ "$(SU)" = $((U0 + 1)) ] || fail "split wrote no usage row"
[ "$(sapi $SWE/split '{}')" = 409 ] && grep -q '"error":"pick_cloud_project"' $AV/s || fail "work email without a project was not refused: $(cat $AV/s)"
SWP2=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke split work","kind":"work"}' | js d.project.id)
SPP2=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke split personal","kind":"personal"}' | js d.project.id)
[ "$(sapi $SWE/split "{\"project_id\":\"$SWP2\"}")" = 409 ] && grep -q '"error":"pick_cloud_project"' $AV/s || fail "work email into an Offline-only project was not refused"
[ "$(sapi $SWE/split "{\"project_id\":\"$SPP2\"}")" = 409 ] && grep -q '"error":"pick_cloud_project"' $AV/s || fail "work email into a personal project was not refused"
[ "$(sapi $SPE/split "{\"project_id\":\"$SWP2\"}")" = 409 ] && grep -q '"error":"offline_boundary"' $AV/s || fail "personal email into an Offline-only project was not refused"
[ "$(sapi $SPE/split '{"project_id":"nope"}')" = 400 ] || fail "split into an unknown project"
[ "$(SU)" = $((U0 + 1)) ] || fail "a refused split was billed or stored"
curl "${H[@]}" -X PATCH $B/api/projects/$SWP2 -d '{"data_boundary":"cloud"}' >/dev/null
[ "$(sapi $SWE/split "{\"project_id\":\"$SWP2\"}")" = 200 ] && [ "$(js d.proposals.length < $AV/s)" = 3 ] || fail "work email into a cloud work project: $(cat $AV/s)"
SNI=$(post "$KELLY" "{\"app\":\"kelly\",\"kind\":\"notification\",\"title\":\"Smoke smokesplit$R note\",\"ref\":\"smoke:split:$R:n\"}" | js d.id)
[ "$(sapi $SNI/split '{}')" = 400 ] || fail "a notification was split"
[ "$(sapi nope/split '{}')" = 404 ] || fail "split of a missing item"
TASKS='[{"title":"Send the budget","due_at":"2033-01-14","horizon":"short","notes":"From Ann."},{"title":"Book the room","due_at":null,"horizon":"medium","notes":null}]'
# an accept sends back the token its split returned (the item's updated_at): acc ITEM PROJECT-JSON TRASH [TOKEN]; the token defaults to the item's current one
tok() { curl "${H[@]}" "$B/api/inbox?state=all" | js "d.items.find(i=>i.id==='$1').updated_at"; }
acc() { local b="{\"project_id\":$2,\"trash_original\":$3,\"token\":\"${4:-$(tok $1)}\",\"tasks\":$TASKS}"; sapi "$1/split/accept" "$b"; }
[ "$(sapi $SPE/split/accept '{"tasks":[]}')" = 400 ] && [ "$(sapi $SPE/split/accept '{"tasks":[{"title":"x","due_at":"soon"}]}')" = 400 ] || fail "accept validation"
[ "$(acc $SWE null false)" = 409 ] || fail "work accept without a project"
[ "$(SE)" = "$SE0" ] || fail "a refused accept made tasks"
[ "$(acc $SPE null false)" = 201 ] && [ "$(js 'd.tasks.length+","+d.tasks[0].source_app+","+d.item.state' < $AV/s)" = "2,email,added" ] || fail "personal accept: $(cat $AV/s)"
SPT=$(js 'd.tasks.map(t=>t.id).join(" ")' < $AV/s); SPT1=${SPT%% *}
[ "$(task $SPT1 due_at)" = 2033-01-14 ] && [ "$(task $SPT1 kind)" = personal ] || fail "split task fields"
[ "$(curl "${H[@]}" "$B/api/inbox?state=all" | js "d.items.find(i=>i.id==='$SPE').state")" = added ] || fail "the email was not marked added"
[ "$(D1X "SELECT count(*) AS n FROM task_events WHERE type='created' AND task_id IN ('$(echo $SPT | sed "s/ /','/")')" | js 'd[0].results[0].n')" = 2 ] || fail "split tasks have no created events"
[ "$(curl "${H[@]}" "$B/api/inbox?state=all" | js "d.items.find(i=>i.id==='$SPE').task_id")" = "$SPT1" ] || fail "the added email does not point at the first new task"
[ "$(sapi $SPE/split '{}')" = 200 ] && [ "$(js d.can_trash_original < $AV/s)" = false ] || fail "an added email could not be split again, or offered to trash its first split task: $(cat $AV/s)"
[ "$(acc $SPE null true)" = 409 ] && grep -q '"error":"original_from_split"' $AV/s || fail "a second split trashing the first split's task was not refused: $(cat $AV/s)"
[ "$(acc $SPE null false)" = 201 ] && [ "$(js d.trashed < $AV/s)" = null ] || fail "a second accept (an added email may be split again, the first tasks stay): $(cat $AV/s)"
[ "$(D1X "SELECT count(*) AS n FROM tasks WHERE id IN ('$(echo $SPT | sed "s/ /','/")') AND deleted_at IS NULL" | js 'd[0].results[0].n')" = 2 ] || fail "the earlier split's tasks did not stay"
SPT="$SPT $(js 'd.tasks.map(t=>t.id).join(" ")' < $AV/s)"
[ "$(acc $SWE "\"$SWP2\"" false)" = 201 ] || fail "work accept: $(cat $AV/s)"
SWT=$(js 'd.tasks[0].id' < $AV/s)
[ "$(D1X "SELECT count(*) AS n FROM tasks WHERE id='$SWT' AND enc_v=2 AND title NOT LIKE '%budget%'" | js 'd[0].results[0].n')" = 1 ] || fail "a split work task is not ciphertext"
for x in $SPT $(js 'd.tasks.map(t=>t.id).join(" ")' < $AV/s); do curl "${H[@]}" -X DELETE $B/api/tasks/$x >/dev/null; done
for x in $SWP2 $SPP2; do curl "${H[@]}" -X DELETE $B/api/projects/$x >/dev/null; done
curl "${H[@]}" -X POST $B/api/inbox/$SNI/dismiss >/dev/null; curl "${H[@]}" -X DELETE $B/api/rules/$SRID >/dev/null; rm -rf $AV
echo "smoke: (a5) email split: proposals for personal and cloud-work email; work without a cloud work project, Offline-only, personal-kind refused (409, not billed); accept 2 of 3 -> 2 tasks, item added, events written, an added email can be split again but never offers to trash the earlier split's tasks (409 original_from_split); the earlier tasks stay; work tasks sealed"
# (a6) An email the default rule already turned into a task (Task 4b fix, ruling A18): split it, with the original moved to Trash or left, or refused when the original is done.
AV=$(mktemp -d)
dmail() { post "$KELLY" "{\"app\":\"kelly\",\"kind\":\"email\",\"title\":\"Smoke default $R $1\",\"ref\":\"smoke:default:$R:$1\",\"body\":\"Send the budget by Friday and book the room.\",\"payload\":{\"from\":\"Ann\",\"account\":\"me@gmail.com\"}}"; }
DM1=$(dmail one); DI1=$(printf '%s' "$DM1" | js d.id); DO1=$(printf '%s' "$DM1" | js d.task_id)
[ "$(printf '%s' "$DM1" | js d.state)" = added ] && [ -n "$DO1" ] && [ "$DO1" != null ] || fail "the default rule did not make a task from the email: $DM1"
[ "$(sapi $DI1/split '{}')" = 200 ] && [ "$(js 'd.proposals.length+","+d.can_trash_original' < $AV/s)" = "3,true" ] || fail "split of an email already made a task: $(cat $AV/s)"
[ "$(acc $DI1 null true)" = 201 ] || fail "accept with the original to Trash: $(cat $AV/s)"
DN1=$(js 'd.tasks[0].id' < $AV/s); DN2=$(js 'd.tasks[1].id' < $AV/s)
[ "$(js 'd.tasks.length+","+d.item.state+","+(d.item.task_id===d.tasks[0].id)+","+(d.trashed==="'$DO1'")' < $AV/s)" = "2,added,true,true" ] || fail "accept answer: $(cat $AV/s)"
[ "$(D1X "SELECT count(*) AS n FROM tasks WHERE id='$DO1' AND deleted_at IS NOT NULL" | js 'd[0].results[0].n')" = 1 ] || fail "the original task is not in Trash"
[ "$(curl "${H[@]}" "$B/api/inbox?state=all" | js "d.items.find(i=>i.id==='$DI1').task_id")" = "$DN1" ] || fail "the item does not point at the first new task"
[ "$(curl "${H[@]}" $B/api/inbox/by-task/$DN1 | js d.item.id)" = "$DI1" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' -b $J -H "Origin: $B" $B/api/inbox/by-task/$DO1)" = 404 ] || fail "by-task lookup"
curl "${H[@]}" -X POST $B/api/trash/tasks/$DO1/restore | grep -q '"ok":true' || fail "the trashed original could not be restored"
DM2=$(dmail two); DI2=$(printf '%s' "$DM2" | js d.id); DO2=$(printf '%s' "$DM2" | js d.task_id)
[ "$(acc $DI2 null false)" = 201 ] && DT2=$(js 'd.tasks.map(t=>t.id).join(" ")' < $AV/s) && [ "$(D1X "SELECT count(*) AS n FROM tasks WHERE id='$DO2' AND deleted_at IS NULL" | js 'd[0].results[0].n')" = 1 ] || fail "accept without the checkbox touched the original"
DM4=$(dmail four); DI4=$(printf '%s' "$DM4" | js d.id); DO4=$(printf '%s' "$DM4" | js d.task_id)
[ "$(sapi $DI4/split '{}')" = 200 ] && [ "$(js d.token < $AV/s)" = "$(tok $DI4)" ] || fail "the split did not return the item's token: $(cat $AV/s)"
T4=$(js d.token < $AV/s)
NOTOK="{\"project_id\":null,\"tasks\":$TASKS}"
[ "$(sapi $DI4/split/accept "$NOTOK")" = 400 ] || fail "accept without a token"
[ "$(acc $DI4 null false "$T4")" = 201 ] && DT4=$(js 'd.tasks.map(t=>t.id).join(" ")' < $AV/s) || fail "first accept with the token: $(cat $AV/s)"
[ "$(acc $DI4 null false "$T4")" = 409 ] && grep -q '"error":"already_split"' $AV/s || fail "a second accept with the same token was not refused: $(cat $AV/s)"
[ "$(D1X "SELECT count(*) AS n FROM task_events WHERE data LIKE '%$DI4%split%' AND type='created'" | js 'd[0].results[0].n')" = 2 ] || fail "two accepts with one token made more than one task set"
[ "$(acc $DI4 null false "$(tok $DI4)")" = 201 ] && DT4="$DT4 $(js 'd.tasks.map(t=>t.id).join(" ")' < $AV/s)" || fail "a fresh token did not allow a deliberate new split: $(cat $AV/s)"
DM3=$(dmail three); DI3=$(printf '%s' "$DM3" | js d.id); DO3=$(printf '%s' "$DM3" | js d.task_id)
curl "${H[@]}" -X POST $B/api/tasks/$DO3/done | grep -q '"status":"done"' || fail "done"
[ "$(sapi $DI3/split '{}')" = 409 ] && grep -q '"error":"original_done"' $AV/s || fail "split of an email whose task is done: $(cat $AV/s)"
[ "$(acc $DI3 null true)" = 409 ] || fail "accept for an email whose task is done"
for x in $DO1 $DO2 $DO3 $DO4 $DN1 $DN2 $DT2 $DT4; do curl "${H[@]}" -X DELETE $B/api/tasks/$x >/dev/null; done
rm -rf $AV
echo "smoke: (a6) split an email already made a task: original to Trash (restorable), item added and pointing at the first new task, by-task lookup; without the checkbox the original stays; a second accept with the same token -> 409 already_split, one task set, a fresh token splits again; a done original is refused (split and accept)"
# (k0) Knowledge, Task 0: collections, ingest, sealing, the compatibility rule, boundary change, Trash and purge order, export.
KS=$(mktemp -d); DOCX="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
node -e 'const f=require("fflate");const x=s=>f.strToU8(s);const p=(t,s)=>"<w:p>"+(s?"<w:pPr><w:pStyle w:val=\""+s+"\"/></w:pPr>":"")+"<w:r><w:t>"+t+"</w:t></w:r></w:p>";require("fs").writeFileSync(process.argv[1],f.zipSync({"word/document.xml":x("<w:document xmlns:w=\"x\"><w:body>"+p("Zebrafish budget risks","Heading1")+p("The vendor will slip the zebrafish milestone.")+"</w:body></w:document>")}))' $KS/k.docx
kj() { curl "${H[@]}" -w '\n%{http_code}' "$@"; }  # a JSON call: the body, then the status on the last line
kst() { printf '%s' "$1" | tail -1; }; kbody() { printf '%s' "$1" | head -1; }
kitem() { kj -X POST $B/api/knowledge/items -d "{\"collection_id\":\"$1\",\"document_id\":\"$2\"}"; }
KWC=$(kbody "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke zebrafish work","scope":"work"}')"); [ "$(printf '%s' "$KWC" | js 'd.collection.boundary+","+d.collection.scope')" = "locked,work" ] || fail "a work collection did not default to Locked: $KWC"
KW=$(printf '%s' "$KWC" | js d.collection.id)
KPC=$(kbody "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke personal","scope":"personal"}')"); KP=$(printf '%s' "$KPC" | js d.collection.id)
[ "$(printf '%s' "$KPC" | js d.collection.boundary)" = cloud ] || fail "a personal collection is not Cloud AI"
KWCC=$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke work cloud","scope":"work","boundary":"cloud"}'); [ "$(kst "$KWCC")" = 201 ] && [ "$(kbody "$KWCC" | js d.collection.boundary)" = cloud ] || fail "a work collection created as Cloud AI (dev session passes the step-up; scripts/knowledge.test.ts covers the decision): $KWCC"
curl "${H[@]}" -X DELETE $B/api/knowledge/collections/$(kbody "$KWCC" | js d.collection.id) >/dev/null
[ "$(kst "$(kj -X POST $B/api/knowledge/collections -d '{"name":"x","scope":"personal","boundary":"locked"}')")" = 400 ] && [ "$(kst "$(kj -X POST $B/api/knowledge/collections -d '{"name":"x","scope":"nope"}')")" = 400 ] && [ "$(kst "$(kj -X POST $B/api/knowledge/collections -d '{"scope":"work"}')")" = 400 ] || fail "collection validation"
[ "$(D1X "SELECT count(*) AS n FROM knowledge_collections WHERE id='$KW' AND enc_v=2 AND name NOT LIKE '%zebrafish%'" | js 'd[0].results[0].n')" = 1 ] || fail "a work collection name is not ciphertext"
[ "$(curl "${H[@]}" $B/api/knowledge/collections | js 'd.collections.filter(c=>c.id==="'$KW'"&&c.name==="Smoke zebrafish work").length')" = 1 ] || fail "collections list did not open the name"
# a work upload for the Knowledge screen: no project, sealed (name and R2 bytes)
KU=$(up "@$KS/k.docx;filename=k.docx;type=$DOCX" -F "knowledge_work=1"); [ "$(kst "$KU")" = 201 ] || fail "knowledge work upload: $KU"; KD=$(kbody "$KU" | js d.document.id)
[ "$(D1X "SELECT enc_v AS n FROM documents WHERE id='$KD' AND project_id IS NULL" | js 'd[0].results[0].n')" = 2 ] || fail "the knowledge work file's row is not sealed"
npx wrangler r2 object get compass-files/docs/$KD --local --file $KS/raw >/dev/null 2>&1 || fail "could not read the object"; head -c2 $KS/raw | grep -q PK && fail "the knowledge work file's bytes are unsealed"
curl "${H[@]}" $B/api/documents/$KD/file -o $KS/back; head -c2 $KS/back | grep -q PK || fail "the sealed knowledge file did not open"
KIT=$(kitem $KW $KD); [ "$(kst "$KIT")" = 201 ] || fail "work docx into the work collection: $KIT"; KI=$(kbody "$KIT" | js d.item.id)
[ "$(kbody "$KIT" | js 'd.item.state+","+(d.item.chunk_count>=1)+","+d.item.title')" = "ready,true,k.docx" ] || fail "a Locked item is not ready: $KIT"
[ "$(D1X "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$KI' AND enc_v=2 AND embedded=0 AND text NOT LIKE '%zebrafish%' AND locator NOT LIKE '%Zebrafish%'" | js 'd[0].results[0].n')" -ge 1 ] || fail "work passages are not ciphertext"
[ "$(D1X "SELECT count(*) AS n FROM knowledge_items WHERE id='$KI' AND enc_v=2 AND title != 'k.docx'" | js 'd[0].results[0].n')" = 1 ] || fail "a work item title is not ciphertext"
[ "$(curl "${H[@]}" $B/api/knowledge/collections/$KW/items | js 'd.items.length+","+d.items[0].title')" = "1,k.docx" ] || fail "items list"
# the compatibility rule
[ "$(kst "$(kitem $KW $KD)")" = 409 ] || fail "the same file twice"
kitem $KP $KD | grep -q '"error":"knowledge_boundary"' || fail "a sealed work upload into the personal collection"
KPW=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke knowledge work","kind":"work"}' | js d.project.id); KPP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke knowledge personal","kind":"personal"}' | js d.project.id)
KDW=$(up "@scripts/fixtures/hello.pdf;type=application/pdf" -F "project_id=$KPW" | head -1 | js d.document.id); KDP=$(up "@scripts/fixtures/hello.pdf;type=application/pdf" -F "project_id=$KPP" | head -1 | js d.document.id)
KDU=$(up "@$KS/k.docx;filename=plain.docx;type=$DOCX" | head -1 | js d.document.id) # unfiled and plain
kitem $KP $KDW | grep -q '"error":"knowledge_boundary"' || fail "a work-project file into the personal collection"
kitem $KW $KDP | grep -q '"error":"knowledge_boundary"' || fail "a personal-project file into the work collection"
kitem $KW $KDU | grep -q '"error":"knowledge_boundary"' || fail "an unfiled plain file into the work collection"
KIW=$(kitem $KW $KDW); [ "$(kst "$KIW")" = 201 ] || fail "a work-project pdf into the work collection: $KIW"
[ "$(kbody "$KIW" | js 'd.item.state')" = ready ] || fail "work pdf item not ready"; KIWI=$(kbody "$KIW" | js d.item.id)
[ "$(D1X "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$KIWI' AND enc_v=2 AND text NOT LIKE '%Hello%'" | js 'd[0].results[0].n')" -ge 1 ] || fail "the work pdf's passages are not ciphertext"
KIP=$(kitem $KP $KDP); [ "$(kst "$KIP")" = 201 ] || fail "a personal pdf into the personal collection: $KIP"
KIPI=$(kbody "$KIP" | js d.item.id); [ "$(kbody "$KIP" | js d.item.state)" = indexing ] || fail "a Cloud AI item is not indexing"
[ "$(D1X "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$KIPI' AND enc_v=0 AND locator='p. 1' AND text LIKE '%Hello Compass%'" | js 'd[0].results[0].n')" = 1 ] || fail "personal passage: plain text, locator p. 1" # embedded at once since Task 1 (k1)
[ "$(kst "$(kitem $KP $KDU)")" = 201 ] || fail "an unfiled plain docx into the personal collection"
[ "$(D1X "SELECT count(*) AS n FROM knowledge_chunks WHERE collection_id='$KP' AND locator='§ Zebrafish budget risks'" | js 'd[0].results[0].n')" = 1 ] || fail "a Word heading is not the locator"
echo "smoke: (k0) work collection sealed (name, title, passages) and Locked by default; the sealed upload (row and R2 bytes); work file -> work only, personal file -> personal only, unfiled plain -> personal only (409 knowledge_boundary); personal passages plain with p. N / § locators"
# boundary: personal stays Cloud; a work collection Locked -> Cloud AI (the dev session passes the step-up) re-indexes, and back
[ "$(kst "$(kj -X PATCH $B/api/knowledge/collections/$KP -d '{"boundary":"locked"}')")" = 400 ] || fail "a personal collection was Locked"
# a work project is Offline only until its boundary is switched: its file may sit in a Locked collection, but the collection cannot become Cloud AI
kj -X PATCH $B/api/knowledge/collections/$KW -d '{"boundary":"cloud"}' | grep -q '"error":"offline_boundary"' || fail "an Offline-only project's file in a collection made Cloud AI"
curl "${H[@]}" -X PATCH $B/api/projects/$KPW -d '{"data_boundary":"cloud"}' | grep -q '"data_boundary":"cloud"' || fail "project boundary switch"
curl "${H[@]}" -X PATCH $B/api/knowledge/collections/$KW -d '{"boundary":"cloud"}' | grep -q '"boundary":"cloud"' || fail "Locked -> Cloud AI"
[ "$(D1X "SELECT count(*) AS n FROM knowledge_items WHERE collection_id='$KW' AND state IN ('indexing','ready')" | js 'd[0].results[0].n')" = 2 ] || fail "Cloud AI items lost" # indexing, then ready once embedded (k1 checks the embedding)
curl "${H[@]}" -X PATCH $B/api/knowledge/collections/$KW -d '{"boundary":"locked","name":"Smoke zebrafish renamed"}' | grep -q '"boundary":"locked"' || fail "Cloud AI -> Locked"
[ "$(D1X "SELECT count(*) AS n FROM knowledge_items WHERE collection_id='$KW' AND state='ready'" | js 'd[0].results[0].n')" = 2 ] || fail "Locked did not make the items ready"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE action='knowledge.boundary' AND target='$KW'" | js 'd[0].results[0].n')" = 2 ] || fail "boundary changes were not audited"
[ "$(D1X "SELECT count(*) AS n FROM knowledge_collections WHERE id='$KW' AND name NOT LIKE '%zebrafish%'" | js 'd[0].results[0].n')" = 1 ] || fail "the renamed work collection is not ciphertext"
echo "smoke: (k0) boundary: personal stays Cloud AI; Locked -> Cloud AI -> Locked re-indexes and is audited (step-up passes in the dev session, as for projects)"
# export opens the work passages; Trash lists, restores, and purges in order
[ "$(curl "${H[@]}" $B/api/export | js 'd.knowledge_chunks.some(c=>c.text.includes("zebrafish")&&c.locator.startsWith("§"))&&d.knowledge_collections.some(c=>c.name==="Smoke zebrafish renamed")&&d.knowledge_items.some(i=>i.title==="k.docx")')" = true ] || fail "export did not open the knowledge tables"
curl "${H[@]}" -X DELETE $B/api/knowledge/items/$KI | grep -q '"ok":true' || fail "item trash"
curl "${H[@]}" -X DELETE $B/api/knowledge/collections/$KP | grep -q '"ok":true' || fail "collection trash (dev step-up)"
[ "$(curl "${H[@]}" $B/api/trash | js 'd.knowledge_items.some(i=>i.id==="'$KI'"&&i.title==="k.docx"&&i.collection_name==="Smoke zebrafish renamed")&&d.knowledge_collections.some(c=>c.id==="'$KP'"&&c.name==="Smoke personal")')" = true ] || fail "Trash does not list the knowledge rows"
[ "$(curl "${H[@]}" $B/api/knowledge/collections | js 'd.collections.some(c=>c.id==="'$KP'")')" = false ] || fail "a trashed collection is still listed"
curl "${H[@]}" -X POST $B/api/trash/knowledge_items/$KI/restore | grep -q '"ok":true' || fail "restore item"
curl "${H[@]}" -X POST $B/api/trash/knowledge_collections/$KP/restore | grep -q '"ok":true' || fail "restore collection"
[ "$(curl "${H[@]}" $B/api/knowledge/collections/$KW/items | js 'd.items.length')" = 2 ] && [ "$(curl "${H[@]}" $B/api/knowledge/collections | js 'd.collections.some(c=>c.id==="'$KP'")')" = true ] || fail "restore did not bring them back"
# everything to Trash, then Empty Trash must purge chunks -> items -> collections before the documents (FKs)
curl "${H[@]}" -X DELETE $B/api/knowledge/collections/$KW >/dev/null; curl "${H[@]}" -X DELETE $B/api/knowledge/collections/$KP >/dev/null
for x in $KD $KDW $KDP $KDU; do curl "${H[@]}" -X DELETE $B/api/documents/$x >/dev/null; done
for x in $KPW $KPP; do curl "${H[@]}" -X DELETE $B/api/projects/$x >/dev/null; done
KE=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/trash/empty); [ "$(kst "$KE")" = 200 ] || fail "Empty Trash with knowledge rows: $KE"
[ "$(kbody "$KE" | js '(d.purged.knowledge_collections>=3)+","+(d.purged.knowledge_items>=3)+","+(d.purged.knowledge_chunks>=4)')" = "true,true,true" ] || fail "purge counts: $KE"
[ "$(D1X "SELECT (SELECT count(*) FROM knowledge_collections WHERE id IN ('$KW','$KP'))+(SELECT count(*) FROM knowledge_items WHERE collection_id IN ('$KW','$KP'))+(SELECT count(*) FROM knowledge_chunks WHERE collection_id IN ('$KW','$KP')) AS n" | js 'd[0].results[0].n')" = 0 ] || fail "knowledge rows survived Empty Trash"
rm -rf $KS
echo "smoke: (k0) export opens work passages; Trash lists and restores items and collections; Empty Trash purges chunks, items, collections, then the documents"
# (k1) Knowledge, Task 1 (AI_STUB=1: hash vectors; no VECTORIZE binding: the in-memory store, KN10): ingest -> embedded -> ready; search by meaning
# and keywords within the allowed collections only; Locked never embedded, its passages opened for the session; Cloud AI <-> Locked; a project
# going Offline-only or to Trash takes its files out of the index; the cron sweep; metering as knowledge_embed / workers_ai.
KS=$(mktemp -d)
mkdocx() { node -e 'const f=require("fflate");const x=s=>f.strToU8(s);require("fs").writeFileSync(process.argv[1],f.zipSync({"word/document.xml":x("<w:document xmlns:w=\"x\"><w:body><w:p><w:r><w:t>"+process.argv[2]+"</w:t></w:r></w:p></w:body></w:document>")}))' "$1" "$2"; }
mkdocx $KS/axo.docx "The axolotl grant renewal is due in March, and the forms go to the city."
mkdocx $KS/menu.docx "Friday lunch menu: soup, bread and a green salad."
mkdocx $KS/zeb.docx "The vendor will slip the zebrafish milestone by two weeks."
mkdocx $KS/pang.docx "Pangolin contract terms stay on this laptop."
mkdocx $KS/proj.docx "The narwhal garden plan needs new soil in April."
kid() { kbody "$1" | js "d.$2.id"; }
kstate() { curl "${H[@]}" $B/api/knowledge/collections/$1/items | js "(d.items.find(i=>i.id==='$2')||{}).state"; }
kwait() { for _ in $(seq 1 60); do [ "$(kstate $1 $2)" = "$3" ] && return 0; sleep 0.25; done; return 1; }
kn() { D1X "$1" | js 'd[0].results[0].n'; }
ks() { curl "${H[@]}" "$B/api/knowledge/search?q=$1&collections=$2"; }
KUSE=$(kn "SELECT count(*) AS n FROM ai_usage WHERE feature='knowledge_embed' AND provider='workers_ai'")
K1P=$(kid "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke k1 personal","scope":"personal"}')" collection)
K1O=$(kid "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke k1 other","scope":"personal"}')" collection)
K1C=$(kid "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke k1 cloud","scope":"work","boundary":"cloud"}')" collection)
K1L=$(kid "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke k1 locked","scope":"work"}')" collection)
DAXO=$(kid "$(up "@$KS/axo.docx;filename=axo.docx;type=$DOCX")" document); DMENU=$(kid "$(up "@$KS/menu.docx;filename=menu.docx;type=$DOCX")" document)
DZEB=$(kid "$(up "@$KS/zeb.docx;filename=zeb.docx;type=$DOCX" -F knowledge_work=1)" document); DPANG=$(kid "$(up "@$KS/pang.docx;filename=pang.docx;type=$DOCX" -F knowledge_work=1)" document)
IAXO=$(kid "$(kitem $K1P $DAXO)" item); IMENU=$(kid "$(kitem $K1O $DMENU)" item); IZEB=$(kid "$(kitem $K1C $DZEB)" item); IPANG=$(kid "$(kitem $K1L $DPANG)" item)
# ingest -> embedded in waitUntil -> ready
kwait $K1P $IAXO ready && kwait $K1O $IMENU ready && kwait $K1C $IZEB ready || fail "Cloud AI items did not become ready after embedding"
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE collection_id IN ('$K1P','$K1O','$K1C') AND embedded=0")" = 0 ] || fail "Cloud AI passages left unembedded"
[ "$(kstate $K1L $IPANG)" = ready ] && [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE collection_id='$K1L' AND embedded=1")" = 0 ] || fail "a Locked passage was embedded"
[ "$(kn "SELECT count(*) AS n FROM ai_usage WHERE feature='knowledge_embed' AND provider='workers_ai' AND output_tokens>=1 AND input_tokens>0")" -ge $((KUSE + 3)) ] || fail "embedding batches were not metered as knowledge_embed / workers_ai (ingest rows: output_tokens = passages)"
# search: the right passage, from the allowed collection only; opened work text; never cached
ks "axolotl+grant" $K1P | grep -q '"item_title":"axo.docx"' || fail "search did not find the passage"
[ "$(ks "axolotl+grant" $K1P | js 'd.passages[0].text.includes("axolotl")&&d.passages[0].collection.id==="'$K1P'"&&d.passages.every(p=>p.collection.id==="'$K1P'")')" = true ] || fail "search: wrong top passage or collection"
[ "$(ks "axolotl+grant" $K1O | js 'd.passages.some(p=>p.text.includes("axolotl"))')" = false ] || fail "search leaked a passage from a collection not asked for"
[ "$(ks "zebrafish+milestone" "$K1C" | js 'd.passages[0].text.includes("zebrafish")&&d.passages[0].collection.scope==="work"&&d.passages[0].collection.name==="Smoke k1 cloud"&&d.passages[0].locator==="part 1"')" = true ] || fail "work Cloud AI passage not found opened"
[ "$(ks "pangolin+contract" "" | js 'd.passages.some(p=>p.text.includes("Pangolin")||p.collection.id==="'$K1L'")')" = false ] || fail "a Locked passage came out of search"
[ "$(ks "pangolin" $K1L | js 'd.passages.length')" = 0 ] || fail "a Locked collection was searched by meaning"
curl -s -D - -o /dev/null -b $J -H "Origin: $B" "$B/api/knowledge/search?q=axolotl" | grep -qi '^cache-control: private, no-store' || fail "search answer is cacheable"
[ "$(kst "$(kj "$B/api/knowledge/search?q=")")" = 400 ] || fail "empty q"
# the Locked passages: opened, for the session, never cached; only for a Locked work collection
[ "$(curl "${H[@]}" $B/api/knowledge/locked/$K1L/passages | js 'd.passages.length===1&&d.passages[0].text.includes("Pangolin")&&d.passages[0].item_title==="pang.docx"&&d.passages[0].locator==="part 1"')" = true ] || fail "locked passages not opened"
curl -s -D - -o /dev/null -b $J -H "Origin: $B" $B/api/knowledge/locked/$K1L/passages | grep -qi '^cache-control: private, no-store' || fail "locked passages are cacheable"
[ "$(kst "$(kj $B/api/knowledge/locked/$K1C/passages)")" = 404 ] && [ "$(kst "$(kj $B/api/knowledge/locked/$K1P/passages)")" = 404 ] || fail "locked passages served for a Cloud AI collection"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: $B" $B/api/knowledge/locked/$K1L/passages)" = 401 ] || fail "locked passages without a session"
echo "smoke: (k1) ingest -> embedded (metered knowledge_embed/workers_ai) -> ready; search finds the passage in the allowed collection only, work text opened, no-store; Locked never embedded nor searched by meaning, its passages opened for the session only"
# KN14: background ingest batches skip the 120/h search bucket (their rows carry the passage count in output_tokens); 200 ingest batches this hour
# leave search working, 120 query embeds stop it. The rows are made here (200 real batches would be slow) and removed after.
KNOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
kfill() { D1X "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < $1) INSERT INTO ai_usage (id, at, feature, provider, input_tokens, output_tokens, cost_micro) SELECT 'smoke-kb-$2-' || i, '$KNOW', 'knowledge_embed', 'workers_ai', 1, $3, 0 FROM n" >/dev/null; }
kfill 200 ingest 50
[ "$(kst "$(kj "$B/api/knowledge/search?q=axolotl&collections=$K1P")")" = 200 ] || fail "a big ingest made search 429"
kfill 120 query 0
KRL=$(kj "$B/api/knowledge/search?q=axolotl&collections=$K1P"); [ "$(kst "$KRL")" = 429 ] && kbody "$KRL" | grep -q '"error":"rate_limited"' || fail "120 query embeds an hour did not stop search: $KRL"
D1X "DELETE FROM ai_usage WHERE id LIKE 'smoke-kb-%'" >/dev/null
echo "smoke: (k1) 200 ingest batches this hour leave search working; 120 query embeds -> 429 rate_limited"
# Cloud AI -> Locked: vectors deleted, passages un-embedded, out of search; Locked -> Cloud AI (step-up in the dev session) embeds again
curl "${H[@]}" -X PATCH $B/api/knowledge/collections/$K1C -d '{"boundary":"locked"}' | grep -q '"boundary":"locked"' || fail "Cloud AI -> Locked"
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE collection_id='$K1C' AND embedded=1")" = 0 ] || fail "Cloud AI -> Locked left embedded passages"
[ "$(ks "zebrafish" "" | js 'd.passages.some(p=>p.collection.id==="'$K1C'")')" = false ] || fail "a Locked collection's passage is still searchable"
KUSE=$(kn "SELECT count(*) AS n FROM ai_usage WHERE feature='knowledge_embed'")
curl "${H[@]}" -X PATCH $B/api/knowledge/collections/$K1C -d '{"boundary":"cloud"}' | grep -q '"boundary":"cloud"' || fail "Locked -> Cloud AI"
kwait $K1C $IZEB ready || fail "Locked -> Cloud AI did not embed again"
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE collection_id='$K1C' AND embedded=0")" = 0 ] && [ "$(kn "SELECT count(*) AS n FROM ai_usage WHERE feature='knowledge_embed'")" -gt $KUSE ] || fail "re-embedding not done or not metered"
ks "zebrafish" $K1C | grep -q zebrafish || fail "search after Locked -> Cloud AI"
echo "smoke: (k1) Cloud AI -> Locked removes vectors (embedded 0, out of search); Locked -> Cloud AI embeds again (metered)"
# a project going Offline-only or to Trash takes its files' passages out of the index; back to Cloud, they are embedded again
K1PP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke k1 project","kind":"personal"}' | js d.project.id)
DPROJ=$(kid "$(up "@$KS/proj.docx;filename=proj.docx;type=$DOCX" -F "project_id=$K1PP")" document); IPROJ=$(kid "$(kitem $K1P $DPROJ)" item)
kwait $K1P $IPROJ ready && ks "narwhal+garden" $K1P | grep -q narwhal || fail "a project file was not searchable"
curl "${H[@]}" -X PATCH $B/api/projects/$K1PP -d '{"data_boundary":"offline"}' | grep -q '"data_boundary":"offline"' || fail "project -> Offline only"
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$IPROJ' AND embedded=1")" = 0 ] && ! ks "narwhal+garden" $K1P | grep -q narwhal || fail "an Offline-only project's file kept its vectors or stayed searchable"
[ "$(curl "${H[@]}" $B/api/knowledge/collections/$K1P/items | js "d.items.find(i=>i.id==='$IPROJ').search")" = excluded ] || fail "item list: an Offline-only project's file is not marked excluded"
curl "${H[@]}" -X PATCH $B/api/projects/$K1PP -d '{"data_boundary":"cloud"}' >/dev/null
for _ in $(seq 1 40); do [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$IPROJ' AND embedded=0")" = 0 ] && break; sleep 0.25; done
ks "narwhal+garden" $K1P | grep -q narwhal || fail "back to Cloud, the project file was not embedded again"
curl "${H[@]}" -X DELETE $B/api/projects/$K1PP | grep -q '"ok":true' || fail "project trash"
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$IPROJ' AND embedded=1")" = 0 ] && ! ks "narwhal+garden" $K1P | grep -q narwhal || fail "a trashed project's file kept its vectors or stayed searchable"
# an item in Trash leaves search at once; the cron sweep takes its vectors; restored, the cron embeds it again
curl "${H[@]}" -X DELETE $B/api/knowledge/items/$IAXO | grep -q '"ok":true' || fail "item trash"
! ks "axolotl" $K1P | grep -q axolotl || fail "a trashed item is still searchable"
cron() { curl -s -X POST "$B/cdn-cgi/local/explorer/api/local/scheduled?worker=compass" -H 'Content-Type: application/json' -d '{"cron":"*/15 * * * *"}' | grep -q '"outcome":"ok"' || fail "cron run"; }
cron; for _ in $(seq 1 40); do [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$IAXO' AND embedded=1")" = 0 ] && break; sleep 0.25; done
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$IAXO' AND embedded=1")" = 0 ] || fail "the cron sweep left a trashed item's vectors"
curl "${H[@]}" -X POST $B/api/trash/knowledge_items/$IAXO/restore | grep -q '"ok":true' || fail "restore item"
[ "$(curl "${H[@]}" $B/api/knowledge/collections/$K1P/items | js "d.items.find(i=>i.id==='$IAXO').search")" = reindexing ] || fail "item list: a restored, not yet re-embedded item is not marked reindexing"
cron; for _ in $(seq 1 40); do ks "axolotl" $K1P | grep -q axolotl && break; sleep 0.25; done
ks "axolotl" $K1P | grep -q axolotl || fail "the cron did not embed the restored item again"
echo "smoke: (k1) project Offline only / Trash -> its files' vectors go, out of search; back to Cloud -> embedded again; item Trash -> out of search, cron sweep un-embeds, restore -> cron embeds"
# clean up: everything to Trash and purged (vectors deleted with the passages)
for x in $K1P $K1O $K1C $K1L; do curl "${H[@]}" -X DELETE $B/api/knowledge/collections/$x >/dev/null; done
for x in $DAXO $DMENU $DZEB $DPANG $DPROJ; do curl "${H[@]}" -X DELETE $B/api/documents/$x >/dev/null; done
[ "$(kst "$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/trash/empty)")" = 200 ] || fail "Empty Trash after k1"
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE collection_id IN ('$K1P','$K1O','$K1C','$K1L')")" = 0 ] || fail "k1 passages survived Empty Trash"
rm -rf $KS
# (k3) Knowledge, Task 3: Athena reads knowledge (KN2 thread kind, the allowed set, fenced k: passages, citations), "Save to knowledge" from a meeting and an email.
KS=$(mktemp -d)
mkdocx $KS/p.docx "The quokka$R picnic budget is forty dollars."
mkdocx $KS/w.docx "The quokka$R vendor contract renews in June."
mkdocx $KS/l.docx "The quokka$R merger terms stay Locked."
K3WP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke k3 work","kind":"work"}' | js d.project.id) # a work project is Offline only by default
K3P=$(kid "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke k3 personal","scope":"personal"}')" collection)
K3C=$(kid "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke k3 cloud","scope":"work","boundary":"cloud"}')" collection)
K3L=$(kid "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke k3 locked","scope":"work"}')" collection)
D3P=$(kid "$(up "@$KS/p.docx;filename=p.docx;type=$DOCX")" document); D3W=$(kid "$(up "@$KS/w.docx;filename=w.docx;type=$DOCX" -F knowledge_work=1)" document); D3L=$(kid "$(up "@$KS/l.docx;filename=l.docx;type=$DOCX" -F knowledge_work=1)" document)
I3P=$(kid "$(kitem $K3P $D3P)" item); I3W=$(kid "$(kitem $K3C $D3W)" item); I3L=$(kid "$(kitem $K3L $D3L)" item)
kwait $K3P $I3P ready && kwait $K3C $I3W ready || fail "k3 items did not become ready"
kc() { D1X "SELECT id AS n FROM knowledge_chunks WHERE item_id='$1'" | js 'd[0].results[0].n'; }
CP=$(kc $I3P); CW=$(kc $I3W); CL=$(kc $I3L)
# cited ids that belong to work collections (must be 0 in a personal thread)
kwork() { D1X "SELECT count(*) AS n FROM knowledge_chunks c JOIN knowledge_collections k ON k.id=c.collection_id WHERE k.scope='work' AND c.id IN ($(printf '%s' "$1" | js "d.messages[1].citations.filter(c=>c.startsWith('k:')).map(c=>\"'\"+c.slice(2)+\"'\").join(',')||\"''\""))" | js 'd[0].results[0].n'; }
# a personal thread asking "all": only personal passages reach the stub, fenced as k: blocks, cited, the unsent id dropped
A3=$(curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"message\":\"quokka$R budget vendor merger\",\"knowledge\":{\"collections\":\"all\"}}")
[ "$(printf '%s' "$A3" | js 'const m=d.messages[1]; m.content.includes("[stub passages: ")&&m.content.includes("k:'$CP'")&&!m.content.includes("k:'$CW'")&&!m.content.includes("k:'$CL'")&&m.citations.includes("k:'$CP'")&&!m.citations.includes("k:stub-not-sent")&&d.thread.kind===null')" = true ] || fail "personal thread + all: $A3"
[ "$(kwork "$A3")" = 0 ] || fail "a work passage reached a personal thread"
A3M=$(printf '%s' "$A3" | js 'd.messages[1].id')
[ "$(curl "${H[@]}" $B/api/ai/messages/$A3M/sources | js 'const s=d.sources.find(x=>x.id==="k:'$CP'"); !!s&&s.title==="p.docx"&&s.locator==="part 1"&&s.document_id==="'$D3P'"&&!s.removed')" = true ] || fail "sources did not name the passage"
# a project-less work thread: personal and Cloud AI work passages, never Locked; sealed as work
A3W=$(curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"kind\":\"work\",\"message\":\"quokka$R budget vendor merger\",\"knowledge\":{\"collections\":\"all\"}}")
[ "$(printf '%s' "$A3W" | js 'const m=d.messages[1]; d.thread.kind==="work"&&m.citations.includes("k:'$CW'")&&m.citations.includes("k:'$CP'")&&!m.content.includes("k:'$CL'")&&!m.citations.includes("k:'$CL'")')" = true ] || fail "work thread + all: $A3W"
A3WT=$(printf '%s' "$A3W" | js d.thread.id)
[ "$(kn "SELECT count(*) AS n FROM ai_threads WHERE id='$A3WT' AND kind='work' AND enc_v=2 AND title NOT LIKE '%quokka%'")" = 1 ] && [ "$(kn "SELECT count(*) AS n FROM ai_messages WHERE thread_id='$A3WT' AND enc_v=2 AND content NOT LIKE '%quokka%'")" = 2 ] || fail "a project-less work thread is not sealed as work"
A3N=$(curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"thread_id\":\"$A3WT\",\"message\":\"quokka$R vendor\",\"knowledge\":{\"collections\":[\"$K3C\"]}}")
[ "$(printf '%s' "$A3N" | js 'd.messages[1].citations.includes("k:'$CW'")&&d.thread.kind==="work"')" = true ] || fail "the work thread kept its kind and read the named Cloud AI collection: $A3N"
# KN22 (C1): "Add to the board" names the answer; the server takes project and kind from its thread, whatever the body says. A project-less work
# thread makes sealed work tasks that Kelly never sees (and, in (k4), the Compass digest leaves out).
A3WM=$(printf '%s' "$A3W" | js 'd.messages[1].id')
BT=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke WORKBOARD $R\",\"kind\":\"personal\",\"due_at\":\"2000-01-01\",\"from_message\":\"$A3WM\"}" | js d.task.id)
[ "$(kn "SELECT count(*) AS n FROM tasks WHERE id='$BT' AND kind='work' AND project_id IS NULL AND enc_v=2 AND title NOT LIKE '%WORKBOARD%'")" = 1 ] || fail "a board add from a work thread is not a sealed work task"
BTP=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke PERSONALBOARD $R\",\"kind\":\"work\",\"from_message\":\"$A3M\"}" | js d.task.id)
[ "$(kn "SELECT count(*) AS n FROM tasks WHERE id='$BTP' AND kind='personal' AND enc_v=0")" = 1 ] || fail "a board add from a personal thread is not personal"
[ "$(kst "$(kj -X POST $B/api/tasks -d '{"title":"x","from_message":"no-such-answer"}')")" = 404 ] || fail "a board add naming no answer is not 404"
kset '{"enabled":true,"scopes":["compass:read.tasks"]}'
[ "$(agc GET /tasks/$BT)" = 404 ] || fail "Kelly can look up a work board add"
agb GET "/tasks?view=overdue&limit=50" | grep -q "WORKBOARD" && fail "Kelly lists a work board add"
agb GET /today | grep -q "WORKBOARD" && fail "Kelly's today shows a work board add"
kset '{"enabled":false,"scopes":[]}'
echo "smoke: (k3) KN22: board adds take the thread's kind: a project-less work thread -> sealed work task (body kind ignored), hidden from Kelly; a personal thread -> personal; an unknown answer -> 404"
# refused before anything is stored or sent
N0=$(NMSG); Q0=$(kn "SELECT count(*) AS n FROM ai_usage WHERE feature='knowledge_embed' AND output_tokens=0")
kj -X POST $B/api/ai/chat -d "{\"message\":\"x\",\"knowledge\":{\"collections\":[\"$K3C\"]}}" | grep -q '"error":"knowledge_boundary"' || fail "a personal thread naming a work collection"
KB=$(kj -X POST $B/api/ai/chat -d "{\"message\":\"x\",\"knowledge\":{\"collections\":[\"$K3C\"]}}"); [ "$(kst "$KB")" = 409 ] || fail "knowledge_boundary is not 409: $KB"
kj -X POST $B/api/ai/chat -d "{\"thread_id\":\"$A3WT\",\"message\":\"x\",\"knowledge\":{\"collections\":[\"$K3L\"]}}" | grep -q '"error":"knowledge_boundary"' || fail "a work thread naming a Locked collection"
[ "$(NMSG)" = "$N0" ] && [ "$(kn "SELECT count(*) AS n FROM ai_usage WHERE feature='knowledge_embed' AND output_tokens=0")" = "$Q0" ] || fail "a refused knowledge request stored or embedded something"
[ "$(kst "$(kj -X POST $B/api/ai/chat -d "{\"project_id\":\"$K3WP\",\"kind\":\"work\",\"message\":\"x\"}")")" = 400 ] && [ "$(kst "$(kj -X POST $B/api/ai/chat -d '{"kind":"team","message":"x"}')")" = 400 ] && [ "$(kst "$(kj -X POST $B/api/ai/chat -d '{"message":"x","knowledge":{"collections":"some"}}')")" = 400 ] || fail "kind / knowledge validation"
# attachments (Task 0 carry): a sealed unfiled upload joins a project-less work thread, never a personal one
KA=$(kj -X POST $B/api/ai/chat -d "{\"kind\":\"work\",\"message\":\"read\",\"document_ids\":[\"$D3W\"]}"); [ "$(kst "$KA")" = 200 ] || fail "a sealed upload in a project-less work thread: $(printf '%s' "$KA" | tail -c 300)"
kj -X POST $B/api/ai/chat -d "{\"message\":\"read\",\"document_ids\":[\"$D3W\"]}" | grep -q '"error":"document_boundary"' || fail "a sealed upload in a personal thread"
kj -X POST $B/api/ai/chat -d "{\"kind\":\"work\",\"message\":\"read\",\"document_ids\":[\"$D3P\"]}" | grep -q '"error":"document_boundary"' || fail "a plain upload in a project-less work thread"
# KN22 (minor 1): a file kept only in a Locked collection is never read by a model: no Athena attachment, no Cloud AI add without the passkey answer
kj -X POST $B/api/ai/chat -d "{\"kind\":\"work\",\"message\":\"read\",\"document_ids\":[\"$D3L\"]}" | grep -q '"error":"knowledge_boundary"' || fail "a Locked-only file was attached in Athena"
KLC=$(kitem $K3C $D3L); [ "$(kst "$KLC")" = 409 ] && kbody "$KLC" | grep -q '"error":"knowledge_boundary"' || fail "a Locked-only file went into Cloud AI without the passkey: $KLC"
KLS=$(kj -X POST $B/api/knowledge/items -H 'X-Step-Up: dev' -d "{\"collection_id\":\"$K3C\",\"document_id\":\"$D3L\"}"); [ "$(kst "$KLS")" = 201 ] || fail "the passkey answer did not let a Locked-only file into Cloud AI: $KLS"
curl "${H[@]}" -X DELETE $B/api/knowledge/items/$(kid "$KLS" item) >/dev/null # out of search again for the checks below
# a cited item in Trash: its chip says Removed
curl "${H[@]}" -X DELETE $B/api/knowledge/items/$I3P >/dev/null
[ "$(curl "${H[@]}" $B/api/ai/messages/$A3M/sources | js 'd.sources.find(x=>x.id==="k:'$CP'").removed===true')" = true ] || fail "a trashed item's citation is not Removed"
echo "smoke: (k3) personal thread + all -> personal passages only (fenced k: blocks, cited, unsent id dropped, named by /sources); project-less work thread (sealed) -> personal and Cloud AI work, never Locked; personal->work and work->Locked 409 knowledge_boundary with nothing stored or embedded; sealed uploads only in work threads; trashed item -> Removed"
# Save to knowledge: a meeting (work) and an email (personal); ready after the embedder runs
M3="{\"app\":\"sonarflow\",\"kind\":\"meeting\",\"title\":\"Smoke k3 meeting $R\",\"ref\":\"sonarflow:recording:k3$R\",\"payload\":{\"title\":\"Smoke k3 meeting\",\"summary\":\"The wombat rollout slips a week.\",\"decisions\":[{\"text\":\"Ship wombat in May\",\"at\":\"00:01\"}],\"action_items\":[],\"important_notes\":[],\"open_questions\":[]}}"
post "$IDS" "$M3" >/dev/null; M3ID=$(curl "${H[@]}" $B/api/meetings | js "(d.meetings.find(m=>m.recording_id==='k3$R')||{}).id")
kj -X POST $B/api/knowledge/items/from-meeting/$M3ID -d "{\"collection_id\":\"$K3P\"}" | grep -q '"error":"knowledge_boundary"' || fail "a work meeting into a personal collection"
SM=$(kj -X POST $B/api/knowledge/items/from-meeting/$M3ID -d "{\"collection_id\":\"$K3C\"}"); [ "$(kst "$SM")" = 201 ] || fail "meeting into Cloud AI: $SM"; SMI=$(kid "$SM" item)
kwait $K3C $SMI ready || fail "the meeting item did not become ready"
[ "$(kn "SELECT count(*) AS n FROM knowledge_items WHERE id='$SMI' AND source='meeting' AND enc_v=2 AND title NOT LIKE '%Smoke%'")" = 1 ] && [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$SMI' AND enc_v=2 AND embedded=1")" -ge 1 ] || fail "the meeting item is not sealed and embedded"
ks "wombat+rollout" $K3C | grep -q 'wombat' || fail "the meeting minutes are not searchable"
SMC=$(kc $SMI)
SM2=$(kj -X POST $B/api/knowledge/items/from-meeting/$M3ID -d "{\"collection_id\":\"$K3C\"}"); [ "$(kst "$SM2")" = 200 ] && [ "$(kbody "$SM2" | js 'd.item.id+","+d.existing')" = "$SMI,true" ] || fail "saving the same meeting twice made a second item"
WMB() { curl "${H[@]}" -X POST $B/api/ai/chat -d "{\"kind\":\"work\",\"message\":\"wombat rollout slips\",\"knowledge\":{\"collections\":[\"$K3C\"]}}"; }
WMB | js 'd.messages[1].content' | grep -q "k:$SMC" || fail "the saved meeting notes did not reach a work thread"
curl "${H[@]}" -X POST $B/api/meetings/$M3ID/accept -d "{\"project_id\":\"$K3WP\",\"tasks\":[],\"decisions\":[{\"text\":\"k3 decision\"}]}" | grep -q '"state":"reviewed"' || fail "k3 meeting accept"
[ "$(curl "${H[@]}" $B/api/projects/$K3WP | js 'd.project.data_boundary')" = offline ] || fail "expected the work project to be Offline only"
# KN16: the notes now follow the meeting's Offline-only project: out of search and never sent at once, their vectors gone after the accept's sweep
! ks "wombat+rollout" $K3C | grep -q 'wombat' || fail "a filed Offline-only meeting's notes are still searchable"
WMB | js 'd.messages[1].content' | grep -q "k:$SMC" && fail "a filed Offline-only meeting's notes reached the stub"
for _ in $(seq 1 40); do [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$SMI' AND embedded=1")" = 0 ] && break; sleep 0.25; done
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$SMI' AND embedded=1")" = 0 ] || fail "a filed Offline-only meeting's notes kept their vectors"
[ "$(curl "${H[@]}" $B/api/knowledge/collections/$K3C/items | js "d.items.find(i=>i.id==='$SMI').search")" = excluded ] || fail "item list: the filed meeting is not marked excluded"
kj -X POST $B/api/knowledge/items/from-meeting/$M3ID -d "{\"collection_id\":\"$K3C\"}" | grep -q '"error":"offline_boundary"' || fail "an Offline-only meeting into Cloud AI"
SML=$(kj -X POST $B/api/knowledge/items/from-meeting/$M3ID -d "{\"collection_id\":\"$K3L\"}"); [ "$(kst "$SML")" = 201 ] && [ "$(kbody "$SML" | js d.item.state)" = ready ] || fail "an Offline-only meeting into Locked: $SML"
# Locked search keeps Offline-only notes, but not once their project is in Trash
SMLI=$(kid "$SML" item); klock() { curl "${H[@]}" $B/api/knowledge/locked/$K3L/passages | js "d.passages.some(p=>p.item_id==='$SMLI')"; }
[ "$(klock)" = true ] || fail "the Locked meeting notes are not in the Locked passages"
curl "${H[@]}" -X DELETE $B/api/projects/$K3WP | grep -q '"ok":true' || fail "k3 work project trash"
[ "$(klock)" = false ] || fail "a Locked meeting whose project is in Trash is still in the Locked passages"
# KN17: the purge takes the project's knowledge with it, so the unfiled review never brings the Offline-only notes back
D1X "UPDATE projects SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE id = '$K3WP'" >/dev/null; cron
[ "$(kn "SELECT count(*) AS n FROM projects WHERE id='$K3WP'")" = 0 ] && [ "$(kn "SELECT count(*) AS n FROM meeting_reviews WHERE id='$M3ID' AND project_id IS NULL")" = 1 ] || fail "the 30-day purge did not take the k3 work project"
[ "$(kn "SELECT count(*) AS n FROM knowledge_items WHERE id IN ('$SMI','$SMLI')")" = 0 ] && [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id IN ('$SMI','$SMLI')")" = 0 ] || fail "a purged project's meeting notes kept their items or passages"
[ "$(klock)" = false ] && ! ks "wombat+rollout" $K3C | grep -q 'wombat' || fail "a purged Offline-only project's notes came back"
E3="{\"app\":\"kelly\",\"kind\":\"email\",\"title\":\"Smoke k3 email $R\",\"ref\":\"smoke:k3mail:$R\",\"body\":\"The platypus dinner moves to Friday.\",\"payload\":{\"from\":\"Ann\",\"account\":\"me@gmail.com\"}}"
E3ID=$(post "$KELLY" "$E3" | js d.id)
kj -X POST $B/api/knowledge/items/from-inbox/$E3ID -d "{\"collection_id\":\"$K3C\"}" | grep -q '"error":"knowledge_boundary"' || fail "a personal email into a work collection"
SE=$(kj -X POST $B/api/knowledge/items/from-inbox/$E3ID -d "{\"collection_id\":\"$K3P\"}"); [ "$(kst "$SE")" = 201 ] || fail "email into personal: $SE"; SEI=$(kid "$SE" item)
kwait $K3P $SEI ready || fail "the email item did not become ready"
ks "platypus+dinner" $K3P | grep -q 'platypus' || fail "the email is not searchable"
SE2=$(kj -X POST $B/api/knowledge/items/from-inbox/$E3ID -d "{\"collection_id\":\"$K3P\"}"); [ "$(kst "$SE2")" = 200 ] && [ "$(kbody "$SE2" | js d.item.id)" = "$SEI" ] || fail "saving the same email twice: $SE2"
# the email follows the project of the task it became: moved into an Offline-only project, it leaves search
E3T=$(kn "SELECT task_id AS n FROM inbox_items WHERE id='$E3ID'"); K3PP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke k3 personal offline","kind":"personal"}' | js d.project.id)
curl "${H[@]}" -X PATCH $B/api/projects/$K3PP -d '{"data_boundary":"offline"}' >/dev/null
curl "${H[@]}" -X PATCH $B/api/tasks/$E3T -d "{\"project_id\":\"$K3PP\"}" | grep -q "\"project_id\":\"$K3PP\"" || fail "move the email's task"
! ks "platypus+dinner" $K3P | grep -q 'platypus' || fail "an email whose task sits in an Offline-only project is still searchable"
# rule 5: the email turns work while it sits in the personal collection (as a work rule's Keep does; set directly here) -> the sweep seals its title and passages in place
D1X "UPDATE inbox_items SET work = 1 WHERE id='$E3ID'" >/dev/null; cron
for _ in $(seq 1 40); do [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$SEI' AND enc_v=0")" = 0 ] && break; sleep 0.25; done
[ "$(kn "SELECT count(*) AS n FROM knowledge_items WHERE id='$SEI' AND enc_v=2 AND title NOT LIKE '%Smoke k3 email%'")" = 1 ] && [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$SEI' AND enc_v=2 AND text NOT LIKE '%platypus%'")" -ge 1 ] && [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id='$SEI' AND enc_v=0")" = 0 ] || fail "an email that turned work still sits plain in the personal collection"
[ "$(curl "${H[@]}" $B/api/knowledge/collections/$K3P/items | js "d.items.find(i=>i.id==='$SEI').title")" = "Smoke k3 email $R" ] || fail "the sealed email item did not open"
# KN18: the email's task (in an Offline-only project) goes to Trash alone and is purged: its knowledge goes with it (Locked and personal), the project stays
SEL=$(kid "$(kj -X POST $B/api/knowledge/items/from-inbox/$E3ID -d "{\"collection_id\":\"$K3L\"}")" item); [ -n "$SEL" ] || fail "an Offline-only work email into Locked"
curl "${H[@]}" -X DELETE $B/api/tasks/$E3T | grep -q '"ok":true' || fail "trash the email's task"
D1X "UPDATE tasks SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE id = '$E3T'" >/dev/null; cron
[ "$(kn "SELECT count(*) AS n FROM tasks WHERE id='$E3T'")" = 0 ] && [ "$(kn "SELECT count(*) AS n FROM projects WHERE id='$K3PP'")" = 1 ] || fail "the 30-day purge did not take the email's task alone"
[ "$(kn "SELECT count(*) AS n FROM knowledge_items WHERE id IN ('$SEI','$SEL')")" = 0 ] && [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE item_id IN ('$SEI','$SEL')")" = 0 ] || fail "a purged Offline-only task's email kept its knowledge"
[ "$(curl "${H[@]}" $B/api/knowledge/locked/$K3L/passages | js "d.passages.some(p=>p.item_id==='$SEL')")" = false ] && ! ks "platypus+dinner" $K3P | grep -q platypus || fail "a purged Offline-only task's email came back"
# a saved email keeps its inbox row through the 30-day inbox purge (an unsaved one goes), so it stays searchable; two saves at once make one item
E4ID=$(post "$KELLY" "{\"app\":\"kelly\",\"kind\":\"email\",\"title\":\"Smoke k3 capybara $R\",\"ref\":\"smoke:k3cap:$R\",\"body\":\"The capybara spa opens in May.\",\"payload\":{\"from\":\"Spa\",\"account\":\"me@gmail.com\"}}" | js d.id)
E5ID=$(post "$KELLY" "{\"app\":\"kelly\",\"kind\":\"email\",\"title\":\"Smoke k3 unsaved $R\",\"ref\":\"smoke:k3uns:$R\",\"body\":\"Nothing to keep.\",\"payload\":{\"from\":\"X\",\"account\":\"me@gmail.com\"}}" | js d.id)
E6ID=$(post "$KELLY" "{\"app\":\"kelly\",\"kind\":\"email\",\"title\":\"Smoke k3 twice $R\",\"ref\":\"smoke:k3two:$R\",\"body\":\"Saved twice at once.\",\"payload\":{\"from\":\"Y\",\"account\":\"me@gmail.com\"}}" | js d.id)
S4I=$(kid "$(kj -X POST $B/api/knowledge/items/from-inbox/$E4ID -d "{\"collection_id\":\"$K3P\"}")" item); kwait $K3P $S4I ready || fail "the capybara email did not become ready"
D1X "UPDATE inbox_items SET state = 'dismissed', task_id = NULL, updated_at = '2000-01-01T00:00:00.000Z' WHERE id IN ('$E4ID','$E5ID')" >/dev/null; cron
[ "$(kn "SELECT count(*) AS n FROM inbox_items WHERE id='$E4ID'")" = 1 ] && [ "$(kn "SELECT count(*) AS n FROM inbox_items WHERE id='$E5ID'")" = 0 ] || fail "the inbox purge took a saved email's row (or kept an unsaved one)"
ks "capybara+spa" $K3P | grep -q capybara || fail "a saved email left search after the inbox purge"
kj -X POST $B/api/knowledge/items/from-inbox/$E6ID -d "{\"collection_id\":\"$K3P\"}" > $KS/s1 & kj -X POST $B/api/knowledge/items/from-inbox/$E6ID -d "{\"collection_id\":\"$K3P\"}" > $KS/s2; wait
[ "$(kn "SELECT count(*) AS n FROM knowledge_items WHERE source_id='$E6ID' AND deleted_at IS NULL")" = 1 ] && [ "$(tail -1 $KS/s1)$(tail -1 $KS/s2)" != "201201" ] || fail "two saves at once made two items: $(cat $KS/s1 $KS/s2)"
# restoring a trashed item while a newer save of the same source is live: 409 with a plain message, nothing changes
S6A=$(kn "SELECT id AS n FROM knowledge_items WHERE source_id='$E6ID' AND deleted_at IS NULL")
curl "${H[@]}" -X DELETE $B/api/knowledge/items/$S6A | grep -q '"ok":true' || fail "trash the twice-saved email"
S6B=$(kid "$(kj -X POST $B/api/knowledge/items/from-inbox/$E6ID -d "{\"collection_id\":\"$K3P\"}")" item)
RC=$(kj -X POST $B/api/trash/knowledge_items/$S6A/restore); [ "$(kst "$RC")" = 409 ] && kbody "$RC" | grep -q 'This is already in the collection' && [ "$(kn "SELECT count(*) AS n FROM knowledge_items WHERE source_id='$E6ID' AND deleted_at IS NULL AND id='$S6B'")" = 1 ] || fail "restore over a live save of the same source: $RC"
# a failed knowledge search (here the 120/h query bucket) never fails the chat: she answers without it and says so
KNOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z); kfill 120 k3q 0
KF=$(kj -X POST $B/api/ai/chat -d '{"message":"anything","knowledge":{"collections":"all"}}'); D1X "DELETE FROM ai_usage WHERE id LIKE 'smoke-kb-k3q-%'" >/dev/null
[ "$(kst "$KF")" = 200 ] && kbody "$KF" | js 'd.messages[1].content' | grep -q "I couldn't search your knowledge just now" && ! kbody "$KF" | js 'd.messages[1].content' | grep -q 'stub passages' || fail "a 429 knowledge search failed the chat or said nothing: $KF"
[ "$(kst "$(kj -X POST $B/api/knowledge/items/from-inbox/$E3ID -d '{}')")" = 400 ] && [ "$(kst "$(kj -X POST $B/api/knowledge/items/from-meeting/nope -d "{\"collection_id\":\"$K3C\"}")")" = 404 ] || fail "save validation"
echo "smoke: (k3) KN16: a saved meeting filed into an Offline-only project leaves search and the stub, loses its vectors, shows excluded; an email follows its task's project, and turned work it is sealed in place by the sweep; a saved email survives the inbox purge; two saves at once -> one item; restoring over a live save of the same source -> 409; a Locked meeting leaves the Locked passages when its project goes to Trash; the purge takes the project's notes (items, passages) with it, and an Offline-only task's email with the task; same source twice -> the same item (200); a 429 knowledge search -> answer with the note"
echo "smoke: (k3) meeting -> work only (409 personal), Cloud AI item sealed, embedded, ready, searchable; filed under an Offline-only project -> 409 offline_boundary for Cloud AI, Locked ok; personal email -> personal only, ready and searchable"
for x in $K3P $K3C $K3L; do curl "${H[@]}" -X DELETE $B/api/knowledge/collections/$x >/dev/null; done
for x in $D3P $D3W $D3L; do curl "${H[@]}" -X DELETE $B/api/documents/$x >/dev/null; done
curl "${H[@]}" -X DELETE $B/api/projects/$K3WP >/dev/null; curl "${H[@]}" -X DELETE $B/api/projects/$K3PP >/dev/null
[ "$(kst "$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/trash/empty)")" = 200 ] || fail "Empty Trash after k3"
rm -rf $KS
# (k4) Knowledge, Task 4: "From my apps" against the stub relay (/apps-digest): five items, a second refresh replaces them, a failing source keeps yesterday's item
# with its error, the system collection is out of every save path, Refresh now at most every 10 minutes, and the cron refreshes once a day after digest_hour.
node "$(dirname "$0")/relay-stub.mjs" "$RS" 8791 & STUB=$!; trap 'kill $STUB 2>/dev/null' EXIT; sleep 1 # the (z) stub was stopped above
stub() { curl -s "localhost:8791/digest-set$1" >/dev/null; }; stub ''
arm() { D1X "DELETE FROM audit_log WHERE action IN ('knowledge.apps.refresh','knowledge.apps.done')" >/dev/null; } # a refresh (the cron may have made one already) starts the 10-minute window; local only
refresh() { arm; kj -X POST $B/api/knowledge/apps/refresh; }
SYSQ="SELECT i.id, i.source, i.state, i.error FROM knowledge_items i JOIN knowledge_collections k ON k.id=i.collection_id WHERE k.system=1"
sysn() { kn "SELECT count(*) AS n FROM knowledge_items i JOIN knowledge_collections k ON k.id=i.collection_id WHERE k.system=1 AND i.deleted_at IS NULL${1:+ AND $1}"; }
SYSEMB() { for _ in $(seq 1 60); do [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks c JOIN knowledge_collections k ON k.id=c.collection_id WHERE k.system=1 AND c.embedded=0")" = 0 ] && return 0; sleep 0.25; done; return 1; }
K4WP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke k4 work","kind":"work"}' | js d.project.id)
K4T1=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke k4 pelican personal $R\",\"kind\":\"personal\",\"due_at\":\"2000-01-01\"}" | js d.task.id)
K4T2=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke k4 WORKONLY $R\",\"project_id\":\"$K4WP\"}" | js d.task.id)
KR1=$(refresh); [ "$(kst "$KR1")" = 200 ] && [ "$(kbody "$KR1" | js 'd.ok.join()+"|"+Object.keys(d.errors).length')" = "compass,finance,health,home,hollow|0" ] || fail "first apps refresh: $KR1"
SYS=$(curl "${H[@]}" $B/api/knowledge/collections | js "d.collections.filter(c=>c.system===1&&c.name==='From my apps'&&c.scope==='personal'&&c.boundary==='cloud').map(c=>c.id).join()"); [ -n "$SYS" ] && [ "${SYS#*,}" = "$SYS" ] || fail "no single From my apps collection ($SYS)"
[ "$(curl "${H[@]}" $B/api/knowledge/collections | js 'd.collections[0].system')" = 1 ] || fail "From my apps is not listed first"
A1=$(curl -s localhost:8791/digest-hits | js d.hits); SYSEMB || fail "the digest passages were not embedded"
[ "$(sysn "i.state='ready'")" = 5 ] && [ "$(sysn "i.source IN ('app:compass','app:finance','app:health','app:home','app:hollow')")" = 5 ] || fail "not five ready items after the first refresh"
OLDI=$(D1X "$SYSQ" | js 'd[0].results.map(r=>r.id).sort().join()'); OLDC=$(D1X "SELECT c.id FROM knowledge_chunks c JOIN knowledge_collections k ON k.id=c.collection_id WHERE k.system=1" | js 'd[0].results.map(r=>r.id).sort().join()')
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks c JOIN knowledge_items i ON i.id=c.item_id WHERE i.source='app:compass' AND c.text LIKE '%pelican personal $R%'")" -ge 1 ] || fail "the Compass digest lacks the personal task"
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks c JOIN knowledge_collections k ON k.id=c.collection_id WHERE k.system=1 AND (c.text LIKE '%WORKONLY%' OR c.text LIKE '%$K4WP%')")" = 0 ] || fail "a work task reached the Compass digest"
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks c JOIN knowledge_collections k ON k.id=c.collection_id WHERE k.system=1 AND c.text LIKE '%WORKBOARD%'")" = 0 ] || fail "a work board add (KN22) reached the Compass digest"
ks "Stubhealth" $SYS | grep -q 'refills due' || fail "the digest is not searchable by meaning/words"
ks "Stubhealth" $SYS | grep -qi 'Medications' || fail "the Health passage did not come back with its heading"
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks c JOIN knowledge_collections k ON k.id=c.collection_id WHERE k.system=1 AND c.enc_v != 0")" = 0 ] || fail "personal digest passages are sealed"
# Refresh now: at most once every 10 minutes (the refresh above counts)
KR2=$(kj -X POST $B/api/knowledge/apps/refresh); [ "$(kst "$KR2")" = 429 ] && kbody "$KR2" | grep -q 'You can refresh again in' || fail "a second refresh within 10 minutes was not a plain 429: $KR2"
[ "$(sysn)" = 5 ] || fail "the refused refresh changed items"
# a second refresh REPLACES (no second set), the old passages and rows are deleted, the new text is in
KR3=$(refresh); A2=$(curl -s localhost:8791/digest-hits | js d.hits); [ "$A2" = $((A1 + 1)) ] || fail "the second refresh did not call the relay once ($A1 -> $A2)"
[ "$(kst "$KR3")" = 200 ] || fail "second refresh: $KR3"
SYSEMB || fail "the second digest was not embedded"
[ "$(kn "SELECT count(*) AS n FROM knowledge_items i JOIN knowledge_collections k ON k.id=i.collection_id WHERE k.system=1")" = 5 ] || fail "the second refresh added items instead of replacing"
NEWI=$(D1X "$SYSQ" | js 'd[0].results.map(r=>r.id).sort().join()'); [ "$NEWI" != "$OLDI" ] || fail "items were not replaced"
for x in $(echo $OLDI | tr , ' '); do [ "$(kn "SELECT count(*) AS n FROM knowledge_items WHERE id='$x'")" = 0 ] || fail "an old item row survived"; done
for x in $(echo $OLDC | tr , ' '); do [ "$(kn "SELECT count(*) AS n FROM knowledge_chunks WHERE id='$x'")" = 0 ] || fail "an old passage survived"; done
[ "$(kn "SELECT count(*) AS n FROM knowledge_chunks c JOIN knowledge_collections k ON k.id=c.collection_id WHERE k.system=1")" -ge 5 ] || fail "no passages after the second refresh"
ks "Stubfinance" $SYS | grep -q "Stubfinance answer $A2\\." && ! ks "Stubfinance" $SYS | grep -q "Stubfinance answer $A1\\." || fail "the old Finance answer is still searchable, or the new one isn't"
# the system collection can't be deleted, switched, renamed, filled by hand or emptied by hand
[ "$(kst "$(kj -X DELETE $B/api/knowledge/collections/$SYS)")" = 409 ] && [ "$(kst "$(kj -X PATCH $B/api/knowledge/collections/$SYS -d '{"name":"x"}')")" = 409 ] && [ "$(kst "$(kj -X PATCH $B/api/knowledge/collections/$SYS -d '{"boundary":"locked"}')")" = 409 ] || fail "the system collection was deleted or changed"
KSI=$(D1X "$SYSQ" | js 'd[0].results[0].id'); [ "$(kst "$(kj -X DELETE $B/api/knowledge/items/$KSI)")" = 409 ] || fail "an app item was removed by hand"
printf 'Pelican notes\n' > /tmp/compass-smoke-k4.md; KD4=$(kid "$(up "@/tmp/compass-smoke-k4.md;filename=k4.md;type=text/markdown")" document)
[ "$(kst "$(kitem $SYS $KD4)")" = 409 ] || fail "a document went into From my apps"
curl "${H[@]}" -X DELETE $B/api/documents/$KD4 >/dev/null; rm -f /tmp/compass-smoke-k4.md
# a source that can't be read keeps yesterday's item with its error; the others refresh
stub '?null=finance,hollow'
KR4=$(refresh); [ "$(kst "$KR4")" = 200 ] && [ "$(kbody "$KR4" | js 'd.ok.join()+"|"+d.errors.finance+"|"+d.errors.hollow')" = "compass,health,home|Finance could not be read.|Hollow could not be read." ] || fail "partial refresh: $KR4"
SYSEMB; [ "$(sysn)" = 5 ] && [ "$(sysn "i.state='ready' AND i.source='app:finance' AND i.error='Finance could not be read.'")" = 1 ] || fail "a failed source did not keep its item with the reason"
ks "Stubfinance" $SYS | grep -q "Stubfinance answer $A2\\." || fail "yesterday's Finance text is gone"
[ "$(curl "${H[@]}" $B/api/knowledge/collections/$SYS/items | js "d.items.filter(i=>i.state==='ready'&&i.error).length")" = 2 ] || fail "the items list does not carry the errors"
stub '?status=502'
KR5=$(refresh); [ "$(kbody "$KR5" | js 'd.ok.join()+"|"+d.errors.finance')" = "compass|Kelly-Cloud answered with an error." ] || fail "relay down: $KR5"
[ "$(sysn)" = 5 ] || fail "the relay being down removed items"
stub ''; KR6=$(refresh); [ "$(kbody "$KR6" | js 'Object.keys(d.errors).length')" = 0 ] && [ "$(sysn "i.error IS NOT NULL")" = 0 ] || fail "a good refresh did not clear the errors: $KR6"
# the cron: once a day after digest_hour (Toronto), not before it, not twice
SET0=$(curl "${H[@]}" $B/api/settings | js d.digest_hour); HRNOW=$(TZ=America/Toronto date +%-H)
SYSEMB; stub ''
donen() { kn "SELECT count(*) AS n FROM audit_log WHERE action='knowledge.apps.done'"; }
if [ "$HRNOW" -lt 23 ] && [ "$(TZ=America/Toronto date +%-H)" = "$HRNOW" ]; then # before the hour (skipped if the hour just rolled over): nothing, even with no attempt on record
  arm; curl "${H[@]}" -X PATCH $B/api/settings -d "{\"digest_hour\":$((HRNOW + 1))}" >/dev/null; cron; sleep 2
  [ "$(donen)" = 0 ] || fail "the cron refreshed before digest_hour"
fi
arm; curl "${H[@]}" -X PATCH $B/api/settings -d "{\"digest_hour\":$HRNOW}" >/dev/null
# v2.2: the refresh runs in the cron beside the purge and the embed pass on one local SQLite, so it can take longer than 10 s: wait up to 40 s (the product rules are unchanged).
# The 10-minute claim is cleared by arm just above; a leftover claim or a lagging done row shows in the failure text.
cron; for _ in $(seq 1 160); do [ "$(donen)" = 1 ] && break; sleep 0.25; done
[ "$(donen)" = 1 ] || fail "the cron did not refresh once digest_hour had come (audit: $(D1X "SELECT action||'@'||at AS r FROM audit_log WHERE action LIKE 'knowledge.apps.%'" | js 'd[0].results.map(r=>r.r).join()'))"
cron; sleep 2; [ "$(donen)" = 1 ] || fail "the cron refreshed twice in one day"
# a day's refresh with a failure, made two hours ago: the next tick tries again (and once it is clean, no more)
TWO=$(date -u -v-2H +%Y-%m-%dT%H:%M:%S.000Z); D1X "UPDATE audit_log SET at='$TWO' WHERE action='knowledge.apps.refresh'; UPDATE audit_log SET at='$TWO', detail='{\"ok\":[],\"failed\":[\"hollow\"]}' WHERE action='knowledge.apps.done'" >/dev/null
cron; for _ in $(seq 1 160); do [ "$(donen)" = 2 ] && break; sleep 0.25; done
[ "$(donen)" = 2 ] || fail "the cron did not retry a failed refresh an hour later"
cron; sleep 2; [ "$(donen)" = 2 ] || fail "the cron retried a clean refresh"
curl "${H[@]}" -X PATCH $B/api/settings -d "{\"digest_hour\":$SET0}" >/dev/null
echo "smoke: (k4) From my apps: five items (compass, finance, health, home, hollow) personal and plain, embedded and searchable, no work task in the Compass part; Refresh now -> 429 within 10 minutes; a second refresh replaces (old rows, passages and answers gone); a failing source keeps yesterday's item with its error, a down relay keeps them all, a good refresh clears the errors; the system collection can't be deleted, changed, filled or emptied by hand; the cron refreshes once after digest_hour and retries a failed day's refresh an hour later"
# (k5) Knowledge, Task 5 (KN8): Kelly's knowledge search. Scope off -> 403; on -> personal Cloud AI passages only; a work Cloud AI collection, a Locked one, the
# the "From my apps" digest does come back (KN20), a trashed personal one never does; limit and q validated; audited with counts and no query text.
KS=$(mktemp -d)
mkdocx $KS/oc-p.docx "The ocelot$R picnic basket is blue."
mkdocx $KS/oc-w.docx "The ocelot$R vendor contract renews in June."
mkdocx $KS/oc-l.docx "The ocelot$R merger terms stay Locked."
K5P=$(kid "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke k5 personal","scope":"personal"}')" collection)
K5W=$(kid "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke k5 work cloud","scope":"work","boundary":"cloud"}')" collection)
K5L=$(kid "$(kj -X POST $B/api/knowledge/collections -d '{"name":"Smoke k5 locked","scope":"work"}')" collection)
D5P=$(kid "$(up "@$KS/oc-p.docx;filename=oc-p.docx;type=$DOCX")" document); D5W=$(kid "$(up "@$KS/oc-w.docx;filename=oc-w.docx;type=$DOCX" -F knowledge_work=1)" document); D5L=$(kid "$(up "@$KS/oc-l.docx;filename=oc-l.docx;type=$DOCX" -F knowledge_work=1)" document)
I5P=$(kid "$(kitem $K5P $D5P)" item); I5W=$(kid "$(kitem $K5W $D5W)" item); kitem $K5L $D5L >/dev/null
kwait $K5P $I5P ready && kwait $K5W $I5W ready || fail "k5: the passages did not become ready"
D1X "DELETE FROM audit_log WHERE actor='kelly' AND action LIKE 'agent.%'" >/dev/null
KQ="/knowledge/search?q=ocelot$R+contract+picnic+merger"
kset '{"enabled":true,"scopes":["compass:read.tasks"]}'
[ "$(agc GET "$KQ")" = 403 ] && agb GET "$KQ" | grep -q scope_not_granted || fail "k5: knowledge search without the scope is not 403 scope_not_granted"
kset '{"enabled":true,"scopes":["compass:read.knowledge"]}'
K5R=$(agb GET "$KQ&limit=8"); [ "$(agc GET "$KQ&limit=8")" = 200 ] || fail "k5: knowledge search with the scope: $K5R"
[ "$(echo "$K5R" | js 'd.passages.length>=1&&d.passages.every(p=>Object.keys(p).sort().join()==="collection,document,locator,text")&&d.passages.some(p=>p.text.includes("picnic")&&p.document==="oc-p.docx"&&p.collection==="Smoke k5 personal"&&p.locator==="part 1")')" = true ] || fail "k5: the personal passage did not come back in the agreed shape: $K5R"
echo "$K5R" | grep -q "vendor contract" && fail "k5: a work Cloud AI passage reached Kelly"
echo "$K5R" | grep -q "merger terms" && fail "k5: a Locked passage reached Kelly"
echo "$K5R" | grep -q "Smoke k5 work" && fail "k5: a work collection name reached Kelly"
# the cron embeds in its own isolate (the local vector store is per isolate), so refresh by hand here to put the digest's vectors where the fetch handlers see them
stub ''; refresh >/dev/null; SYSEMB || fail "k5: the digest was not embedded"
[ "$(agb GET "/knowledge/search?q=Stubfinance&limit=8" | js 'd.passages.some(p=>p.text.includes("Stubfinance")&&p.collection==="From my apps")')" = true ] || fail "k5: the From my apps digest did not come back to Kelly"
agb GET "/knowledge/search?q=ocelot$R+vendor+contract+renews&collections=$K5W" | js 'd.passages.every(p=>!p.text.includes("renews in June"))' | grep -q true || fail "k5: a collections= parameter reached the search"
[ "$(agb GET "/knowledge/search?q=ocelot$R+vendor+contract+renews&limit=8" | js 'd.passages.some(p=>p.text.includes("renews in June"))')" = false ] || fail "k5: a work passage matched on its own words"
[ "$(agc GET "/knowledge/search?q=a")" = 400 ] && [ "$(agc GET "/knowledge/search")" = 400 ] && [ "$(agc GET "$KQ&limit=9")" = 400 ] && [ "$(agc GET "$KQ&limit=0")" = 400 ] && [ "$(agc GET "/knowledge/search?q=$(printf 'x%.0s' $(seq 301))")" = 400 ] || fail "k5: q or limit not validated"
[ "$(agb GET "$KQ&limit=1" | js 'd.passages.length')" = 1 ] || fail "k5: limit 1 not honoured"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE actor='kelly' AND action='agent.knowledge.search' AND detail LIKE '{\"ok\":true,\"passages\":%' AND detail NOT LIKE '%ocelot%'" | js 'd[0].results[0].n')" -ge 2 ] || fail "k5: the search was not audited with counts"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE actor='kelly' AND (detail LIKE '%ocelot%' OR coalesce(target,'') LIKE '%ocelot%')" | js 'd[0].results[0].n')" = 0 ] || fail "k5: the query reached the audit log"
curl "${H[@]}" "$B/api/kelly/log?limit=50" | js 'd.rows.some(r=>r.action==="agent.knowledge.search")' | grep -q true || fail "k5: the search is not in Kelly's activity"
curl "${H[@]}" -X DELETE $B/api/knowledge/collections/$K5P >/dev/null
[ "$(agb GET "$KQ&limit=8" | js 'd.passages.some(p=>p.collection==="Smoke k5 personal")')" = false ] || fail "k5: a trashed personal collection is still searched"
echo "smoke: (k5) Kelly knowledge search: scope off -> 403; on -> personal passages only in the agreed shape (a work Cloud AI collection, a Locked one and a collections= parameter never reach her), q and limit validated, audited with counts and no query text, a trashed collection leaves"
D1X "DELETE FROM audit_log WHERE actor='kelly' AND action LIKE 'agent.%'" >/dev/null; kset '{"enabled":false,"scopes":[]}'
for x in $K5W $K5L; do curl "${H[@]}" -X DELETE $B/api/knowledge/collections/$x >/dev/null; done
# (v1) v2.1 Task 0: dependencies. Link; a loop is 409; another kind is 400; a bad list is 400; completing the last blocker pushes once ("A task is unblocked" for
# work, the title for personal, the deep link opens the task); Kelly completing a blocker does the same; the agent task shape did not grow. Local D1 only.
Q0=$(curl "${H[@]}" $B/api/settings | js '[d.quiet_from,d.quiet_to].join()'); curl "${H[@]}" -X PATCH $B/api/settings -d '{"quiet_from":"00:00","quiet_to":"00:00"}' >/dev/null # never quiet while this runs
restore_quiet() { [ -z "${Q0:-}" ] || curl -s -b $J -c $J -H "Origin: $B" -H "Content-Type: application/json" -X PATCH $B/api/settings -d "{\"quiet_from\":\"${Q0%,*}\",\"quiet_to\":\"${Q0#*,}\"}" >/dev/null || true; Q0=; } # also called by fail()
dwp=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke deps work","kind":"work"}' | js d.project.id)
dt() { curl "${H[@]}" -X POST $B/api/tasks -d "$1" | js d.task.id; }
DW1=$(dt "{\"title\":\"Smoke dep work A $R\",\"project_id\":\"$dwp\"}"); DW2=$(dt "{\"title\":\"Smoke dep work B $R\",\"project_id\":\"$dwp\"}")
DW3=$(dt "{\"title\":\"Smoke dep work C $R\",\"project_id\":\"$dwp\"}"); DP1=$(dt "{\"title\":\"Smoke dep own A $R\"}"); DP2=$(dt "{\"title\":\"Smoke dep own B $R\"}")
bb() { node -pe 'JSON.stringify({blocked_by:JSON.stringify(process.argv.slice(1))})' "$@"; } # a PATCH body linking the given ids
dpatch() { curl "${H[@]}" -w '\n%{http_code}' -X PATCH $B/api/tasks/$1 -d "$2"; }
[ "$(kst "$(dpatch $DW2 "{\"blocked_by\":\"[\\\"$DW1\\\"]\"}")")" = 200 ] || fail "v1: linking B to A"
[ "$(task $DW2 blocked_by)" = "[\"$DW1\"]" ] || fail "v1: blocked_by was not stored"
[ "$(D1X "SELECT blocked_by AS b FROM tasks WHERE id='$DW2'" | js 'd[0].results[0].b')" = "[\"$DW1\"]" ] || fail "v1: blocked_by is not what the row holds"
# a loop (A waits on B waits on A) and a longer one (C waits on B; A on C)
D=$(dpatch $DW1 "{\"blocked_by\":\"[\\\"$DW2\\\"]\"}"); [ "$(kst "$D")" = 409 ] && kbody "$D" | grep -q dependency_cycle || fail "v1: a direct loop was not 409 dependency_cycle: $D"
[ "$(kst "$(dpatch $DW3 "{\"blocked_by\":\"[\\\"$DW2\\\"]\"}")")" = 200 ] || fail "v1: linking C to B"
D=$(dpatch $DW1 "{\"blocked_by\":\"[\\\"$DW3\\\"]\"}"); [ "$(kst "$D")" = 409 ] || fail "v1: a loop of three was not refused: $D"
D=$(dpatch $DW1 "{\"blocked_by\":\"[\\\"$DW1\\\"]\"}"); [ "$(kst "$D")" = 400 ] && kbody "$D" | grep -q bad_dependency || fail "v1: a task blocking itself was not 400 bad_dependency: $D"
# other kind, a missing task, a trashed one, a bad list, a duplicate, and a kind change while linked: all 400
D=$(dpatch $DW1 "{\"blocked_by\":\"[\\\"$DP1\\\"]\"}"); [ "$(kst "$D")" = 400 ] && kbody "$D" | grep -q bad_dependency || fail "v1: a personal blocker for a work task was not 400: $D"
[ "$(kst "$(dpatch $DP1 "{\"blocked_by\":\"[\\\"$DW1\\\"]\"}")")" = 400 ] || fail "v1: a work blocker for a personal task was not 400"
[ "$(kst "$(dpatch $DP1 '{"blocked_by":"[\"no-such-task\"]"}')")" = 400 ] || fail "v1: a missing blocker was not 400"
[ "$(kst "$(dpatch $DP1 '{"blocked_by":"nope"}')")" = 400 ] && [ "$(kst "$(dpatch $DP1 "$(bb $DP2 $DP2)")")" = 400 ] || fail "v1: a malformed or duplicate list was not 400"
DT=$(dt "{\"title\":\"Smoke dep trashed $R\"}"); curl "${H[@]}" -X DELETE $B/api/tasks/$DT >/dev/null
[ "$(kst "$(dpatch $DP1 "{\"blocked_by\":\"[\\\"$DT\\\"]\"}")")" = 400 ] || fail "v1: a trashed blocker was accepted"
D=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/tasks -d "{\"title\":\"Smoke dep bad create $R\",\"blocked_by\":\"[\\\"$DW1\\\"]\"}"); [ "$(kst "$D")" = 400 ] || fail "v1: creating a personal task blocked by a work one was not 400"
[ "$(kst "$(dpatch $DP2 '{"kind":"work"}')")" = 200 ] && [ "$(kst "$(dpatch $DP2 '{"kind":"personal"}')")" = 200 ] || fail "v1: setup for the kind-change check"
[ "$(kst "$(dpatch $DP2 "{\"blocked_by\":\"[\\\"$DP1\\\"]\"}")")" = 200 ] || fail "v1: linking personal B to personal A"
curl "${H[@]}" -X PATCH $B/api/tasks/$DP2 -d '{"project_id":"'$dwp'"}' | grep -q '"error":"bad_dependency"' || fail "v1: a linked task moved to a work project (kind change) was not refused"
# ... but one PATCH that moves it AND clears its links is fine (the new list is what counts)
DP4=$(dt "{\"title\":\"Smoke dep own D $R\"}"); [ "$(kst "$(dpatch $DP4 "$(bb $DP1)")")" = 200 ] || fail "v1: linking D"
[ "$(kst "$(dpatch $DP4 '{"project_id":"'$dwp'","blocked_by":null}')")" = 200 ] && [ "$(task $DP4 kind)" = work ] || fail "v1: moving a task to a work project while clearing its links was refused"
# a loop cannot be closed behind a trashed task: X waits on A, A waits on B, A is trashed; B waiting on X is still a loop
LX=$(dt "{\"title\":\"Smoke dep loop X $R\"}"); LA=$(dt "{\"title\":\"Smoke dep loop A $R\"}"); LB=$(dt "{\"title\":\"Smoke dep loop B $R\"}")
[ "$(kst "$(dpatch $LA "$(bb $LB)")")" = 200 ] && [ "$(kst "$(dpatch $LX "$(bb $LA)")")" = 200 ] || fail "v1: loop setup"
curl "${H[@]}" -X DELETE $B/api/tasks/$LA >/dev/null
D=$(dpatch $LB "$(bb $LX)"); [ "$(kst "$D")" = 409 ] || fail "v1: a loop through a trashed task was accepted: $D"
for x in $LX $LA $LB $DP4; do curl "${H[@]}" -X DELETE $B/api/tasks/$x >/dev/null; done
# work: completing A (the last blocker of B) pushes once and generically; the deep link opens B
SINCE=$(node -pe 'new Date(Date.now()-1000).toISOString()')
curl "${H[@]}" -X POST $B/api/tasks/$DW1/done | grep -q '"status":"done"' || fail "v1: completing the blocker"
UBW=$(curl "${H[@]}" "$B/api/push/outbox?since=$SINCE" | js "JSON.stringify(d.items.filter(i=>i.url==='/?task=$DW2'))")
[ "$(echo "$UBW" | js d.length)" = 1 ] && echo "$UBW" | js 'd[0].title' | grep -q '^A task is unblocked$' || fail "v1: expected one 'A task is unblocked' push for B: $UBW"
echo "$UBW" | grep -q "Smoke dep work" && fail "v1: work text reached the push"
curl "${H[@]}" -X POST $B/api/tasks/$DW1/done >/dev/null # already done: nothing more
[ "$(curl "${H[@]}" "$B/api/push/outbox?since=$SINCE" | js "d.items.filter(i=>i.url==='/?task=$DW2').length")" = 1 ] || fail "v1: a second 'done' pushed again"
# B still waits on nothing but C waits on B: completing B unblocks C; the switch off silences it
curl "${H[@]}" -X PATCH $B/api/settings -d '{"push":{"unblocked":false}}' >/dev/null
curl "${H[@]}" -X POST $B/api/tasks/$DW2/done >/dev/null
[ "$(curl "${H[@]}" "$B/api/push/outbox?since=$SINCE" | js "d.items.filter(i=>i.url==='/?task=$DW3').length")" = 0 ] || fail "v1: settings.push.unblocked=false still pushed"
curl "${H[@]}" -X PATCH $B/api/settings -d '{"push":{"unblocked":true}}' >/dev/null
# two blockers: only the last one pushes. Personal text names the task. Kelly completing a blocker counts (the one completion path).
DP3=$(dt "{\"title\":\"Smoke dep own C $R\"}")
[ "$(kst "$(dpatch $DP3 "$(bb $DP1 $DP2)")")" = 200 ] && [ "$(task $DP3 blocked_by | js 'd.length')" = 2 ] || fail "v1: two blockers"
kset '{"enabled":true,"scopes":["compass:read.tasks","compass:write.tasks"]}'
D1X "DELETE FROM audit_log WHERE actor='kelly' AND action LIKE 'agent.%'" >/dev/null
SINCE=$(node -pe 'new Date(Date.now()-1000).toISOString()')
[ "$(agc POST "/tasks/$DP1/done")" = 200 ] || fail "v1: Kelly could not complete a personal task"
[ "$(curl "${H[@]}" "$B/api/push/outbox?since=$SINCE" | js "d.items.filter(i=>i.url==='/?task=$DP3').length")" = 0 ] || fail "v1: pushed while another blocker was still open"
[ "$(agc POST "/tasks/$DP2/done")" = 200 ] || fail "v1: Kelly could not complete the second blocker"
[ "$(curl "${H[@]}" "$B/api/push/outbox?since=$SINCE" | js "d.items.filter(i=>i.url==='/?task=$DP3'&&i.title==='Smoke dep own C $R is unblocked').length")" = 1 ] || fail "v1: Kelly completing the last blocker did not push '<title> is unblocked' once"
restore_quiet # the push checks are done
# the agent task shape did not grow: the real responses of the read, list and create routes carry exactly these keys (no blocked_by, no checklist)
AK="due_at,horizon,id,priority,project,status,title"
[ "$(agb GET "/tasks/$DP3" | js 'Object.keys(d.task).sort().join()')" = "$AK" ] || fail "v1: the agent task shape changed (get)"
AN=$(agb POST "/tasks" "{\"title\":\"Smoke agent shape $R\",\"due_at\":\"$(date +%F)\"}"); [ "$(echo "$AN" | js 'Object.keys(d.task).sort().join()')" = "$AK" ] || fail "v1: the agent task shape changed (create)"
[ "$(agb GET "/tasks?view=today&limit=50" | js 'd.tasks.length>0&&d.tasks.every(t=>Object.keys(t).sort().join()==="'$AK'")')" = true ] || fail "v1: the agent task shape changed (list)"
curl "${H[@]}" -X DELETE $B/api/tasks/$(echo "$AN" | js d.task.id) >/dev/null
D1X "DELETE FROM audit_log WHERE actor='kelly' AND action LIKE 'agent.%'" >/dev/null; kset '{"enabled":false,"scopes":[]}'
# a checklist column exists and a work task's is not plain (sealed by the shared seal path; Task 1 writes it)
[ "$(D1X "SELECT count(*) AS n FROM pragma_table_info('tasks') WHERE name IN ('blocked_by','checklist')" | js 'd[0].results[0].n')" = 2 ] || fail "v1: migration 0014 task columns"
# final review I1: a link kept in the list that points to a trashed (then purged) task stays; only a NEWLY added link is checked, so the other links stay editable
KA=$(dt "{\"title\":\"Smoke keep A $R\"}"); KB=$(dt "{\"title\":\"Smoke keep B $R\"}"); KC=$(dt "{\"title\":\"Smoke keep C $R\"}"); KX=$(dt "{\"title\":\"Smoke keep X $R\"}")
[ "$(kst "$(dpatch $KX "$(bb $KA $KB)")")" = 200 ] || fail "v1: keep setup"
curl "${H[@]}" -X DELETE $B/api/tasks/$KA >/dev/null
[ "$(kst "$(dpatch $KX "$(bb $KA $KB $KC)")")" = 200 ] || fail "v1: adding a link while another is trashed was refused"
[ "$(kst "$(dpatch $KX "$(bb $KA $KC)")")" = 200 ] || fail "v1: removing a link while another is trashed was refused"
D1X "DELETE FROM task_events WHERE task_id='$KA'" >/dev/null; D1X "DELETE FROM tasks WHERE id='$KA'" >/dev/null # purged: the id stays in the list
[ "$(kst "$(dpatch $KX "$(bb $KA $KB)")")" = 200 ] && [ "$(task $KX blocked_by | js 'd.length')" = 2 ] || fail "v1: editing links next to a purged blocker was refused"
[ "$(kst "$(dpatch $KX "$(bb $KA $KB $KA)")")" = 400 ] || fail "v1: a duplicate next to a purged blocker was not 400"
D=$(dpatch $KB "$(bb $KX)"); [ "$(kst "$D")" = 409 ] || fail "v1: a loop was not refused with a purged blocker in the list: $D"
for x in $KB $KC $KX; do curl "${H[@]}" -X DELETE $B/api/tasks/$x >/dev/null; done
for x in $DW1 $DW2 $DW3 $DP1 $DP2 $DP3; do curl "${H[@]}" -X DELETE $B/api/tasks/$x >/dev/null; done; curl "${H[@]}" -X DELETE $B/api/projects/$dwp >/dev/null
echo "smoke: (v1) dependencies: link ok; loops 409 (direct and of three); self, other kind, missing, trashed, malformed, duplicate and a kind change while linked 400; completing the last blocker pushed once ('A task is unblocked' for work, '<title> is unblocked' for personal via Kelly), the switch silences it, the deep link is /?task=<id>; the agent task keys are unchanged"
# (v2) v2.1 Task 1: checklists. Create with one, tick through PATCH, a work task's raw D1 value is ciphertext (a personal one is plain JSON), a recurring task's next
# occurrence carries the checklist unticked, and a bad list (51 items, an item over 200 characters, empty text, a repeated id, done not a boolean) is 400.
ckp=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke checklist work","kind":"work"}' | js d.project.id)
CL='[{"id":"c1","text":"Smoke step one '$R'","done":false},{"id":"c2","text":"Smoke step two '$R'","done":true}]'
cpost() { curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/tasks -d "$1"; }
CW=$(dt "$(node -pe 'JSON.stringify({title:"Smoke checklist work '$R'",project_id:process.argv[1],checklist:process.argv[2]})' "$ckp" "$CL")"); [ -n "$CW" ] && [ "$CW" != null ] || fail "v2: create with a checklist"
[ "$(task $CW checklist)" = "$CL" ] || fail "v2: the checklist did not come back as sent: $(task $CW checklist)"
RAW=$(D1X "SELECT checklist AS c, enc_v AS e FROM tasks WHERE id='$CW'" | js 'd[0].results[0].c+"|"+d[0].results[0].e')
case "$RAW" in *"Smoke step"*|\[*) fail "v2: a work task's checklist is not sealed in D1: $RAW";; esac
[ "${RAW##*|}" != 0 ] || fail "v2: a work task's enc_v is 0"
TICK=$(echo "$CL" | js 'JSON.stringify(d.map(i=>({...i,done:true})))')
[ "$(kst "$(dpatch $CW "$(node -pe 'JSON.stringify({checklist:process.argv[1]})' "$TICK")")")" = 200 ] && [ "$(task $CW checklist)" = "$TICK" ] || fail "v2: ticking through PATCH"
D1X "SELECT checklist AS c FROM tasks WHERE id='$CW'" | js 'd[0].results[0].c' | grep -q "Smoke step" && fail "v2: the ticked work checklist was stored plain"
[ "$(kst "$(dpatch $CW '{"checklist":null}')")" = 200 ] && [ "$(task $CW checklist)" = null ] || fail "v2: clearing the checklist"
CP=$(dt "$(node -pe 'JSON.stringify({title:"Smoke checklist own '$R'",checklist:process.argv[1]})' "$CL")")
[ "$(D1X "SELECT checklist AS c FROM tasks WHERE id='$CP'" | js 'd[0].results[0].c')" = "$CL" ] || fail "v2: a personal checklist is plain JSON in D1"
# bad lists are 400
bad() { local D; D=$(dpatch $CP "$(node -pe 'JSON.stringify({checklist:process.argv[1]})' "$1")"); [ "$(kst "$D")" = 400 ] || fail "v2: $2 was not 400: $D"; }
bad "$(node -pe 'JSON.stringify(Array.from({length:51},(_,i)=>({id:"i"+i,text:"x",done:false})))')" "51 items"
bad "$(node -pe 'JSON.stringify([{id:"a",text:"x".repeat(201),done:false}])')" "an item of 201 characters"
bad '[{"id":"a","text":"","done":false}]' "an empty item"
bad '[{"id":"a","text":"x","done":false},{"id":"a","text":"y","done":false}]' "a repeated id"
bad '[{"id":"a","text":"x","done":"yes"}]' "done not a boolean"
bad 'not json' "text that is not JSON"
[ "$(kst "$(dpatch $CP "$(node -pe 'JSON.stringify({checklist:JSON.stringify(Array.from({length:50},(_,i)=>({id:"i"+i,text:"x".repeat(200),done:false})))})')")")" = 200 ] || fail "v2: 50 items of 200 characters was refused"
[ "$(kst "$(cpost "$(node -pe 'JSON.stringify({title:"Smoke bad create '$R'",checklist:"[{}]"})')")")" = 400 ] || fail "v2: a bad checklist on create was not 400"
# recurrence: done makes the next occurrence with the same items, every one unticked
RULE='{"freq":"daily","interval":1}'
RC=$(dt "$(node -pe 'JSON.stringify({title:"Smoke checklist recur '$R'",project_id:process.argv[1],due_at:"2026-01-01",recur:process.argv[3],checklist:process.argv[2]})' "$ckp" "$CL" "$RULE")")
curl "${H[@]}" -X POST $B/api/tasks/$RC/done | grep -q '"status":"done"' || fail "v2: recurring task done"
RN=$(curl "${H[@]}" "$B/api/tasks?status=all" | js '(d.tasks.find(t=>t.title==="Smoke checklist recur '$R'"&&t.id!=="'$RC'"&&t.status==="new")||{}).id'); [ -n "$RN" ] && [ "$RN" != undefined ] || fail "v2: no next occurrence"
[ "$(task $RN checklist)" = "$(echo "$CL" | js 'JSON.stringify(d.map(i=>({...i,done:false})))')" ] || fail "v2: the next occurrence's checklist is not the same items unticked: $(task $RN checklist)"
D1X "SELECT checklist AS c FROM tasks WHERE id='$RN'" | js 'd[0].results[0].c' | grep -q "Smoke step" && fail "v2: the next occurrence's work checklist was stored plain"
for x in $CW $CP $RC $RN; do curl "${H[@]}" -X DELETE $B/api/tasks/$x >/dev/null; done; curl "${H[@]}" -X DELETE $B/api/projects/$ckp >/dev/null
echo "smoke: (v2) checklists: create and tick ok; a work checklist is ciphertext in D1, a personal one plain; 51 items, 201 characters, empty text, a repeated id, done not a boolean and bad JSON are 400 (50 x 200 is fine); the next occurrence of a recurring task carries the items unticked"
# (v3) v2.1 Task 2: templates. Save a project (3 tasks, 1 milestone) as a template and apply it with a new start: dates shift, no blocked_by, checklists unticked, parent link kept, events say 'template'.
# A built-in as work makes sealed rows; a work template into a personal project is 400; rename and delete work.
tpost() { curl "${H[@]}" -w '\n%{http_code}' -X POST "$B/api/templates$1" -d "$2"; }
want() { local w=$1 r; shift; r=$(tpost "$@"); [ "$(kst "$r")" = "$w" ]; } # status check without nesting the JSON in $(...) (macOS bash 3.2 splits it on commas)
tget() { curl "${H[@]}" $B/api/templates; }
SP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke template source","kind":"personal"}' | js d.project.id)
TA=$(dt "$(node -pe 'JSON.stringify({title:"Smoke tpl A '$R'",project_id:process.argv[1],start_at:"2026-03-02",due_at:"2026-03-05",priority:2,checklist:JSON.stringify([{id:"a",text:"Smoke tpl step",done:true}])})' "$SP")")
TB=$(dt "$(node -pe 'JSON.stringify({title:"Smoke tpl B '$R'",project_id:process.argv[1],due_at:"2026-03-10",blocked_by:JSON.stringify([process.argv[2]])})' "$SP" "$TA")")
TC=$(dt "$(node -pe 'JSON.stringify({title:"Smoke tpl C '$R'",project_id:process.argv[1],parent_id:process.argv[2]})' "$SP" "$TA")")
curl "${H[@]}" -X POST $B/api/projects/$SP/milestones -d '{"name":"Smoke tpl milestone","due_at":"2026-03-12","gate":1}' | grep -q '"milestone"' || fail "v3: milestone"
curl "${H[@]}" -X PATCH $B/api/tasks/$TC -d '{"parent_id":"'$TA'"}' >/dev/null
O=$(tpost "" "{\"name\":\"Smoke tpl $R\",\"from_project_id\":\"$SP\"}"); [ "$(kst "$O")" = 201 ] || fail "v3: save project as template: $O"
TPL=$(kbody "$O" | js d.template.id)
[ "$(kbody "$O" | js "d.template.tasks+'/'+d.template.milestones+'/'+d.template.scope+'/'+d.template.kind")" = "3/1/project/personal" ] || fail "v3: template counts: $O"
tget | js "d.templates.filter(t=>t.builtin).map(t=>t.name).join('|')" | grep -q 'Project kickoff|Vendor onboarding|Change / release' || fail "v3: the three built-ins are listed"
tget | js "d.templates.some(t=>t.id==='$TPL'&&t.builtin===false&&t.name==='Smoke tpl $R')" | grep -q true || fail "v3: the saved template is listed"
tget | grep -q 'blocked_by' && fail "v3: a template list carries a body"
D1X "SELECT body AS b FROM templates WHERE id='$TPL'" | js 'd[0].results[0].b' | grep -q blocked_by && fail "v3: a template carries blocked_by"
A=$(tpost /apply "{\"template_id\":\"$TPL\",\"start_date\":\"2026-06-01\",\"name\":\"Smoke from template $R\"}"); [ "$(kst "$A")" = 201 ] || fail "v3: apply: $A"
NP=$(kbody "$A" | js d.project.id)
curl "${H[@]}" $B/api/projects/$NP | js "d.milestones.map(m=>m.name+':'+m.due_at+':'+m.gate).join()" | grep -qx 'Smoke tpl milestone:2026-06-11:1' || fail "v3: milestone date did not shift"
NT=$(curl "${H[@]}" "$B/api/tasks?status=all&project=$NP")
echo "$NT" | js "d.tasks.length+'|'+d.tasks.map(t=>t.title.replace(/ $R/,'')+':'+t.start_at+':'+t.due_at+':'+t.status+':'+t.blocked_by).sort().join()" | grep -qx '3|Smoke tpl A:2026-06-01:2026-06-04:new:null,Smoke tpl B:null:2026-06-09:new:null,Smoke tpl C:null:null:new:null' || fail "v3: applied tasks wrong: $(echo "$NT" | js "d.tasks.map(t=>t.title+':'+t.start_at+':'+t.due_at+':'+t.status+':'+t.blocked_by).join()")"
NA=$(echo "$NT" | js "d.tasks.find(t=>t.title==='Smoke tpl A $R').id"); NC=$(echo "$NT" | js "d.tasks.find(t=>t.title==='Smoke tpl C $R').id")
[ "$(task $NC parent_id)" = "$NA" ] || fail "v3: the subtask lost its parent"
[ "$(task $NA checklist)" = '[{"id":"a","text":"Smoke tpl step","done":false}]' ] || fail "v3: checklist not unticked: $(task $NA checklist)"
[ "$(task $NA priority)" = 2 ] || fail "v3: priority"
curl "${H[@]}" $B/api/tasks/$NA | js "d.events.map(e=>e.type+':'+e.data).join()" | grep -qx 'created:{"from":"template"}' || fail "v3: the created event does not say template"
# a second apply a month later shifts again (offsets, not dates, are stored)
A2=$(tpost /apply "{\"template_id\":\"$TPL\",\"start_date\":\"2026-07-15\",\"name\":\"Smoke from template 2 $R\"}"); [ "$(kst "$A2")" = 201 ] || fail "v3: second apply"
NP2=$(kbody "$A2" | js d.project.id)
curl "${H[@]}" "$B/api/tasks?status=all&project=$NP2" | js "d.tasks.map(t=>t.due_at).sort().join()" | grep -qx '2026-07-18,2026-07-23,' || fail "v3: second apply dates: $(curl "${H[@]}" "$B/api/tasks?status=all&project=$NP2" | js "d.tasks.map(t=>t.due_at).sort().join()")"
# bad requests
want 400 /apply "{\"template_id\":\"$TPL\",\"name\":\"x\"}" || fail "v3: apply without a start date"
want 400 /apply "{\"template_id\":\"$TPL\",\"start_date\":\"2026-13-40\",\"name\":\"x\"}" || fail "v3: apply with a bad start date"
want 400 /apply "{\"template_id\":\"$TPL\",\"start_date\":\"2026-06-01\",\"project_id\":\"$SP\"}" || fail "v3: a project template into an existing project"
want 404 /apply "{\"template_id\":\"nope\",\"start_date\":\"2026-06-01\"}" || fail "v3: unknown template"
want 404 /apply "{\"builtin\":\"builtin:nope\",\"start_date\":\"2026-06-01\"}" || fail "v3: unknown built-in"
want 400 "" '{"name":"x"}' || fail "v3: save without a source"
want 400 "" "{\"from_task_id\":\"$TA\",\"from_project_id\":\"$SP\",\"name\":\"x\"}" || fail "v3: save from both"
want 400 "" "{\"from_task_id\":\"$TA\"}" || fail "v3: save without a name"
want 404 "" '{"from_task_id":"nope","name":"x"}' || fail "v3: save from a missing task"
# a built-in as work: sealed rows, Offline only
W=$(tpost /apply "{\"builtin\":\"builtin:vendor\",\"kind\":\"work\",\"start_date\":\"2026-06-01\",\"name\":\"Smoke vendor work $R\"}"); [ "$(kst "$W")" = 201 ] || fail "v3: built-in as work: $W"
WP=$(kbody "$W" | js d.project.id)
[ "$(kbody "$W" | js "d.project.kind+'/'+d.project.data_boundary+'/'+d.tasks.length+'/'+d.milestones.length")" = "work/offline/6/3" ] || fail "v3: built-in work project shape: $W"
[ "$(D1X "SELECT p.enc_v AS pe, p.name AS pn, (SELECT COUNT(*) FROM tasks WHERE project_id=p.id AND enc_v=2 AND title NOT LIKE '%Agree the NDA%') AS ts, (SELECT COUNT(*) FROM milestones WHERE project_id=p.id AND enc_v=2 AND name NOT LIKE '%Contract%') AS ms, (SELECT COUNT(*) FROM task_events e JOIN tasks t ON t.id=e.task_id WHERE t.project_id=p.id AND e.enc_v=2 AND e.data NOT LIKE '%template%') AS es FROM projects p WHERE p.id='$WP'" | js "const r=d[0].results[0]; r.pe+'/'+(r.pn.includes('Smoke vendor')?'plain':'sealed')+'/'+r.ts+'/'+r.ms+'/'+r.es")" = "2/sealed/6/3/6" ] || fail "v3: a built-in applied as work is not sealed"
curl "${H[@]}" "$B/api/tasks?status=all&project=$WP" | js "d.tasks.every(t=>t.kind==='work')&&d.tasks.some(t=>t.title.includes('security questionnaire'))" | grep -q true || fail "v3: work tasks read back opened"
# a built-in is personal unless told otherwise
PB=$(tpost /apply "{\"builtin\":\"builtin:change\",\"start_date\":\"2026-06-01\",\"name\":\"Smoke change $R\"}"); [ "$(kbody "$PB" | js "d.project.kind+'/'+d.project.data_boundary+'/'+d.tasks.length")" = "personal/cloud/7" ] || fail "v3: built-in default kind: $PB"
PBP=$(kbody "$PB" | js d.project.id)
want 400 /apply "{\"builtin\":\"builtin:change\",\"kind\":\"secret\",\"start_date\":\"2026-06-01\",\"name\":\"x\"}" || fail "v3: bad kind"
want 400 /apply "{\"builtin\":\"builtin:change\",\"start_date\":\"2026-06-01\",\"name\":\"\"}" || fail "v3: blank project name"
# a work task template: sealed in D1, listed opened, and it only goes to a work destination
WT=$(dt "$(node -pe 'JSON.stringify({title:"Smoke work tpl task '$R'",project_id:process.argv[1],due_at:"2026-05-01",notes:"Smoke secret notes"})' "$WP")")
WS=$(dt "$(node -pe 'JSON.stringify({title:"Smoke work tpl sub '$R'",project_id:process.argv[1],due_at:"2026-05-04"})' "$WP")")
curl "${H[@]}" -X PATCH $B/api/tasks/$WS -d '{"parent_id":"'$WT'"}' >/dev/null
O=$(tpost "" "{\"name\":\"Smoke work template $R\",\"from_task_id\":\"$WT\"}"); [ "$(kst "$O")" = 201 ] || fail "v3: save a work task as template: $O"
WTPL=$(kbody "$O" | js d.template.id)
[ "$(kbody "$O" | js "d.template.kind+'/'+d.template.scope+'/'+d.template.tasks")" = "work/task/2" ] || fail "v3: work task template shape: $O"
[ "$(D1X "SELECT enc_v AS e, name AS n, body AS b FROM templates WHERE id='$WTPL'" | js "const r=d[0].results[0]; r.e+'/'+(r.n.includes('Smoke work template')||r.b.includes('Smoke secret')||r.b.includes('Smoke work tpl')?'plain':'sealed')")" = "2/sealed" ] || fail "v3: a work template is not sealed in D1"
tget | js "d.templates.some(t=>t.id==='$WTPL'&&t.name==='Smoke work template $R'&&t.kind==='work')" | grep -q true || fail "v3: the work template's name is not opened in the list"
# same-kind rule: a work template into a personal project, or told to be personal, is 400; into a work project it works
E=$(tpost /apply "{\"template_id\":\"$WTPL\",\"start_date\":\"2026-06-01\",\"project_id\":\"$SP\"}"); [ "$(kst "$E")" = 400 ] && [ "$(kbody "$E" | js d.error)" = template_kind ] || fail "v3: a work template into a personal project was not 400 template_kind: $E"
want 400 /apply "{\"template_id\":\"$WTPL\",\"start_date\":\"2026-06-01\",\"kind\":\"personal\"}" || fail "v3: a work template told to be personal"
want 400 /apply "{\"template_id\":\"$TPL\",\"start_date\":\"2026-06-01\",\"kind\":\"work\",\"name\":\"x\"}" || fail "v3: a personal template told to be work"
X=$(tpost /apply "{\"template_id\":\"$WTPL\",\"start_date\":\"2026-08-03\",\"project_id\":\"$WP\"}"); [ "$(kst "$X")" = 201 ] || fail "v3: a work task template into a work project: $X"
[ "$(kbody "$X" | js "d.tasks.length+'|'+d.tasks.map(t=>t.due_at+':'+(t.parent_id?'sub':'top')+':'+t.kind).join()")" = "2|2026-08-03:top:work,2026-08-06:sub:work" ] || fail "v3: the work task template's dates or parent: $X"
XT=$(kbody "$X" | js "d.tasks[0].id"); [ "$(task $XT notes)" = "Smoke secret notes" ] || fail "v3: notes lost"
[ "$(D1X "SELECT enc_v AS e FROM tasks WHERE id='$XT'" | js d[0].results[0].e)" = 2 ] || fail "v3: the task made from a work template is not sealed"
# a personal task template can be standalone or go into a personal project; into a work project is 400
PT=$(tpost "" "{\"name\":\"Smoke personal task tpl $R\",\"from_task_id\":\"$TA\"}"); PTPL=$(kbody "$PT" | js d.template.id)
[ "$(kbody "$PT" | js "d.template.kind+'/'+d.template.scope+'/'+d.template.tasks")" = "personal/task/2" ] || fail "v3: personal task template shape: $PT"
want 201 /apply "{\"template_id\":\"$PTPL\",\"start_date\":\"2026-09-01\"}" || fail "v3: standalone personal task template"
want 400 /apply "{\"template_id\":\"$PTPL\",\"start_date\":\"2026-09-01\",\"project_id\":\"$WP\"}" || fail "v3: a personal task template into a work project"
want 404 /apply "{\"template_id\":\"$PTPL\",\"start_date\":\"2026-09-01\",\"project_id\":\"nope\"}" || fail "v3: task template into a missing project"
# rename and delete
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/templates/$WTPL -d '{"name":"Smoke renamed work '$R'"}')" = 200 ] || fail "v3: rename"
tget | js "d.templates.some(t=>t.id==='$WTPL'&&t.name==='Smoke renamed work $R')" | grep -q true || fail "v3: renamed name not listed"
[ "$(D1X "SELECT enc_v AS e, name AS n FROM templates WHERE id='$WTPL'" | js "const r=d[0].results[0]; r.e+'/'+(r.n.includes('renamed')?'plain':'sealed')")" = "2/sealed" ] || fail "v3: a renamed work template is not sealed"
want 201 /apply "{\"template_id\":\"$WTPL\",\"start_date\":\"2026-08-03\",\"project_id\":\"$WP\"}" || fail "v3: apply after rename (the body survives)"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/templates/$WTPL -d '{"name":""}')" = 400 ] || fail "v3: blank rename"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/templates/builtin:kickoff -d '{"name":"x"}')" = 404 ] || fail "v3: a built-in cannot be renamed"
for id in $TPL $WTPL $PTPL; do [ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X DELETE $B/api/templates/$id)" = 200 ] || fail "v3: delete $id"; done
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X DELETE $B/api/templates/$TPL)" = 404 ] || fail "v3: delete twice"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X DELETE $B/api/templates/builtin:kickoff)" = 404 ] || fail "v3: a built-in cannot be deleted"
tget | js "d.templates.filter(t=>!t.builtin&&t.name.includes('$R')).length" | grep -qx 0 || fail "v3: deleted templates still listed"
# Trash lists a deleted template (name opened, no body) and restores it
curl "${H[@]}" $B/api/trash | js "d.templates.some(t=>t.id==='$WTPL'&&t.name==='Smoke renamed work $R'&&t.body===undefined)" | grep -q true || fail "v3: Trash does not list the deleted work template by name"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/trash/templates/$PTPL/restore)" = 200 ] || fail "v3: restore a template from Trash"
tget | js "d.templates.some(t=>t.id==='$PTPL')" | grep -q true || fail "v3: a restored template is not listed"
curl "${H[@]}" -X DELETE $B/api/templates/$PTPL >/dev/null
want 404 /apply "{\"template_id\":\"$TPL\",\"start_date\":\"2026-06-01\",\"name\":\"x\"}" || fail "v3: apply a deleted template"
D1X "DELETE FROM templates WHERE id IN ('$TPL','$WTPL','$PTPL')" >/dev/null # the rows deleted above would wait for the 30-day purge; local D1 only
for x in $SP $NP $NP2 $WP $PBP; do curl "${H[@]}" -X DELETE $B/api/projects/$x >/dev/null; done
# final review I2: a saved template whose subtask comes BEFORE its parent still applies (parents are inserted first)
FB=$(node -pe 'const t=(title,p)=>({title,notes:null,horizon:"short",priority:1,estimate_minutes:null,checklist:[],start_offset:null,due_offset:null,...(p===undefined?{}:{parent_index:p})}); JSON.stringify({project:{name:null,sponsor:null,phase:null,objectives:null,scope_in:null,scope_out:null,success_criteria:null},milestones:[],tasks:[t("Smoke order child",1),t("Smoke order parent")]})')
FID="smoke-order-$R"
D1X "INSERT INTO templates (id,name,kind,scope,body,builtin,created_at,updated_at,enc_v) VALUES ('$FID','Smoke order $R','personal','project','$FB',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',0)" >/dev/null
A=$(tpost /apply "{\"template_id\":\"$FID\",\"start_date\":\"2026-06-01\",\"name\":\"Smoke order project $R\"}"); [ "$(kst "$A")" = 201 ] || fail "v3: a template with the subtask first did not apply: $A"
kbody "$A" | js "(()=>{const c=d.tasks.find(t=>t.title==='Smoke order child'),p=d.tasks.find(t=>t.title==='Smoke order parent');return c.parent_id===p.id&&p.parent_id===null})()" | grep -q true || fail "v3: the subtask's parent link is wrong: $A"
curl "${H[@]}" -X DELETE $B/api/projects/$(kbody "$A" | js d.project.id) >/dev/null; curl "${H[@]}" -X DELETE $B/api/templates/$FID >/dev/null
echo "smoke: (v3) templates: a project of 3 tasks and 1 milestone saved and applied twice with new starts (dates shifted, no blocked_by, checklist unticked, parent kept, events say template); built-ins listed; a built-in as work is sealed (project, milestones, tasks, events) and Offline only; a work task template is sealed in D1, listed opened, and into a personal project, or told to be personal, is 400 template_kind; bad start, scope, source and name are refused; rename and delete work"
# (v4) v2.1 Task 3, meeting series: dated titles land in one series; accepting into a project moves the series with the project; actions (source_ref), done ticks,
# questions answered (sealed list), a move by hand that survives accept, V13 (key is a hash, name sealed), and the project purge clearing the series (FK).
RL=$(printf '%s' "$R" | tr '0-9' 'a-j') # the series key drops digits, so a rerun needs letters of its own
mnotes() { printf '{"app":"sonarflow","kind":"meeting","title":"%s","url":"https://sonarflow.example/rec/ser%s","ref":"sonarflow:recording:ser%s","payload":{"title":"x","summary":"s","decisions":[{"text":"Ship in Q4","at":"00:01"}],"action_items":[],"important_notes":[{"text":"Budget is tight","at":"00:02"}],"open_questions":[{"text":"Who owns the budget?","at":"00:03"}]}}' "$1" "$2$R" "$2$R"; }
mid() { curl "${H[@]}" $B/api/meetings | js "d.meetings.find(m=>m.recording_id==='ser$1$R').id"; }
mser() { curl "${H[@]}" $B/api/meetings/$1 | js d.meeting.series_id; }
post "$IDS" "$(mnotes "Smoke$RL weekly sync – Acme – Oct 14" 1)" | grep -q '"state":"added"' || fail "v4: meeting 1"
post "$IDS" "$(mnotes "Smoke$RL Weekly Sync - ACME (2026-10-21)" 2)" | grep -q '"state":"added"' || fail "v4: meeting 2"
V1=$(mid 1); V2=$(mid 2); VS=$(mser $V1)
[ -n "$VS" ] && [ "$VS" != null ] && [ "$(mser $V2)" = "$VS" ] || fail "v4: two dated titles did not land in one series"
curl "${H[@]}" $B/api/meetings/series | js "const s=d.series.find(x=>x.id==='$VS'); !!s&&s.meetings===2&&s.project_id===null&&s.kind==='work'&&s.name.startsWith('Smoke$RL weekly sync')" | grep -q true || fail "v4: the series list does not show 2 meetings"
VP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke series project","kind":"work"}' | js d.project.id)
A1=$(curl "${H[@]}" -X POST $B/api/meetings/$V1/accept -d "{\"project_id\":\"$VP\",\"tasks\":[{\"text\":\"Send the plan\",\"owner\":\"Sam\"},{\"text\":\"Book the room\"}],\"decisions\":[{\"text\":\"Ship in Q4\"}]}")
echo "$A1" | js "d.tasks[0].source_ref==='meeting:$V1:0'&&d.tasks[1].source_ref==='meeting:$V1:1'" | grep -q true || fail "v4: accept did not set source_ref meeting:<id>:<index>"
VA=$(echo "$A1" | js d.tasks[0].id); VB=$(echo "$A1" | js d.tasks[1].id)
curl "${H[@]}" -X POST $B/api/meetings/$V2/accept -d "{\"project_id\":\"$VP\",\"tasks\":[{\"text\":\"Draft SOW\",\"owner\":\"Alex\"}],\"decisions\":[{\"text\":\"Hire a PM\"}]}" | grep -q '"state":"reviewed"' || fail "v4: accept 2"
VS2=$(mser $V1); [ -n "$VS2" ] && [ "$VS2" != "$VS" ] && [ "$VS2" = "$(curl "${H[@]}" $B/api/meetings/$V2 | js d.meeting.series_id)" ] || fail "v4: accepting into a project did not move both meetings to the project's series"
sget() { curl "${H[@]}" $B/api/meetings/series/$1; }
sget $VS2 | js "d.series.project_id==='$VP'&&d.meetings.length===2&&d.actions.length===3&&d.decisions.length===2&&d.questions.length===1&&!d.questions[0].answered&&d.actions.every(a=>a.status!=='done')" | grep -q true || fail "v4: series page counts (2 meetings, 3 actions, 2 decisions, 1 open question)"
sget $VS2 | js "d.series.athena===false" | grep -q true || fail "v4: V17 a series in an Offline-only project must not offer Athena"
sget $VS2 | js "d.actions.some(a=>a.title==='Draft SOW'&&a.owner==='Alex')&&d.actions.some(a=>a.title==='Send the plan'&&a.owner==='Sam')" | grep -q true || fail "v4: action titles and owners opened"
curl "${H[@]}" $B/api/meetings/series | js "!d.series.some(x=>x.id==='$VS')&&d.series.find(x=>x.id==='$VS2').open_actions===3" | grep -q true || fail "v4: the emptied unfiled series should leave the list, the project's show 3 open actions"
# finishing one task ticks it on the series page and drops the open count
curl "${H[@]}" -X POST $B/api/tasks/$VA/move -d '{"status":"done"}' | grep -q '"status":"done"' || fail "v4: finish a task"
sget $VS2 | js "d.actions.find(a=>a.id==='$VA').status==='done'&&d.actions[d.actions.length-1].id==='$VA'" | grep -q true || fail "v4: a finished task is not ticked (and last) on the series page"
curl "${H[@]}" $B/api/meetings/series | js "d.series.find(x=>x.id==='$VS2').open_actions===2" | grep -q true || fail "v4: open action count after finishing one"
# V7 fallback: a task from before this phase (no source_ref) still matches by project and the review's url
D1X "UPDATE tasks SET source_ref = NULL WHERE id = '$VB'" >/dev/null
sget $VS2 | js "d.actions.length===3&&d.actions.some(a=>a.id==='$VB')" | grep -q true || fail "v4: an old task (no source_ref) is not matched by url"
# V8: a question stays open until marked answered; the list is sealed
QH=$(sget $VS2 | js d.questions[0].hash)
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/meetings/series/$VS2 -d '{"answer":{"hash":"nothex","answered":true}}')" = 400 ] || fail "v4: a bad hash"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/meetings/series/$VS2 -d '{}')" = 400 ] || fail "v4: an empty patch"
curl "${H[@]}" -X PATCH $B/api/meetings/series/$VS2 -d "{\"answer\":{\"hash\":\"$QH\",\"answered\":true}}" | grep -q '"series"' || fail "v4: mark answered"
sget $VS2 | js "d.questions[0].answered===true" | grep -q true || fail "v4: the question is not answered"
[ "$(D1X "SELECT enc_v AS e, answered AS a FROM meeting_series WHERE id='$VS2'" | js "const r=d[0].results[0]; r.e+'/'+(r.a.startsWith('[')?'plain':'sealed')")" = "2/sealed" ] || fail "v4: the answered list of a work series is not sealed"
curl "${H[@]}" -X PATCH $B/api/meetings/series/$VS2 -d "{\"answer\":{\"hash\":\"$QH\",\"answered\":false}}" >/dev/null
sget $VS2 | js "d.questions[0].answered===false" | grep -q true || fail "v4: un-answering"
curl "${H[@]}" -X PATCH $B/api/meetings/series/$VS2 -d "{\"answer\":{\"hash\":\"$QH\",\"answered\":true}}" >/dev/null
# V13: the key is a hash and the name is ciphertext (no title words in a plain column)
D1X "SELECT key AS k, name AS n, enc_v AS e FROM meeting_series WHERE id='$VS2'" | js "const r=d[0].results[0]; /^[0-9a-f]{64}$/.test(r.k)&&r.e===2&&!/smoke/i.test(r.n)" | grep -q true || fail "v4: V13 key/name"
# D1 allows 100 bound parameters a statement: a series of 110 more meetings (and the 4 real ones) still opens (the local SQLite would not catch a bound list, so scripts/series.test.ts also bans one)
D1X "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 110) INSERT INTO meeting_reviews (id, recording_id, title, summary, decisions, action_items, open_questions, important_notes, project_id, state, received_at, reviewed_at, updated_at, series_id, enc_v) SELECT 'serbulk-'||i||'-$R', 'serbulk'||i||'$R', 'bulk', NULL, '[]', '[]', '[]', '[]', '$VP', 'reviewed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '$VS2', 0 FROM n" >/dev/null
sget $VS2 | js "d.meetings.length===112&&d.actions.length===3&&d.decisions.length===2" | grep -q true || fail "v4: a series with 110 more meetings did not open"
D1X "DELETE FROM meeting_reviews WHERE recording_id LIKE 'serbulk%$R'" >/dev/null
# a move by hand: a new series; another project's series is refused; a later accept keeps the series' key
post "$IDS" "$(mnotes "Smoke$RL other thing" 3)" >/dev/null; post "$IDS" "$(mnotes "Smoke$RL stray talk" 4)" >/dev/null
V3=$(mid 3); V4=$(mid 4)
MV=$(curl "${H[@]}" -X POST $B/api/meetings/$V3/series -d "{\"new_name\":\"Smoke$RL moved\"}"); VN=$(echo "$MV" | js d.series.id)
echo "$MV" | js "d.series.name==='Smoke$RL moved'&&d.meeting.series_id==='$VN'" | grep -q true || fail "v4: move to a new series"
sget $VN | js "d.meetings.length===1&&d.meetings[0].id==='$V3'" | grep -q true || fail "v4: the moved meeting is not in its new series"
sget $VN | js "d.series.athena===true" | grep -q true || fail "v4: V17 an unfiled series offers Athena"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/meetings/$V3/series -d "{\"series_id\":\"$VS2\"}")" = 400 ] || fail "v4: a meeting joined another project's series"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/meetings/$V3/series -d '{"new_name":""}')" = 400 ] && [ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/meetings/$V3/series -d '{"series_id":"nope"}')" = 404 ] || fail "v4: move validation"
curl "${H[@]}" -X POST $B/api/meetings/$V4/series -d "{\"series_id\":\"$VN\"}" | grep -q "\"id\":\"$VN\"" || fail "v4: move into an existing series"
curl "${H[@]}" -X POST $B/api/meetings/$V4/accept -d "{\"project_id\":\"$VP\",\"tasks\":[],\"decisions\":[{\"text\":\"Stay moved\"}]}" | grep -q '"state":"reviewed"' || fail "v4: accept the moved meeting"
VS4=$(mser $V4); [ "$VS4" != "$VN" ] && [ "$VS4" != "$VS2" ] && sget $VS4 | js "d.series.name==='Smoke$RL moved'&&d.series.project_id==='$VP'" | grep -q true || fail "v4: a meeting moved by hand did not keep its series when accepted into the project"
# the purge: a project in Trash takes its series (FK) and the reviews go back to an unfiled series on the next list
curl "${H[@]}" -X DELETE $B/api/projects/$VP >/dev/null
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/trash/empty)" = 200 ] || fail "v4: Empty Trash with a project that has series"
[ "$(D1X "SELECT count(*) AS n FROM meeting_series WHERE project_id='$VP'" | js d[0].results[0].n)" = 0 ] && [ "$(D1X "SELECT count(*) AS n FROM meeting_reviews WHERE id='$V1' AND project_id IS NULL AND series_id IS NULL" | js d[0].results[0].n)" = 1 ] || fail "v4: the purge left a series or a stale series_id"
curl "${H[@]}" $B/api/meetings/series | js "!!d.series.find(x=>x.project_id===null&&x.name.startsWith('Smoke$RL weekly sync'))" | grep -q true || fail "v4: reviews were not put back in an unfiled series"
[ "$(D1X "SELECT count(*) AS n FROM meeting_reviews WHERE id='$V1' AND series_id IS NOT NULL" | js d[0].results[0].n)" = 1 ] || fail "v4: backfill"
D1X "DELETE FROM meeting_reviews WHERE recording_id LIKE 'ser_$R'; DELETE FROM meeting_series WHERE created_at >= '$T0' AND id NOT IN (SELECT series_id FROM meeting_reviews WHERE series_id IS NOT NULL); DELETE FROM inbox_items WHERE ref LIKE 'sonarflow:recording:ser_$R'" >/dev/null
echo "smoke: (v4) series: two dated titles -> one unfiled series; accepted into a project -> the project's series (source_ref meeting:<id>:<n>, 3 actions, 2 decisions, 1 question); finishing a task ticks it and drops the open count; an old task matches by url; answering a question is sealed and reversible; key is a hash and name ciphertext; a move by hand (new series, existing series, other project 400) survives accept; Empty Trash with a project that has series succeeds and a later list puts the reviews back"
# (p0) v2.2 Task 0: baselines. Save one (counts, no titles in the snapshot), move two dates and read the slip (+n, -m) with the same shared/baseline.ts the device uses, a work baseline is ciphertext in D1
# (a personal one plain), rename keeps it sealed, the 20-baseline and 1,000-task caps, Trash lists and restores it, Empty Trash removes a project's baselines and stakeholders, export opens both tables.
bpost() { curl "${H[@]}" -w '\n%{http_code}' -X POST "$B/api/projects/$1/baselines" -d "$2"; }
slipjs() { SNAP="$1" CUR="$2" node --experimental-strip-types --no-warnings --input-type=module -e 'const { slip } = await import(process.cwd() + "/shared/baseline.ts"); const s = JSON.parse(process.env.SNAP), c = JSON.parse(process.env.CUR); const r = slip(s, c.tasks, c.milestones, c.project); console.log(r.rows.map(x => x.id + ":" + x.due_delta).join(",") + "|" + r.summary.late + "/" + r.summary.early + "/" + r.summary.max_late)'; }
BW=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke baseline work","kind":"work","start_at":"2026-03-01","end_at":"2026-06-30"}' | js d.project.id)
BPP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke baseline own","kind":"personal"}' | js d.project.id)
BT1=$(dt "$(node -pe 'JSON.stringify({title:"Smoke bl one '$R'",project_id:process.argv[1],due_at:"2026-03-10"})' "$BW")")
BT2=$(dt "$(node -pe 'JSON.stringify({title:"Smoke bl two '$R'",project_id:process.argv[1],start_at:"2026-03-15",due_at:"2026-03-20"})' "$BW")")
BT3=$(dt "$(node -pe 'JSON.stringify({title:"Smoke bl three '$R'",project_id:process.argv[1]})' "$BW")")
BM=$(curl "${H[@]}" -X POST $B/api/projects/$BW/milestones -d '{"name":"Smoke bl milestone","due_at":"2026-04-01"}' | js d.milestone.id)
BO=$(bpost $BW "{\"name\":\"Smoke baseline $R\"}"); [ "$(kst "$BO")" = 201 ] || fail "p0: save baseline: $BO"
BID=$(kbody "$BO" | js d.baseline.id)
[ "$(kbody "$BO" | js "d.baseline.task_count+'/'+d.baseline.milestone_count+'/'+d.baseline.name")" = "3/1/Smoke baseline $R" ] || fail "p0: counts or name: $BO"
BL=$(curl "${H[@]}" $B/api/projects/$BW/baselines)
echo "$BL" | js "d.baselines.length+'/'+d.baselines[0].name+'/'+('snapshot' in d.baselines[0])" | grep -qx "1/Smoke baseline $R/false" || fail "p0: list: $BL"
BG=$(curl "${H[@]}" $B/api/baselines/$BID)
echo "$BG" | js "d.baseline.snapshot.tasks.length+'/'+d.baseline.snapshot.milestones.length+'/'+d.baseline.snapshot.project.end_at" | grep -qx '3/1/2026-06-30' || fail "p0: opened snapshot: $BG"
echo "$BG" | grep -q "Smoke bl" && fail "p0: the snapshot carries a title"
BSNAP=$(echo "$BG" | js 'JSON.stringify(d.baseline.snapshot)')
# move two dates: one task +4 days, one -2 days (and the milestone +5); the slip, from the live rows, shows +4, -2 and the milestone
curl "${H[@]}" -X PATCH $B/api/tasks/$BT1 -d '{"due_at":"2026-03-14"}' >/dev/null; curl "${H[@]}" -X PATCH $B/api/tasks/$BT2 -d '{"start_at":"2026-03-13","due_at":"2026-03-18"}' >/dev/null
curl "${H[@]}" -X PATCH $B/api/milestones/$BM -d '{"due_at":"2026-04-06"}' >/dev/null
BCUR=$(curl "${H[@]}" "$B/api/tasks?status=all&project=$BW" | js "JSON.stringify({tasks:d.tasks,milestones:[{id:'$BM',due_at:'2026-04-06'}],project:{start_at:'2026-03-01',end_at:'2026-06-30'}})")
[ "$(slipjs "$BSNAP" "$BCUR")" = "$BM:5,$BT1:4,$BT2:-2|2/1/5" ] || fail "p0: slip: $(slipjs "$BSNAP" "$BCUR")"
# a work baseline is ciphertext at rest; a personal one is plain JSON
RAWB=$(D1X "SELECT name AS n, snapshot AS s, enc_v AS e FROM baselines WHERE id='$BID'" | js 'd[0].results[0].n+"|"+d[0].results[0].s+"|"+d[0].results[0].e')
case "$RAWB" in *"Smoke baseline"*|*'"due_at"'*|*'"tasks"'*) fail "p0: a work baseline is not sealed in D1: $RAWB";; esac
[ "${RAWB##*|}" = 2 ] || fail "p0: a work baseline's enc_v is not 2: $RAWB"
BPO=$(bpost $BPP "{\"name\":\"Smoke baseline own $R\"}"); [ "$(kst "$BPO")" = 201 ] || fail "p0: personal baseline"
BPID=$(kbody "$BPO" | js d.baseline.id)
RAWP=$(D1X "SELECT name AS n, snapshot AS s, enc_v AS e FROM baselines WHERE id='$BPID'" | js 'd[0].results[0].n+"|"+d[0].results[0].s+"|"+d[0].results[0].e')
case "$RAWP" in "Smoke baseline own $R|{\"tasks\":[]"*"|0") ;; *) fail "p0: a personal baseline is not plain: $RAWP";; esac
# rename (still sealed, still opens), bad requests
RN=$(curl "${H[@]}" -w '\n%{http_code}' -X PATCH $B/api/baselines/$BID -d "{\"name\":\"Smoke renamed $R\"}"); [ "$(kst "$RN")" = 200 ] || fail "p0: rename: $RN"
D1X "SELECT name AS n FROM baselines WHERE id='$BID'" | js 'd[0].results[0].n' | grep -q "Smoke renamed" && fail "p0: a renamed work baseline is plain"
curl "${H[@]}" $B/api/baselines/$BID | js "d.baseline.name+'/'+d.baseline.snapshot.tasks.length" | grep -qx "Smoke renamed $R/3" || fail "p0: rename lost the snapshot"
[ "$(kst "$(bpost $BW '{"name":"  "}')")" = 400 ] && [ "$(kst "$(bpost $BW "{\"name\":\"$(printf 'x%.0s' $(seq 201))\"}")")" = 400 ] || fail "p0: a blank or 201-character name is not 400"
[ "$(kst "$(bpost nope '{"name":"x"}')")" = 404 ] && [ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' $B/api/baselines/nope)" = 404 ] && [ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/baselines/nope -d '{"name":"x"}')" = 404 ] || fail "p0: unknown project or baseline is not 404"
# the caps: 20 live baselines a project (the 21st is 409), 1,000 tasks (1,001 is 409 baseline_too_big)
for i in $(seq 2 20); do [ "$(kst "$(bpost $BPP "{\"name\":\"Smoke cap $i\"}")")" = 201 ] || fail "p0: baseline $i was refused"; done
CAP=$(bpost $BPP '{"name":"one too many"}'); [ "$(kst "$CAP")" = 409 ] && kbody "$CAP" | grep -q baseline_limit || fail "p0: the 21st baseline: $CAP"
curl "${H[@]}" $B/api/projects/$BPP/baselines | js d.baselines.length | grep -qx 20 || fail "p0: list of 20"
BBIG=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke baseline big","kind":"personal"}' | js d.project.id)
D1X "INSERT INTO tasks (id, project_id, title, kind, created_at, updated_at) WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i<1000) SELECT 'smkbl-$R-'||i, '$BBIG', 'bulk', 'personal', '$TS', '$TS' FROM c" >/dev/null
BIGO=$(bpost $BBIG '{"name":"exactly 1000"}'); [ "$(kst "$BIGO")" = 201 ] && [ "$(kbody "$BIGO" | js d.baseline.task_count)" = 1000 ] || fail "p0: 1,000 tasks: $BIGO"
D1X "INSERT INTO tasks (id, project_id, title, kind, created_at, updated_at) VALUES ('smkbl-$R-x', '$BBIG', 'bulk', 'personal', '$TS', '$TS')" >/dev/null
BIGO=$(bpost $BBIG '{"name":"1001"}'); [ "$(kst "$BIGO")" = 409 ] && kbody "$BIGO" | grep -q baseline_too_big || fail "p0: 1,001 tasks: $BIGO"
D1X "DELETE FROM baselines WHERE project_id='$BBIG'; DELETE FROM tasks WHERE project_id='$BBIG'; DELETE FROM projects WHERE id='$BBIG'" >/dev/null
# Trash lists a deleted baseline by name (opened, no snapshot) and project, and restore brings it back
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X DELETE $B/api/baselines/$BID)" = 200 ] || fail "p0: delete"
curl "${H[@]}" $B/api/projects/$BW/baselines | js d.baselines.length | grep -qx 0 || fail "p0: a deleted baseline is still listed"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' $B/api/baselines/$BID)" = 404 ] || fail "p0: a deleted baseline still opens"
curl "${H[@]}" $B/api/trash | js "const b=d.baselines.find(x=>x.id==='$BID'); !!b&&b.name==='Smoke renamed $R'&&b.project_name==='Smoke baseline work'&&!('snapshot' in b)" | grep -qx true || fail "p0: Trash does not list the baseline by name and project"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/trash/baselines/$BID/restore)" = 200 ] || fail "p0: restore"
curl "${H[@]}" $B/api/projects/$BW/baselines | js "d.baselines.map(b=>b.name).join()" | grep -qx "Smoke renamed $R" || fail "p0: a restored baseline is not listed"
# the audit rows hold no content
D1X "SELECT group_concat(action||':'||ifnull(detail,''),'|') AS a FROM audit_log WHERE target IN ('$BID')" | js 'd[0].results[0].a' | grep -q "Smoke" && fail "p0: an audit row carries the name"
# export opens both tables (a stakeholder row is put in by SQL: its routes come in Task 2)
BS=$(date +%s)$RANDOM; D1X "INSERT INTO stakeholders (id, project_id, name, created_at, updated_at, enc_v) VALUES ('smkst-$BS', '$BW', 'Smoke stakeholder', '$TS', '$TS', 0)" >/dev/null
curl "${H[@]}" $B/api/export | js "d.baselines.some(b=>b.id==='$BID'&&b.name==='Smoke renamed $R'&&JSON.parse(b.snapshot).tasks.length===3)&&d.stakeholders.some(x=>x.id==='smkst-$BS'&&x.name==='Smoke stakeholder')" | grep -qx true || fail "p0: export did not open baselines and stakeholders"
# Empty Trash after the project goes to Trash: baselines (live and deleted) and stakeholders go before the project (FK)
curl "${H[@]}" -X DELETE $B/api/baselines/$BPID >/dev/null
for x in $BT1 $BT2 $BT3; do curl "${H[@]}" -X DELETE $B/api/tasks/$x >/dev/null; done
curl "${H[@]}" -X DELETE $B/api/projects/$BW >/dev/null; curl "${H[@]}" -X DELETE $B/api/projects/$BPP >/dev/null
BE=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/trash/empty); [ "$(kst "$BE")" = 200 ] || fail "p0: Empty Trash with baselines and stakeholders: $BE"
[ "$(D1X "SELECT (SELECT count(*) FROM baselines WHERE project_id IN ('$BW','$BPP'))+(SELECT count(*) FROM stakeholders WHERE project_id='$BW')+(SELECT count(*) FROM projects WHERE id IN ('$BW','$BPP')) AS n" | js 'd[0].results[0].n')" = 0 ] || fail "p0: baselines, stakeholders or the project survived Empty Trash"
echo "smoke: (p0) baselines: saved (3 tasks, 1 milestone, no titles in the snapshot); two moved dates read +4 and -2 (milestone +5; 2 late, 1 early, max 5); work baseline and its rename are ciphertext in D1, a personal one plain; blank/long name 400, unknown 404; 21st baseline 409, 1,000 tasks fine and 1,001 409; Trash lists and restores it; export opens baselines and stakeholders; Empty Trash removes a project's baselines and stakeholders"
# (p1) v2.2 Task 1: the report carries the dashboard's numbers. A work project with a baseline, a subtask and two risks (one unrated): the route returns the opened baseline and the subtask, the same shared code
# builds "Key numbers" and the schedule (task +4, milestone +5), the summary text holds numbers only (no baseline name), the cloud project gets the stub summary, an Offline-only one gets ai_refused and no model call.
modeljs() { INPUT="$1" node --experimental-strip-types --no-warnings --input-type=module -e 'const { buildReportModel, reportText } = await import(process.cwd() + "/shared/report-model.ts"); const m = buildReportModel(JSON.parse(process.env.INPUT), { from: "2026-03-01", to: "2026-03-31" }, "2026-03-20", "now", "America/Toronto"); const t = reportText(m); console.log([m.schedule.summary.late, m.schedule.late_milestones.rows.map((r) => r.days_late).join(), m.metrics.high_risks, m.metrics.unrated_risks, m.metrics.open, /Key numbers as of 2026-03-20: done this week 0, open 2/.test(t), t.includes(process.env.NAME)].join("|"))'; }
DW=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke dash work","kind":"work","start_at":"2026-03-01","end_at":"2026-06-30"}' | js d.project.id)
curl "${H[@]}" -X PATCH $B/api/projects/$DW -d '{"data_boundary":"cloud"}' >/dev/null # a new work project starts Offline only
DT1=$(dt "$(node -pe 'JSON.stringify({title:"Smoke dash one '$R'",project_id:process.argv[1],due_at:"2026-03-10"})' "$DW")")
DT2=$(dt "$(node -pe 'JSON.stringify({title:"Smoke dash sub '$R'",project_id:process.argv[1],parent_id:process.argv[2],due_at:"2026-03-12"})' "$DW" "$DT1")")
DT3=$(dt "$(node -pe 'JSON.stringify({title:"Smoke dash two '$R'",project_id:process.argv[1],due_at:"2026-03-25"})' "$DW")")
DM=$(curl "${H[@]}" -X POST $B/api/projects/$DW/milestones -d '{"name":"Smoke dash milestone","due_at":"2026-04-01"}' | js d.milestone.id)
curl "${H[@]}" -X POST $B/api/projects/$DW/raid -d '{"type":"risk","text":"Smoke dash risk","probability":4,"impact":4}' >/dev/null
curl "${H[@]}" -X POST $B/api/projects/$DW/raid -d '{"type":"risk","text":"Smoke dash unrated"}' >/dev/null
DBO=$(bpost $DW "{\"name\":\"Smoke dash baseline $R\"}"); [ "$(kst "$DBO")" = 201 ] || fail "p1: baseline: $DBO"
curl "${H[@]}" -X PATCH $B/api/tasks/$DT1 -d '{"due_at":"2026-03-14"}' >/dev/null; curl "${H[@]}" -X PATCH $B/api/milestones/$DM -d '{"due_at":"2026-04-06"}' >/dev/null
DSR='{"project_id":"'$DW'","from":"2026-03-01","to":"2026-03-31","ai":true}'
DR=$(curl "${H[@]}" -X POST $B/api/reports/status -d "$DSR")
echo "$DR" | js "d.input.baseline.name==='Smoke dash baseline $R'&&d.input.baseline.snapshot.tasks.length===3&&d.input.baseline.snapshot.milestones.length===1&&d.input.tasks.length===3&&d.input.tasks.some(t=>t.parent_id)&&/^Stub answer/.test(d.ai_summary)&&d.ai_refused===null" | grep -qx true || fail "p1: report input (baseline opened, subtask, stub summary): $(echo "$DR" | cut -c1-300)"
[ "$(NAME="Smoke dash baseline $R" modeljs "$(echo "$DR" | js 'JSON.stringify(d.input)')")" = "2|5|1|1|2|true|false" ] || fail "p1: model from the route's data: $(NAME="Smoke dash baseline $R" modeljs "$(echo "$DR" | js 'JSON.stringify(d.input)')")"
# a project with no baseline: the schedule says so and the summary still works; an Offline-only one is refused with no model call
DN=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke dash none","kind":"personal"}' | js d.project.id)
curl "${H[@]}" -X POST $B/api/reports/status -d '{"project_id":"'$DN'","from":"2026-03-01","to":"2026-03-31"}' | js "d.input.baseline===null" | grep -qx true || fail "p1: a project without a baseline"
curl "${H[@]}" -X PATCH $B/api/projects/$DW -d '{"data_boundary":"offline"}' >/dev/null
DN1=$(D1X "SELECT count(*) AS n FROM ai_usage" | js 'd[0].results[0].n')
curl "${H[@]}" -X POST $B/api/reports/status -d "$DSR" | js "d.ai_summary===null&&d.ai_refused==='offline_boundary'&&d.input.baseline.snapshot.tasks.length===3" | grep -qx true || fail "p1: offline project not refused"
[ "$(D1X "SELECT count(*) AS n FROM ai_usage" | js 'd[0].results[0].n')" = "$DN1" ] || fail "p1: an offline report made a model call"
D1X "DELETE FROM baselines WHERE project_id='$DW'; DELETE FROM raid_items WHERE project_id='$DW'; DELETE FROM task_events WHERE task_id IN ('$DT1','$DT2','$DT3'); UPDATE tasks SET parent_id=NULL WHERE project_id='$DW'; DELETE FROM tasks WHERE project_id='$DW'; DELETE FROM milestones WHERE project_id='$DW'; DELETE FROM audit_log WHERE target IN ('$DW','$DN'); DELETE FROM projects WHERE id IN ('$DW','$DN')" >/dev/null
echo "smoke: (p1) report: the route returns the opened latest baseline and the subtasks; the shared model gives 2 late (task +4, milestone +5), 1 high and 1 unrated risk, 2 open, and the summary text holds numbers only (no baseline name); no baseline -> null; Offline-only -> ai_refused offline_boundary with no model call"
# (s2) v2.2 Task 2: stakeholders. Add, edit, mark sent (the next due moves, by the shared nextDue); a work stakeholder is ciphertext in D1 (a personal one plain); bad bodies are 400; the list's `athena` flag is false for an
# Offline-only project; Trash lists and restores; export opens it; the cron sends ONE "2 stakeholder updates due" (count only, no names, a closed project's stakeholder is not counted), not twice the same day, not before digest_hour,
# not with the switch off or in quiet hours. Local D1 only.
spost() { curl "${H[@]}" -w '\n%{http_code}' -X POST "$B/api/projects/$1/stakeholders" -d "$2"; }
nextjs() { node --experimental-strip-types --no-warnings --input-type=module -e 'const { nextDue } = await import(process.cwd() + "/shared/stakeholders.ts"); console.log(nextDue(process.argv[1] || null, +process.argv[2], process.argv[3], process.argv[4] || undefined))' "$1" "$2" "$3" "${4:-}"; }
S2PARK=$(date -u +%Y-%m-%dT%H:%M:%S.001Z); D1X "UPDATE stakeholders SET deleted_at = '$S2PARK' WHERE deleted_at IS NULL" >/dev/null # park the dev data's stakeholders so the count below is the smoke's own; put back at the end (and by fail())
S2Q=$(curl "${H[@]}" $B/api/settings | js '[d.quiet_from,d.quiet_to,d.digest_hour,d.tz].join()'); Q0=$(echo "$S2Q" | cut -d, -f1,2); S2DH=$(echo "$S2Q" | cut -d, -f3); S2TZ=$(echo "$S2Q" | cut -d, -f4)
restore_quiet() { [ -z "${Q0:-}" ] || curl -s -b $J -c $J -H "Origin: $B" -H "Content-Type: application/json" -X PATCH $B/api/settings -d "{\"quiet_from\":\"${Q0%,*}\",\"quiet_to\":\"${Q0#*,}\",\"digest_hour\":$S2DH,\"push\":{\"stakeholder\":true}}" >/dev/null || true; Q0=; D1X "UPDATE stakeholders SET deleted_at = NULL WHERE deleted_at = '$S2PARK'; DELETE FROM push_subscriptions WHERE id = 'smk-s2dev'" >/dev/null; [ -z "${PUSH0:-}" ] || curl -s -b $J -c $J -H "Origin: $B" -H "Content-Type: application/json" -X PATCH $B/api/settings -d "{\"push\":$PUSH0}" >/dev/null || true; PUSH0=; } # also restores the digest hour; fail() calls it
curl "${H[@]}" -X PATCH $B/api/settings -d '{"quiet_from":"00:00","quiet_to":"00:00"}' >/dev/null
SW=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke stake work","kind":"work"}' | js d.project.id)
SP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke stake own","kind":"personal"}' | js d.project.id)
SC=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke stake closed","kind":"personal"}' | js d.project.id)
SA=$(spost $SW '{"name":"Smoke Ada","role":"Smoke sponsor","power":"high","interest":"high","attitude":"resistant","channel":"Email","cadence_days":7,"notes":"smoke secret notes"}'); [ "$(kst "$SA")" = 201 ] || fail "s2: add: $SA"
SAID=$(kbody "$SA" | js d.item.id)
# a work stakeholder is ciphertext in D1; a personal one is plain
RAWS=$(D1X "SELECT name||'|'||ifnull(role,'')||'|'||ifnull(channel,'')||'|'||ifnull(notes,'')||'|'||enc_v||'|'||power||'|'||cadence_days AS r FROM stakeholders WHERE id='$SAID'" | js 'd[0].results[0].r')
case "$RAWS" in *Smoke*|*Email*|*secret*) fail "s2: a work stakeholder is not sealed in D1: $RAWS";; esac
case "$RAWS" in *"|2|high|7") ;; *) fail "s2: enc_v or the plain columns: $RAWS";; esac
SB=$(spost $SP '{"name":"Smoke Bo","attitude":"supportive","cadence_days":3}'); [ "$(kst "$SB")" = 201 ] || fail "s2: add personal: $SB"; SBID=$(kbody "$SB" | js d.item.id)
[ "$(D1X "SELECT name||'|'||enc_v AS r FROM stakeholders WHERE id='$SBID'" | js 'd[0].results[0].r')" = "Smoke Bo|0" ] || fail "s2: a personal stakeholder is not plain"
SCY=$(spost $SW '{"name":"Smoke Cy","power":"low","interest":"high","cadence_days":7}'); SCYID=$(kbody "$SCY" | js d.item.id)
SD=$(spost $SC '{"name":"Smoke Di","cadence_days":7}'); SDID=$(kbody "$SD" | js d.item.id)
curl "${H[@]}" -X PATCH $B/api/projects/$SC -d '{"status":"closed"}' >/dev/null
# the list opens it, in order, and says whether Athena may help: Offline-only (a new work project) false, Cloud true, back to Offline false
SL=$(curl "${H[@]}" $B/api/projects/$SW/stakeholders)
echo "$SL" | js "d.items.map(i=>i.name).join()==='Smoke Ada,Smoke Cy'&&d.items[0].notes==='smoke secret notes'&&d.items[0].role==='Smoke sponsor'&&d.athena===false" | grep -qx true || fail "s2: list or athena=false for an Offline-only project: $SL"
curl "${H[@]}" -X PATCH $B/api/projects/$SW -d '{"data_boundary":"cloud"}' >/dev/null
curl "${H[@]}" $B/api/projects/$SW/stakeholders | js d.athena | grep -qx true || fail "s2: athena should be true for a live Cloud project"
curl "${H[@]}" -X PATCH $B/api/projects/$SW -d '{"data_boundary":"offline"}' >/dev/null
curl "${H[@]}" $B/api/projects/$SW/stakeholders | js d.athena | grep -qx false || fail "s2: athena should be false again"
curl "${H[@]}" $B/api/projects/$SP/stakeholders | js d.athena | grep -qx true || fail "s2: a personal project is Cloud"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' $B/api/projects/nope/stakeholders)" = 404 ] || fail "s2: unknown project is 404"
# edit: the patch keeps the row sealed and changes only what was sent; bad bodies are 400
SE=$(curl "${H[@]}" -w '\n%{http_code}' -X PATCH $B/api/stakeholders/$SAID -d '{"attitude":"neutral","cadence_days":14,"role":"Smoke sponsor 2"}'); [ "$(kst "$SE")" = 200 ] || fail "s2: edit: $SE"
curl "${H[@]}" $B/api/projects/$SW/stakeholders | js "const a=d.items[0]; a.attitude==='neutral'&&a.cadence_days===14&&a.role==='Smoke sponsor 2'&&a.notes==='smoke secret notes'&&a.name==='Smoke Ada'" | grep -qx true || fail "s2: edit lost a field"
D1X "SELECT name||ifnull(role,'')||ifnull(notes,'') AS r FROM stakeholders WHERE id='$SAID'" | js 'd[0].results[0].r' | grep -q "Smoke\|secret" && fail "s2: an edited work stakeholder is plain"
for bad in '{"name":"  "}' "{\"name\":\"$(printf 'x%.0s' $(seq 121))\"}" '{"name":"a","role":"'$(printf 'x%.0s' $(seq 121))'"}' '{"name":"a","channel":"'$(printf 'x%.0s' $(seq 61))'"}' '{"name":"a","notes":"'$(printf 'x%.0s' $(seq 2001))'"}' '{"name":"a","power":"medium"}' '{"name":"a","attitude":"angry"}' '{"name":"a","cadence_days":0}' '{"name":"a","cadence_days":366}' '{"name":"a","cadence_days":1.5}' '{}'; do
  [ "$(kst "$(spost $SW "$bad")")" = 400 ] || fail "s2: not 400: ${bad:0:60}"; done
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/stakeholders/$SAID -d '{"name":""}')" = 400 ] && [ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X PATCH $B/api/stakeholders/nope -d '{"role":"x"}')" = 404 ] || fail "s2: a patch blanking the name is 400, an unknown id 404"
# mark sent: last_contact_at is now, and the next due is that day plus the cadence (14), by the same shared code the device uses
SM=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/stakeholders/$SAID/contacted); [ "$(kst "$SM")" = 200 ] || fail "s2: contacted: $SM"
LAST=$(kbody "$SM" | js d.last_contact_at); [ "$(curl "${H[@]}" $B/api/projects/$SW/stakeholders | js "d.items[0].last_contact_at")" = "$LAST" ] || fail "s2: last_contact_at not stored"
STODAY=$(TZ=$S2TZ date +%Y-%m-%d); [ "$(nextjs "$LAST" 14 "$STODAY" "$S2TZ")" = "$(TZ=$S2TZ date -v+14d +%Y-%m-%d)" ] || fail "s2: next due did not move to last + 14 days: $(nextjs "$LAST" 14 "$STODAY" "$S2TZ")"
[ "$(nextjs "" 7 "$STODAY")" = "$STODAY" ] || fail "s2: never contacted is due today"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/stakeholders/nope/contacted)" = 404 ] || fail "s2: contacted on an unknown id is 404"
# the cron: due now = Cy (work, never contacted, 7 days) and Bo (personal, never contacted, 3 days); Ada was just sent, Di's project is closed
HRNOW=$(TZ=$S2TZ date +%-H); SOUT() { curl "${H[@]}" "$B/api/push/outbox?since=$SINCE" | js "JSON.stringify(d.items.filter(i=>/stakeholder update/.test(i.title)))"; }
sclear() { D1X "DELETE FROM push_outbox WHERE id LIKE 'stakeholder:%'; DELETE FROM push_log WHERE key LIKE 'stakeholder:%'" >/dev/null; }
SINCE=$(node -pe 'new Date(Date.now()-1000).toISOString()'); sclear
if [ "$HRNOW" -lt 23 ]; then curl "${H[@]}" -X PATCH $B/api/settings -d "{\"digest_hour\":$((HRNOW + 1))}" >/dev/null; cron; sleep 1
  [ "$(SOUT | js d.length)" = 0 ] || fail "s2: pushed before digest_hour"; fi
curl "${H[@]}" -X PATCH $B/api/settings -d "{\"digest_hour\":$HRNOW}" >/dev/null
cron; sleep 1; SO=$(SOUT)
echo "$SO" | js "d.length===1&&d[0].title==='2 stakeholder updates due'&&d[0].url==='/projects/$SW/stakeholders'" | grep -qx true || fail "s2: expected one '2 stakeholder updates due' linking the first project: $SO"
echo "$SO" | grep -q "Smoke\|Ada\|Cy\|Bo\b" && fail "s2: the push names someone: $SO"
cron; sleep 1; [ "$(SOUT | js d.length)" = 1 ] || fail "s2: the cron pushed twice in one day"
# The once-a-day guard is the outbox row, not a device (v2.2 C7 fix): with an unreachable device (push_log stays empty) a second tick must not deliver again, so its failed_count stays at 1.
# The other push types are switched off for this block (their own ticks would also fail on the fake device), and put back after.
PUSH0=$(curl "${H[@]}" $B/api/settings | js 'JSON.stringify(d.push)'); curl "${H[@]}" -X PATCH $B/api/settings -d "$(node -pe 'JSON.stringify({push:Object.fromEntries(Object.keys(JSON.parse(process.argv[1])).map(k=>[k,k==="stakeholder"]))})' "$PUSH0")" >/dev/null
sclear; D1X "DELETE FROM push_subscriptions WHERE id = 'smk-s2dev'" >/dev/null
SUBK=$(node -e 'const c=require("crypto"),j=c.generateKeyPairSync("ec",{namedCurve:"P-256"}).publicKey.export({format:"jwk"});const b=(x)=>Buffer.from(x,"base64url");console.log(Buffer.concat([Buffer.from([4]),b(j.x),b(j.y)]).toString("base64url")+" "+c.randomBytes(16).toString("base64url"))')
D1X "INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, created_at, kind) VALUES ('smk-s2dev', 'http://127.0.0.1:9/smk-s2', '${SUBK% *}', '${SUBK#* }', '$TS', 'web')" >/dev/null
fcount() { D1X "SELECT failed_count AS n FROM push_subscriptions WHERE id='smk-s2dev'" | js 'd[0].results[0].n'; }
cron; sleep 2
[ "$(fcount)" = 1 ] || fail "s2: the unreachable fake device was not tried (failed_count $(fcount))"
[ "$(D1X "SELECT count(*) AS n FROM push_log WHERE key LIKE 'stakeholder:%'" | js 'd[0].results[0].n')" = 0 ] || fail "s2: push_log was written without a delivery"
cron; sleep 2; [ "$(fcount)" = 1 ] && [ "$(SOUT | js d.length)" = 1 ] || fail "s2: a second tick delivered again to an unreachable device (failed_count $(fcount)): the outbox key is not the guard"
D1X "DELETE FROM push_subscriptions WHERE id = 'smk-s2dev'" >/dev/null; curl "${H[@]}" -X PATCH $B/api/settings -d "{\"push\":$PUSH0}" >/dev/null; PUSH0=
# the switch and quiet hours silence it (the next day's key is simulated by clearing the log)
sclear; curl "${H[@]}" -X PATCH $B/api/settings -d '{"push":{"stakeholder":false}}' >/dev/null; cron; sleep 1
[ "$(SOUT | js d.length)" = 0 ] || fail "s2: settings.push.stakeholder=false still pushed"
curl "${H[@]}" -X PATCH $B/api/settings -d '{"push":{"stakeholder":true},"quiet_from":"00:00","quiet_to":"23:59"}' >/dev/null; cron; sleep 1
[ "$(SOUT | js d.length)" = 0 ] || fail "s2: pushed in quiet hours"
curl "${H[@]}" -X PATCH $B/api/settings -d '{"quiet_from":"00:00","quiet_to":"00:00"}' >/dev/null; cron; sleep 1
[ "$(SOUT | js d.length)" = 1 ] || fail "s2: switched on and not quiet, nothing was pushed"
# Trash lists a deleted stakeholder by name and project, Restore brings it back; the audit rows hold no names; export opens it
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X DELETE $B/api/stakeholders/$SCYID)" = 200 ] || fail "s2: trash"
curl "${H[@]}" $B/api/projects/$SW/stakeholders | js "d.items.map(i=>i.name).join()" | grep -qx "Smoke Ada" || fail "s2: a trashed stakeholder is still listed"
curl "${H[@]}" $B/api/trash | js "const x=d.stakeholders.find(s=>s.id==='$SCYID'); !!x&&x.name==='Smoke Cy'&&x.project_name==='Smoke stake work'&&!('notes' in x)" | grep -qx true || fail "s2: Trash does not list the stakeholder"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/trash/stakeholders/$SCYID/restore)" = 200 ] || fail "s2: restore"
curl "${H[@]}" $B/api/projects/$SW/stakeholders | js "d.items.length" | grep -qx 2 || fail "s2: a restored stakeholder is not listed"
# the 500 cap holds on restore as on create: with 500 live (2 here + 498 by SQL) a 501st is 409, and so is restoring one from Trash
D1X "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 498) INSERT INTO stakeholders (id, project_id, name, created_at, updated_at, enc_v) SELECT 'smkcap-'||i, '$SW', 'Cap '||i, '$TS', '$TS', 0 FROM n; INSERT INTO stakeholders (id, project_id, name, created_at, updated_at, deleted_at, enc_v) VALUES ('smkcap-trash', '$SW', 'Cap trash', '$TS', '$TS', '$TS', 0)" >/dev/null
[ "$(spost $SW '{"name":"Cap 501"}' | tail -1)" = 409 ] || fail "s2: create past 500 should be 409"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/trash/stakeholders/smkcap-trash/restore)" = 409 ] || fail "s2: restore past 500 should be 409"
D1X "DELETE FROM stakeholders WHERE id LIKE 'smkcap-%'" >/dev/null
D1X "SELECT group_concat(action||':'||ifnull(detail,''),'|') AS a FROM audit_log WHERE target IN ('$SAID','$SBID','$SCYID')" | js 'd[0].results[0].a' | grep -q "Smoke\|secret" && fail "s2: an audit row carries content"
curl "${H[@]}" $B/api/export | js "d.stakeholders.some(x=>x.id==='$SAID'&&x.name==='Smoke Ada'&&x.notes==='smoke secret notes')" | grep -qx true || fail "s2: export did not open the stakeholder"
# clean up (local D1 only) and put the settings back
D1X "DELETE FROM stakeholders WHERE project_id IN ('$SW','$SP','$SC'); DELETE FROM projects WHERE id IN ('$SW','$SP','$SC'); DELETE FROM push_outbox WHERE id LIKE 'stakeholder:%'; DELETE FROM push_log WHERE key LIKE 'stakeholder:%'" >/dev/null
restore_quiet
echo "smoke: (s2) stakeholders: added (work sealed in D1, personal plain), edited (still sealed), bad bodies 400, marked sent (next due = last + cadence by the shared nextDue), athena flag false for Offline-only and true for Cloud, the cron sent one '2 stakeholder updates due' with no names (closed project not counted), not twice, not before digest_hour, not with the switch off or in quiet hours; Trash lists and restores; export opens it; the once-a-day guard is the outbox row (an unreachable device is tried once, push_log stays empty); the 500 cap holds on create and on restore"
# (w) v2.3 Task 2: the widget tick token. Created with the dev step-up; one POST marks a task done (actor you, via widget); a bad or revoked token is a plain 401 with no
# audit row; a done or trashed task is 404; the 61st call in a minute is 429; the audit rows hold ids and no text; the guard lets through exactly that method and path.
wtok() { curl "${H[@]}" -X POST $B/api/widget/token -d "{\"device_name\":\"$1\"}"; }
wdone() { curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/widget/tasks/$2/done" -H "Authorization: Bearer $1"; } # no cookie, no Origin: as the widget sends it
WTJ=$(wtok "Smoke iPhone"); WTID=$(echo "$WTJ" | js d.id); WTK=$(echo "$WTJ" | js d.token)
[ "$(echo "$WTK" | grep -cE '^[A-Za-z0-9_-]{43}$')" = 1 ] || fail "w: the token is not 256 random bits as base64url"
[ "$(D1X "SELECT count(*) AS n FROM widget_tokens WHERE id='$WTID' AND token_hash='$WTK'" | js 'd[0].results[0].n')" = 0 ] || fail "w: the token itself is stored"
[ "$(D1X "SELECT length(token_hash) AS n FROM widget_tokens WHERE id='$WTID'" | js 'd[0].results[0].n')" = 64 ] || fail "w: the stored hash is not SHA-256 hex"
curl "${H[@]}" $B/api/widget/tokens | js "d.tokens.some(t=>t.id==='$WTID'&&t.device_name==='Smoke iPhone')&&!JSON.stringify(d).includes('$WTK')&&d.tokens.every(t=>!('token_hash' in t)&&!('token' in t))" | grep -qx true || fail "w: the list is wrong or shows a secret"
nos() { case "$(curl -s -o /dev/null -w '%{http_code}' "$@")" in 401|403) return 0;; *) return 1;; esac; } # refused by the guard: no session (401), or no Origin (403)
nos -X POST $B/api/widget/token -d '{}' || fail "w: creating a token without a session was not refused"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: $B" -X POST $B/api/widget/token -d '{}')" = 401 ] || fail "w: creating a token without a session is not 401"
WP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke widget","kind":"work"}' | js d.project.id)
WT=$(curl "${H[@]}" -X POST $B/api/tasks -d '{"title":"Smoke widget secret title","due_at":"2026-01-01"}' | js d.task.id)
WW=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke widget work\",\"project_id\":\"$WP\",\"due_at\":\"2026-01-01\"}" | js d.task.id)
WR=$(curl "${H[@]}" -X POST $B/api/tasks -d '{"title":"Smoke widget recur","due_at":"2026-01-01","recur":"{\"freq\":\"daily\",\"interval\":1}"}' | js d.task.id)
WAUD() { D1X "SELECT count(*) AS n FROM audit_log WHERE actor='widget' AND at >= '$TS'" | js 'd[0].results[0].n'; }
D1X "DELETE FROM audit_log WHERE actor='widget'" >/dev/null
[ "$(WAUD)" = 0 ] || fail "w: audit rows before any widget call"
[ "$(wdone "$WTK" $WT)" = 200 ] || fail "w: done with a token is not 200"
[ "$(task $WT status)" = done ] || fail "w: the task is not done"
[ "$(D1X "SELECT actor||'|'||data AS a FROM task_events WHERE task_id='$WT' AND type='done'" | js 'd[0].results[0].a')" = 'you|{"via":"widget"}' ] || fail "w: the done event is not actor you with via widget"
[ "$(wdone "$WTK" $WW)" = 200 ] && [ "$(task $WW status)" = done ] || fail "w: done on a work task"
[ "$(D1X "SELECT actor||'|'||(enc_v>0) AS a FROM task_events WHERE task_id='$WW' AND type='done'" | js 'd[0].results[0].a')" = 'you|1' ] || fail "w: a work task's done event is not actor you and sealed"
[ "$(wdone "$WTK" $WT)" = 404 ] || fail "w: a task already done is not 404"
[ "$(wdone "$WTK" no-such-task)" = 404 ] || fail "w: a missing task is not 404"
[ "$(wdone "$WTK" $WR)" = 200 ] || fail "w: done on a recurring task"
curl "${H[@]}" "$B/api/tasks?status=all" | js "d.tasks.filter(t=>t.title==='Smoke widget recur'&&t.status!=='done').length===1" | grep -qx true || fail "w: the recurrence did not make the next task"
# two completes at once (a widget tick racing the app's queued tick): one recurrence, one done event, whichever wins
WC=$(curl "${H[@]}" -X POST $B/api/tasks -d '{"title":"Smoke widget race","due_at":"2026-01-01","recur":"{\"freq\":\"daily\",\"interval\":1}"}' | js d.task.id)
RP=(); for i in 1 2 3; do wdone "$WTK" $WC >/dev/null & RP+=($!); curl "${H[@]}" -o /dev/null -X POST $B/api/tasks/$WC/done & RP+=($!); done; wait "${RP[@]}" # not a bare wait: an earlier background job of this script may still run
curl "${H[@]}" "$B/api/tasks?status=all" | js "d.tasks.filter(t=>t.title==='Smoke widget race'&&t.status!=='done').length===1" | grep -qx true || fail "w: concurrent completes made two recurrences (or none)"
[ "$(D1X "SELECT count(*) AS n FROM task_events WHERE task_id='$WC' AND type='done'" | js 'd[0].results[0].n')" = 1 ] || fail "w: concurrent completes wrote two done events"
WTR=$(curl "${H[@]}" -X POST $B/api/tasks -d '{"title":"Smoke widget trashed"}' | js d.task.id); curl "${H[@]}" -X DELETE $B/api/tasks/$WTR >/dev/null
[ "$(wdone "$WTK" $WTR)" = 404 ] || fail "w: a trashed task is not 404"
[ "$(D1X "SELECT last_used_at IS NOT NULL AS u FROM widget_tokens WHERE id='$WTID'" | js 'd[0].results[0].u')" = 1 ] || fail "w: last_used_at not set"
# bad tokens: 401, no row, no count
W0=$(WAUD)
for bad in "" "Bearer" "Bearer short" "Bearer $(echo "$WTK" | tr 'A-Za-z' 'a-zA-Z')" "Bearer ${WTK}x" "Basic $WTK"; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/widget/tasks/$WT/done" ${bad:+-H "Authorization: $bad"})" = 401 ] || fail "w: bad token '$bad' is not 401"
done
[ "$(WAUD)" = "$W0" ] || fail "w: a bad token wrote an audit row"
# the guard: only POST on exactly this path; Kelly's agent secret and the cookie routes stay as they were
nos -X GET "$B/api/widget/tasks/$WT/done" -H "Authorization: Bearer $WTK" || fail "w: GET reached the widget route without a session"
nos -X POST "$B/api/widget/tasks/$WT/done/" -H "Authorization: Bearer $WTK" || fail "w: a trailing slash got past the guard"
nos -X POST "$B/api/widget/token" -H "Authorization: Bearer $WTK" || fail "w: a widget token created a token"
nos -X DELETE "$B/api/tasks/$WT" -H "Authorization: Bearer $WTK" || fail "w: a widget token reached another route"
nos -X POST "$B/api/tasks/$WT/done" -H "Authorization: Bearer $WTK" || fail "w: a widget token reached the cookie done route"
# the audit rows: actor widget, action widget.done, the task id and the token id, never text
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE actor='widget' AND action='widget.done' AND target='$WT' AND detail LIKE '%\"ok\":true%'" | js 'd[0].results[0].n')" = 1 ] || fail "w: the tick is not audited once"
[ "$(D1X "SELECT count(*) AS n FROM audit_log WHERE actor='widget' AND (detail LIKE '%Smoke widget%' OR target LIKE '%Smoke widget%')" | js 'd[0].results[0].n')" = 0 ] || fail "w: task text reached the audit log"
# 60 a minute: every answered call is audited, so the 61st is 429 (and is not audited: a flood can't grow the log)
for i in $(seq 1 70); do c=$(wdone "$WTK" no-such-$i); [ "$c" = 404 ] && continue; [ "$c" = 429 ] && break; fail "w: call $i got $c"; done
[ "$c" = 429 ] || fail "w: no 429 within 70 calls"
[ "$(WAUD)" = 60 ] || fail "w: the limit did not stop at 60 audited calls (or a 429 was audited)"
# revoke: 401 at once; a second token for the same device replaces the first; the list has no revoked one
WTJ2=$(wtok "Smoke iPhone"); WTK2=$(echo "$WTJ2" | js d.token); WTID2=$(echo "$WTJ2" | js d.id)
[ "$(wdone "$WTK" $WR)" = 401 ] || fail "w: the replaced token still works"
[ "$(D1X "SELECT count(*) AS n FROM widget_tokens WHERE device_name='Smoke iPhone' AND revoked_at IS NULL" | js 'd[0].results[0].n')" = 1 ] || fail "w: one token per device"
WT3=$(curl "${H[@]}" -X POST $B/api/tasks -d '{"title":"Smoke widget revoked"}' | js d.task.id)
curl "${H[@]}" -X DELETE $B/api/widget/token/$WTID2 | grep -q '"ok":true' || fail "w: revoke"
[ "$(wdone "$WTK2" $WT3)" = 401 ] || fail "w: a revoked token is not 401"
[ "$(task $WT3 status)" != done ] || fail "w: a revoked token completed a task"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X DELETE $B/api/widget/token/$WTID2)" = 404 ] || fail "w: revoking twice is not 404"
curl "${H[@]}" $B/api/widget/tokens | js "!d.tokens.some(t=>t.id==='$WTID'||t.id==='$WTID2')" | grep -qx true || fail "w: the list shows a revoked token"
curl "${H[@]}" $B/api/export | grep -q "$WTK2" && fail "w: the export holds a token"
D1X "DELETE FROM widget_tokens WHERE created_at >= '$T0'; DELETE FROM audit_log WHERE actor='widget' OR action LIKE 'widget.token.%'" >/dev/null
echo "smoke: (w) widget tick: token 256-bit base64url and stored as SHA-256 only, listed without secrets, done with it (actor you, via widget, sealed for work, recurrence runs, last_used_at set), a done, missing or trashed task 404, bad tokens 401 with no audit row, the guard lets only that method and path through, audit rows hold ids and no text, 60 a minute then 429 (not audited), a new token for the same device and a revoke both end the old one at once"
# (g0) v2.4 Task 0: programs. A work program is ciphertext in D1 (a personal one plain); kind is fixed (400); a project joins only a live program of its kind (400 program_kind,
# program_missing); the 50-program cap holds on create and on restore; the detail of a 60-project program answers each member's latest baseline and the top 10 risks;
# Trash lists a program by name; export opens it; Empty Trash with the program 31 days in Trash unlinks its projects and removes the row. Everything it made is removed.
gpost() { curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/programs -d "$1"; }
gpatch() { curl "${H[@]}" -w '\n%{http_code}' -X PATCH "$B/api/$1" -d "$2"; }
GW=$(gpost "{\"kind\":\"work\",\"name\":\"Smoke program $R\",\"rag\":\"amber\",\"rag_reason\":\"Smoke reason\",\"notes\":\"Smoke notes\"}"); [ "$(kst "$GW")" = 201 ] || fail "g0: create a work program: $GW"
GWID=$(kbody "$GW" | js d.program.id)
GP=$(gpost "{\"kind\":\"personal\",\"name\":\"Smoke own program $R\"}"); [ "$(kst "$GP")" = 201 ] || fail "g0: create a personal program: $GP"
GPID=$(kbody "$GP" | js d.program.id)
RAWG=$(D1X "SELECT name||'|'||rag_reason||'|'||notes||'|'||rag||'|'||enc_v AS a FROM programs WHERE id='$GWID'" | js 'd[0].results[0].a')
case "$RAWG" in *Smoke*) fail "g0: a work program is not sealed in D1: $RAWG";; esac
[ "${RAWG##*|}" = 2 ] && case "$RAWG" in *"|amber|2") ;; *) false;; esac || fail "g0: a work program's enc_v or rag: $RAWG"
[ "$(D1X "SELECT name||'|'||enc_v AS a FROM programs WHERE id='$GPID'" | js 'd[0].results[0].a')" = "Smoke own program $R|0" ] || fail "g0: a personal program is not plain"
curl "${H[@]}" $B/api/programs | js "d.programs.some(g=>g.id==='$GWID'&&g.name==='Smoke program $R'&&g.notes==='Smoke notes')" | grep -qx true || fail "g0: the list does not open the work program"
for b in '{"kind":"work","name":""}' '{"kind":"team","name":"x"}' '{"name":"x"}' '{"kind":"work","name":"x","rag":"blue"}' "{\"kind\":\"work\",\"name\":\"$(printf 'x%.0s' $(seq 121))\"}"; do
  [ "$(kst "$(gpost "$b")")" = 400 ] || fail "g0: a bad program body is not 400: $b"
done
GK=$(gpatch programs/$GWID '{"kind":"personal"}'); [ "$(kst "$GK")" = 400 ] && kbody "$GK" | grep -q program_kind_fixed || fail "g0: PATCH kind: $GK"
GB="{\"name\":\"Smoke program renamed $R\",\"rag\":\"red\"}"; GRN=$(gpatch programs/$GWID "$GB") # a body with a comma goes through a variable: inside "$( )" bash would brace-expand it
[ "$(kst "$GRN")" = 200 ] && kbody "$GRN" | js "d.program.name+'/'+d.program.rag" | grep -qx "Smoke program renamed $R/red" || fail "g0: rename: $GRN"
D1X "SELECT name||rag_reason AS a FROM programs WHERE id='$GWID'" | js 'd[0].results[0].a' | grep -q Smoke && fail "g0: a renamed work program is plain"
# a project joins only a live program of its own kind
GWP=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke program member","kind":"work"}' | js d.project.id)
GA=$(gpatch projects/$GWP "{\"program_id\":\"$GPID\"}"); [ "$(kst "$GA")" = 400 ] && kbody "$GA" | grep -q '"program_kind"' || fail "g0: work project into a personal program: $GA"
GA=$(gpatch projects/$GWP "{\"program_id\":\"no-such-program\"}"); [ "$(kst "$GA")" = 400 ] && kbody "$GA" | grep -q program_missing || fail "g0: a missing program: $GA"
GA=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/projects -d "{\"name\":\"Smoke wrong kind\",\"kind\":\"personal\",\"program_id\":\"$GWID\"}"); [ "$(kst "$GA")" = 400 ] && kbody "$GA" | grep -q '"program_kind"' || fail "g0: POST a personal project into a work program: $GA"
GA=$(gpatch projects/$GWP "{\"program_id\":\"$GWID\",\"budget_forecast\":1200.5,\"currency\":\"USD\"}"); [ "$(kst "$GA")" = 200 ] || fail "g0: join the work program: $GA"
[ "$(D1X "SELECT program_id||'|'||budget_forecast||'|'||currency AS a FROM projects WHERE id='$GWP'" | js 'd[0].results[0].a')" = "$GWID|1200.5|USD" ] || fail "g0: the project's program, forecast or currency was not stored"
[ "$(kst "$(gpatch projects/$GWP '{"currency":"usd"}')")" = 400 ] && [ "$(kst "$(gpatch projects/$GWP '{"budget_forecast":-1}')")" = 400 ] || fail "g0: a bad currency or forecast is not 400"
curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke default currency","kind":"personal"}' | js "d.project.currency+'|'+d.project.program_id" | grep -qx 'CAD|null' || fail "g0: a new project's currency is not CAD"
# the cap: fill to 50 live programs by SQL, the 51st is 409; trash one, take its place, and its restore is 409
GN=$(D1X "SELECT count(*) AS n FROM programs WHERE deleted_at IS NULL" | js 'd[0].results[0].n')
[ "$GN" -lt 50 ] || fail "g0: the local D1 already holds $GN programs"
D1X "INSERT INTO programs (id, kind, name, created_at, updated_at) WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i < $((50 - GN))) SELECT 'smkpg-$R-'||i, 'personal', 'bulk', '$TS', '$TS' FROM c" >/dev/null
[ "$(D1X "SELECT count(*) AS n FROM programs WHERE deleted_at IS NULL" | js 'd[0].results[0].n')" = 50 ] || fail "g0: seeding did not reach 50"
GC=$(gpost '{"kind":"personal","name":"one too many"}'); [ "$(kst "$GC")" = 409 ] && kbody "$GC" | grep -q program_limit || fail "g0: the 51st program: $GC"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X DELETE $B/api/programs/smkpg-$R-1)" = 200 ] || fail "g0: trash a program"
[ "$(kst "$(gpost '{"kind":"personal","name":"Smoke fiftieth"}')")" = 201 ] || fail "g0: the 50th program after a trash"
GR=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/trash/programs/smkpg-$R-1/restore); [ "$(kst "$GR")" = 409 ] && kbody "$GR" | grep -q program_limit || fail "g0: restore at the cap: $GR"
# detail: 60 work members, one baseline and one risk each (the first member also has an older baseline and two pending changes)
D1X "INSERT INTO projects (id, name, kind, data_boundary, program_id, created_at, updated_at) WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i < 60) SELECT 'smkgp-$R-'||i, 'bulk', 'work', 'offline', '$GWID', '$TS', '$TS' FROM c" >/dev/null
D1X "INSERT INTO baselines (id, project_id, name, snapshot, taken_at, created_at, updated_at) WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i < 60) SELECT 'smkgb-$R-'||i, 'smkgp-$R-'||i, 'bulk', '{\"tasks\":[],\"milestones\":[],\"project\":{\"start_at\":null,\"end_at\":\"2026-06-30\"}}', '2026-10-0'||(1+i%9)||'T00:00:00.000Z', '$TS', '$TS' FROM c" >/dev/null
D1X "INSERT INTO baselines (id, project_id, name, snapshot, taken_at, created_at, updated_at) VALUES ('smkgb-$R-old', 'smkgp-$R-1', 'old', '{\"tasks\":[],\"milestones\":[],\"project\":{\"start_at\":null,\"end_at\":\"2026-01-01\"}}', '2026-09-01T00:00:00.000Z', '$TS', '$TS')" >/dev/null
D1X "INSERT INTO raid_items (id, project_id, type, text, probability, impact, created_at, updated_at) WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i < 60) SELECT 'smkgr-$R-'||i, 'smkgp-$R-'||i, 'risk', 'bulk risk', 1+i%5, 1+(i/5)%5, '$TS', '$TS' FROM c" >/dev/null
D1X "INSERT INTO change_requests (id, project_id, title, created_at, updated_at) VALUES ('smkgc-$R-1', 'smkgp-$R-1', 'c', '$TS', '$TS'), ('smkgc-$R-2', 'smkgp-$R-1', 'c', '$TS', '$TS')" >/dev/null
GD=$(curl "${H[@]}" -D - $B/api/programs/$GWID/detail)
echo "$GD" | grep -qi 'cache-control: private, no-store' || fail "g0: the detail is cacheable"
echo "$GD" | tail -1 | js "const b=d.baselines.find(x=>x.project_id==='smkgp-$R-1'); [d.program.name, d.baselines.length, b.snapshot.project.end_at, d.risks.length, d.risks.every((r,i,a)=>!i||a[i-1].probability*a[i-1].impact>=r.probability*r.impact), d.risks[0].title, JSON.stringify(d.pending_changes)].join('/')" \
  | grep -Fqx "Smoke program renamed $R/60/2026-06-30/10/true/bulk risk/[{\"project_id\":\"smkgp-$R-1\",\"n\":2}]" || fail "g0: detail: $(echo "$GD" | tail -1 | head -c 400)"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' $B/api/programs/no-such/detail)" = 404 ] || fail "g0: a missing program's detail is not 404"
# export opens the work program; the audit rows hold no content
curl "${H[@]}" $B/api/export | js "d.programs.some(g=>g.id==='$GWID'&&g.name==='Smoke program renamed $R'&&g.notes==='Smoke notes'&&!('enc_v' in g))" | grep -qx true || fail "g0: export did not open the program"
D1X "SELECT group_concat(action||':'||ifnull(detail,''),'|') AS a FROM audit_log WHERE target IN ('$GWID','$GPID')" | js 'd[0].results[0].a' | grep -q Smoke && fail "g0: an audit row carries content"
# Trash lists it by name (opened, no notes); its detail is 404; Empty Trash with deleted_at 31 days back unlinks the members and removes the row
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X DELETE $B/api/programs/$GWID)" = 200 ] || fail "g0: trash the work program"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' $B/api/programs/$GWID/detail)" = 404 ] || fail "g0: a trashed program's detail is not 404"
curl "${H[@]}" $B/api/trash | js "const g=d.programs.find(x=>x.id==='$GWID'); !!g&&g.name==='Smoke program renamed $R'&&g.kind==='work'&&!('notes' in g)&&!('rag_reason' in g)" | grep -qx true || fail "g0: Trash does not list the program by name"
D1X "UPDATE programs SET deleted_at = '$(node -pe 'new Date(Date.now()-31*864e5).toISOString()')' WHERE id='$GWID'" >/dev/null
GE=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/trash/empty); [ "$(kst "$GE")" = 200 ] && [ "$(kbody "$GE" | js d.purged.programs)" -ge 1 ] || fail "g0: Empty Trash with a program: $GE"
[ "$(D1X "SELECT (SELECT count(*) FROM programs WHERE id='$GWID')+(SELECT count(*) FROM projects WHERE program_id='$GWID') AS n" | js 'd[0].results[0].n')" = 0 ] || fail "g0: the program or a member's link survived Empty Trash"
# clean up (local D1 only)
D1X "DELETE FROM change_requests WHERE id LIKE 'smkgc-$R-%'; DELETE FROM raid_items WHERE id LIKE 'smkgr-$R-%'; DELETE FROM baselines WHERE id LIKE 'smkgb-$R-%'; DELETE FROM projects WHERE id LIKE 'smkgp-$R-%' OR (created_at >= '$T0' AND name IN ('Smoke program member','Smoke default currency')); UPDATE projects SET program_id = NULL WHERE program_id IN (SELECT id FROM programs WHERE created_at >= '$T0' OR id LIKE 'smkpg-$R-%'); DELETE FROM programs WHERE created_at >= '$T0' OR id LIKE 'smkpg-$R-%'" >/dev/null
echo "smoke: (g0) programs: work program ciphertext in D1 (personal plain), bad bodies 400, kind fixed (400), a project joins only a live program of its kind (program_kind, program_missing; forecast and currency stored, CAD by default), 51st program 409 and restore at the cap 409, detail of 60 members: 60 latest baselines, top 10 risks, pending changes, no-store; export opens it; Trash lists it; Empty Trash unlinks its projects and removes it"
# (g1) v2.4 Task 1: the Estimate check (integer 0 to 57,600 minutes or null, else 400 bad_estimate) and the project's currency and forecast answers.
G1T=$(curl "${H[@]}" -X POST $B/api/tasks -d "{\"title\":\"Smoke estimate $R\",\"kind\":\"personal\"}" | js d.task.id)
[ "$(kst "$(gpatch tasks/$G1T '{"estimate_minutes":90}')")" = 200 ] || fail "g1: estimate 90 is not 200"
[ "$(kst "$(gpatch tasks/$G1T '{"estimate_minutes":null}')")" = 200 ] || fail "g1: estimate null is not 200"
for b in '{"estimate_minutes":-1}' '{"estimate_minutes":1.5}' '{"estimate_minutes":60000}' '{"estimate_minutes":"2h"}'; do
  G1=$(gpatch tasks/$G1T "$b"); [ "$(kst "$G1")" = 400 ] && kbody "$G1" | grep -q bad_estimate || fail "g1: $b: $G1"
done
G1=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/tasks -d '{"title":"x","estimate_minutes":-1}'); [ "$(kst "$G1")" = 400 ] && kbody "$G1" | grep -q bad_estimate || fail "g1: POST estimate -1: $G1"
G1P=$(curl "${H[@]}" -X POST $B/api/projects -d '{"name":"Smoke currency","kind":"personal"}' | js d.project.id)
[ "$(kst "$(gpatch projects/$G1P '{"currency":"usd"}')")" = 400 ] || fail "g1: currency usd is not 400"
[ "$(kst "$(gpatch projects/$G1P '{"currency":"USD"}')")" = 200 ] || fail "g1: currency USD is not 200"
[ "$(kst "$(gpatch projects/$G1P '{"budget_forecast":-1}')")" = 400 ] || fail "g1: forecast -1 is not 400"
curl "${H[@]}" -X DELETE $B/api/tasks/$G1T >/dev/null; curl "${H[@]}" -X DELETE $B/api/projects/$G1P >/dev/null
echo "smoke: (g1) estimates: 90 and null are 200; -1, 1.5, 60000 and \"2h\" are 400 bad_estimate on PATCH and POST; currency usd 400, USD 200; forecast -1 400"
# (g2) v2.4 Task 3: the program summary (P7). On the stub (it echoes the prompt): a summary, numbers and RAG words only (no program, project or milestone name),
# one ai_usage row with feature status_report; a member switched to Offline only refuses (offline_boundary) with no new ai_usage row; both ids or neither 400; a missing program 404.
G2=$(gpost "{\"kind\":\"work\",\"name\":\"Smoke report program $R\",\"rag\":\"green\"}"); [ "$(kst "$G2")" = 201 ] || fail "g2: create a program: $G2"
G2ID=$(kbody "$G2" | js d.program.id)
G2B="{\"name\":\"Smoke report member $R\",\"kind\":\"work\",\"rag\":\"amber\",\"program_id\":\"$G2ID\",\"budget_planned\":1000,\"budget_spent\":250}"
G2P=$(curl "${H[@]}" -X POST $B/api/projects -d "$G2B" | js d.project.id)
G2B="{\"title\":\"Smoke report task $R\",\"project_id\":\"$G2P\"}"; G2T=$(curl "${H[@]}" -X POST $B/api/tasks -d "$G2B" | js d.task.id)
G2B="{\"name\":\"Smoke report milestone $R\",\"due_at\":\"$(node -pe 'new Date(Date.now()+5*864e5).toISOString().slice(0,10)')\"}"
curl "${H[@]}" -X POST $B/api/projects/$G2P/milestones -d "$G2B" >/dev/null
D1X "UPDATE projects SET data_boundary = 'cloud' WHERE id = '$G2P'" >/dev/null # a work project starts Offline only; the boundary PATCH needs the step-up
g2usage() { D1X "SELECT count(*) AS n FROM ai_usage WHERE feature='status_report'" | js 'd[0].results[0].n'; }
U0=$(g2usage)
G2B="{\"program_id\":\"$G2ID\"}"; G2R=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/reports/status -d "$G2B")
[ "$(kst "$G2R")" = 200 ] || fail "g2: summary: $G2R"
kbody "$G2R" | js "typeof d.summary==='string'&&d.summary.includes('Project 1: RAG Amber, 0% done')&&d.summary.includes('CAD: 1 project, planned 1000, spent 250')&&d.summary.includes('Milestones due in the next 30 days: 1')" | grep -qx true || fail "g2: the summary text: $(kbody "$G2R" | head -c 600)"
kbody "$G2R" | grep -q "Smoke report" && fail "g2: a name reached the model: $(kbody "$G2R" | head -c 600)"
[ "$(g2usage)" = $((U0 + 1)) ] || fail "g2: one ai_usage row with feature status_report"
D1X "UPDATE projects SET data_boundary = 'offline' WHERE id = '$G2P'" >/dev/null
G2R=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/reports/status -d "$G2B")
[ "$(kst "$G2R")" = 200 ] && [ "$(kbody "$G2R" | js "d.ai_refused+'|'+('summary' in d)")" = "offline_boundary|false" ] || fail "g2: an Offline-only member: $G2R"
[ "$(g2usage)" = $((U0 + 1)) ] || fail "g2: a refusal was metered"
G2B="{\"program_id\":\"$G2ID\",\"project_id\":\"$G2P\",\"from\":\"2026-10-01\",\"to\":\"2026-10-07\"}"
[ "$(kst "$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/reports/status -d "$G2B")")" = 400 ] || fail "g2: both ids are not 400"
[ "$(kst "$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/reports/status -d '{}')")" = 400 ] || fail "g2: neither id is not 400"
[ "$(kst "$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/reports/status -d '{"program_id":"no-such-program"}')")" = 404 ] || fail "g2: a missing program is not 404"
# clean up (local D1 only): what g2 made
D1X "DELETE FROM milestones WHERE project_id = '$G2P'; DELETE FROM task_events WHERE task_id = '$G2T'; DELETE FROM tasks WHERE id = '$G2T'; DELETE FROM projects WHERE id = '$G2P'; DELETE FROM programs WHERE id = '$G2ID'" >/dev/null
echo "smoke: (g2) program summary: numbers and RAG words only on the stub (no names), one copilot ai_usage row; an Offline-only member refuses with no row; both ids and neither 400; a missing program 404"
# (g3) v2.4 Task 4: settings.workload (P9). A row without the key reads the defaults; hours over 168, an override on a Tuesday and 105 overrides are 400;
# an override is saved and a null removes it. The stored workload is put back as it was.
D1X "UPDATE settings SET json = json_remove(json_set(json, '\$.workload_saved', json_extract(json, '\$.workload')), '\$.workload') WHERE id = 1" >/dev/null
G3=$(curl "${H[@]}" $B/api/settings | js "JSON.stringify(d.workload)")
D1X "UPDATE settings SET json = json_set(json, '\$.workload', json(json_extract(json, '\$.workload_saved'))) WHERE id = 1 AND json_extract(json, '\$.workload_saved') IS NOT NULL; UPDATE settings SET json = json_remove(json, '\$.workload_saved') WHERE id = 1" >/dev/null
[ "$G3" = '{"work_hours":40,"personal_hours":8,"day_hours":8,"default_estimate_minutes":60,"overrides":{}}' ] || fail "g3: an older settings row does not read the defaults: $G3"
G3B='{"workload":{"work_hours":200}}'; [ "$(kst "$(gpatch settings "$G3B")")" = 400 ] || fail "g3: work_hours 200 is not 400"
G3B='{"workload":{"day_hours":0}}'; [ "$(kst "$(gpatch settings "$G3B")")" = 400 ] || fail "g3: day_hours 0 is not 400"
G3B='{"workload":{"overrides":{"2030-01-08":{"work":10,"personal":0}}}}'; [ "$(kst "$(gpatch settings "$G3B")")" = 400 ] || fail "g3: an override on a Tuesday is not 400"
G3B=$(node -pe "const o={};for(let i=0;i<105;i++)o[new Date(Date.UTC(2030,0,7+7*i)).toISOString().slice(0,10)]={work:1,personal:1};JSON.stringify({workload:{overrides:o}})")
[ "$(kst "$(gpatch settings "$G3B")")" = 400 ] || fail "g3: 105 overrides are not 400"
G3B='{"workload":{"overrides":{"2030-01-07":{"work":10,"personal":2}}}}'; G3=$(gpatch settings "$G3B")
[ "$(kst "$G3")" = 200 ] && [ "$(kbody "$G3" | js "JSON.stringify(d.workload.overrides['2030-01-07'])")" = '{"work":10,"personal":2}' ] || fail "g3: a valid override: $G3"
G3B='{"workload":{"overrides":{"2030-01-07":null}}}'; G3=$(gpatch settings "$G3B")
[ "$(kst "$G3")" = 200 ] && [ "$(kbody "$G3" | js "'2030-01-07' in d.workload.overrides")" = false ] || fail "g3: a null override is not removed: $G3"
echo "smoke: (g3) workload settings: an older row reads the defaults; work_hours 200, day_hours 0, a Tuesday override and 105 overrides 400; an override saved, then removed by null"
# (t0) v2.5 Task 0: time entries. A start is 201 and running; a second on the same task is 409 timer_running; five running make the sixth 409 timer_limit; stop ends it
# and a second stop is 200 unchanged; a manual end 10 minutes ahead, 25 hours, a project entry without a note are 400 bad_time; a done task is 409 time_target; a work
# note is ciphertext in D1 (enc_v 2), a personal one plain; GET since returns a trashed row; Trash lists it (task title, no note) and restores it; restoring a running
# entry beside a new one is 409 timer_running; Empty Trash with a task 31 days in Trash removes its entries; export opens the table. Everything it made is removed.
tpost() { curl "${H[@]}" -w '\n%{http_code}' -X POST "$B/api/$1" -d "$2"; }
trun() { D1X "SELECT count(*) AS n FROM time_entries WHERE ended_at IS NULL AND deleted_at IS NULL" | js 'd[0].results[0].n'; }
TRUN=$(trun); [ "$TRUN" -le 3 ] || fail "t0: the local D1 already has $TRUN running timers"
TT=(); for i in 1 2 3 4 5 6 7; do TB="{\"title\":\"Smoke time $R $i\",\"kind\":\"personal\"}"; TT+=("$(curl "${H[@]}" -X POST $B/api/tasks -d "$TB" | js d.task.id)"); done
TB="{\"title\":\"Smoke time work $R\",\"kind\":\"work\"}"; TWT=$(curl "${H[@]}" -X POST $B/api/tasks -d "$TB" | js d.task.id)
TB="{\"title\":\"Smoke time done $R\",\"kind\":\"personal\"}"; TDT=$(curl "${H[@]}" -X POST $B/api/tasks -d "$TB" | js d.task.id); curl "${H[@]}" -X POST $B/api/tasks/$TDT/done >/dev/null
TB="{\"name\":\"Smoke time project $R\",\"kind\":\"personal\"}"; TPJ=$(curl "${H[@]}" -X POST $B/api/projects -d "$TB" | js d.project.id)
X=$(tpost time "{\"task_id\":\"${TT[0]}\"}"); [ "$(kst "$X")" = 201 ] && [ "$(kbody "$X" | js "d.entry.ended_at+'|'+d.entry.source+'|'+d.entry.kind")" = "null|timer|personal" ] || fail "t0: start: $X"
TE1=$(kbody "$X" | js d.entry.id)
X=$(tpost time "{\"task_id\":\"${TT[0]}\"}"); [ "$(kst "$X")" = 409 ] && kbody "$X" | grep -q timer_running || fail "t0: a second start on the task: $X"
for ((i = 1; i <= 3 - TRUN; i++)); do [ "$(kst "$(tpost time "{\"task_id\":\"${TT[$i]}\"}")")" = 201 ] || fail "t0: start $i"; done
X=$(tpost time "{\"task_id\":\"${TT[4]}\"}"); [ "$(kst "$X")" = 201 ] || fail "t0: the fifth timer: $X"
[ "$(trun)" = 5 ] || fail "t0: five timers are not running ($(trun))"
X=$(tpost time "{\"task_id\":\"${TT[5]}\"}"); [ "$(kst "$X")" = 409 ] && kbody "$X" | grep -q timer_limit || fail "t0: the sixth timer: $X"
X=$(tpost time/$TE1/stop '{}'); [ "$(kst "$X")" = 200 ] || fail "t0: stop: $X"
TEND=$(kbody "$X" | js d.entry.ended_at); [ "$TEND" != null ] || fail "t0: stop left it running"
X=$(tpost time/$TE1/stop '{}'); [ "$(kst "$X")" = 200 ] && [ "$(kbody "$X" | js d.entry.ended_at)" = "$TEND" ] || fail "t0: a second stop changed it: $X"
[ "$(kst "$(tpost time/no-such-entry/stop '{}')")" = 404 ] || fail "t0: stopping a missing entry is not 404"
# a note edit after a stop never revives the timer; an edit naming the pre-stop version is 409 time_conflict (compare-and-swap)
X=$(tpost time "{\"task_id\":\"${TT[5]}\"}"); [ "$(kst "$X")" = 201 ] || fail "t0: start for the CAS check: $X"
TES=$(kbody "$X" | js d.entry.id); TEU=$(kbody "$X" | js d.entry.updated_at)
[ "$(kst "$(tpost time/$TES/stop '{}')")" = 200 ] || fail "t0: stop for the CAS check"
X=$(curl "${H[@]}" -w '\n%{http_code}' -X PATCH $B/api/time/$TES -d '{"note":"Smoke after stop"}'); [ "$(kst "$X")" = 200 ] || fail "t0: a note edit after a stop: $X"
[ "$(D1X "SELECT count(*) AS n FROM time_entries WHERE id='$TES' AND ended_at IS NOT NULL" | js 'd[0].results[0].n')" = 1 ] || fail "t0: a note edit revived a stopped timer"
TB="{\"note\":\"Smoke stale\",\"updated_at\":\"$TEU\"}"; X=$(curl "${H[@]}" -w '\n%{http_code}' -X PATCH $B/api/time/$TES -d "$TB")
[ "$(kst "$X")" = 409 ] && kbody "$X" | grep -q time_conflict || fail "t0: a stale edit is not 409: $X"
[ "$(D1X "SELECT note AS a FROM time_entries WHERE id='$TES'" | js 'd[0].results[0].a')" = "Smoke after stop" ] || fail "t0: a stale edit was written"
# refusals
iso() { node -pe "new Date(Date.now()+($1)*6e4).toISOString()"; }
TB="{\"task_id\":\"${TT[0]}\",\"started_at\":\"$(iso -30)\",\"ended_at\":\"$(iso 10)\"}"; X=$(tpost time "$TB"); [ "$(kst "$X")" = 400 ] && kbody "$X" | grep -q bad_time || fail "t0: a manual end 10 minutes ahead: $X"
TB="{\"task_id\":\"${TT[0]}\",\"started_at\":\"$(iso -1560)\",\"ended_at\":\"$(iso -60)\"}"; X=$(tpost time "$TB"); [ "$(kst "$X")" = 400 ] && kbody "$X" | grep -q bad_time || fail "t0: a 25 h manual entry: $X"
TB="{\"task_id\":\"${TT[0]}\",\"started_at\":\"$(iso -30)\",\"ended_at\":\"$(iso -40)\"}"; [ "$(kst "$(tpost time "$TB")")" = 400 ] || fail "t0: an end before the start is not 400"
TB="{\"project_id\":\"$TPJ\",\"started_at\":\"$(iso -30)\",\"ended_at\":\"$(iso -10)\"}"; X=$(tpost time "$TB"); [ "$(kst "$X")" = 400 ] && kbody "$X" | grep -q bad_time || fail "t0: a project entry without a note: $X"
TB="{\"task_id\":\"${TT[0]}\",\"project_id\":\"$TPJ\"}"; [ "$(kst "$(tpost time "$TB")")" = 400 ] || fail "t0: task and project is not 400"
X=$(tpost time "{\"task_id\":\"$TDT\"}"); [ "$(kst "$X")" = 409 ] && kbody "$X" | grep -q time_target || fail "t0: a done task: $X"
# a project entry with a note; a work note sealed in D1, a personal one plain; the list opens it
TB="{\"project_id\":\"$TPJ\",\"note\":\"Smoke time planning $R\",\"started_at\":\"$(iso -30)\",\"ended_at\":\"$(iso -10)\"}"; X=$(tpost time "$TB"); [ "$(kst "$X")" = 201 ] && [ "$(kbody "$X" | js d.entry.source)" = manual ] || fail "t0: a project entry: $X"
TB="{\"task_id\":\"$TWT\",\"note\":\"Smoke time note $R\",\"started_at\":\"$(iso -90)\",\"ended_at\":\"$(iso -60)\"}"; X=$(tpost time "$TB"); [ "$(kst "$X")" = 201 ] || fail "t0: a work entry: $X"
TEW=$(kbody "$X" | js d.entry.id)
RAWT=$(D1X "SELECT note||'|'||enc_v||'|'||kind AS a FROM time_entries WHERE id='$TEW'" | js 'd[0].results[0].a')
case "$RAWT" in *Smoke*) fail "t0: a work note is plain in D1: $RAWT";; *"|2|work") ;; *) fail "t0: a work entry's enc_v or kind: $RAWT";; esac
TB="{\"task_id\":\"${TT[0]}\",\"note\":\"Smoke own note $R\",\"started_at\":\"$(iso -200)\",\"ended_at\":\"$(iso -100)\"}"; X=$(tpost time "$TB"); TEP=$(kbody "$X" | js d.entry.id)
[ "$(D1X "SELECT note||'|'||enc_v AS a FROM time_entries WHERE id='$TEP'" | js 'd[0].results[0].a')" = "Smoke own note $R|0" ] || fail "t0: a personal note is not plain"
curl "${H[@]}" $B/api/time | js "d.entries.some(e=>e.id==='$TEW'&&e.note==='Smoke time note $R')" | grep -qx true || fail "t0: the list does not open the work note"
TB='{"note":"Smoke edited","ended_at":"'"$(iso -95)"'"}'; X=$(curl "${H[@]}" -w '\n%{http_code}' -X PATCH $B/api/time/$TEP -d "$TB"); [ "$(kst "$X")" = 200 ] && [ "$(kbody "$X" | js d.entry.note)" = "Smoke edited" ] || fail "t0: PATCH: $X"
TB='{"ended_at":"'"$(iso -300)"'"}'; [ "$(kst "$(curl "${H[@]}" -w '\n%{http_code}' -X PATCH $B/api/time/$TEP -d "$TB")")" = 400 ] || fail "t0: PATCH an end before the start is not 400"
# trash: since returns it; Trash lists it by its task's title, no note; restore
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X DELETE $B/api/time/$TEP)" = 200 ] || fail "t0: trash an entry"
curl "${H[@]}" "$B/api/time?since=$T0" | js "d.entries.some(e=>e.id==='$TEP'&&e.deleted_at)" | grep -qx true || fail "t0: since does not return the trashed entry"
curl "${H[@]}" $B/api/time | js "d.entries.some(e=>e.id==='$TEP')" | grep -qx false || fail "t0: the plain list returns a trashed entry"
curl "${H[@]}" $B/api/trash | js "const e=d.time_entries.find(x=>x.id==='$TEP'); !!e&&e.label==='Smoke time $R 1'&&!('note' in e)" | grep -qx true || fail "t0: Trash does not list the entry"
[ "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/trash/time_entries/$TEP/restore)" = 200 ] || fail "t0: restore an entry"
# a running entry trashed while a new one starts on its task can't come back
X=$(tpost time "{\"task_id\":\"${TT[0]}\"}"); TER=$(kbody "$X" | js d.entry.id); curl "${H[@]}" -X DELETE $B/api/time/$TER >/dev/null
[ "$(kst "$(tpost time "{\"task_id\":\"${TT[0]}\"}")")" = 201 ] || fail "t0: start after trashing the running entry"
X=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/trash/time_entries/$TER/restore); [ "$(kst "$X")" = 409 ] && kbody "$X" | grep -q timer_running || fail "t0: restore beside a running timer: $X"
# purge: a task 31 days in Trash takes its entries with it
TB="{\"task_id\":\"${TT[6]}\",\"started_at\":\"$(iso -30)\",\"ended_at\":\"$(iso -10)\"}"; TEG=$(kbody "$(tpost time "$TB")" | js d.entry.id)
curl "${H[@]}" -X DELETE $B/api/tasks/${TT[6]} >/dev/null
D1X "UPDATE tasks SET deleted_at = '$(node -pe 'new Date(Date.now()-31*864e5).toISOString()')' WHERE id='${TT[6]}'" >/dev/null
X=$(curl "${H[@]}" -w '\n%{http_code}' -X POST $B/api/trash/empty); [ "$(kst "$X")" = 200 ] && [ "$(kbody "$X" | js d.purged.time_entries)" -ge 2 ] || fail "t0: Empty Trash: $X"
[ "$(D1X "SELECT count(*) AS n FROM time_entries WHERE id IN ('$TEG','$TER')" | js 'd[0].results[0].n')" = 0 ] || fail "t0: an entry survived Empty Trash"
# export opens the work note; audit rows carry no note
curl "${H[@]}" $B/api/export | js "d.time_entries.some(e=>e.id==='$TEW'&&e.note==='Smoke time note $R'&&!('enc_v' in e))" | grep -qx true || fail "t0: export did not open the time entries"
D1X "SELECT count(*) AS n FROM audit_log WHERE action LIKE 'time.%' AND detail LIKE '%Smoke%'" | js 'd[0].results[0].n' | grep -qx 0 || fail "t0: an audit row carries a note"
# clean up (local D1 only)
D1X "DELETE FROM time_entries WHERE created_at >= '$T0'" >/dev/null
curl "${H[@]}" -X DELETE $B/api/projects/$TPJ >/dev/null
echo "smoke: (t0) time: start 201 running, same task 409 timer_running, sixth 409 timer_limit, stop twice same end, future end / 25 h / no project note 400, done task 409 time_target, work note ciphertext (personal plain), since returns a trashed entry, note edit after a stop keeps it stopped, stale edit 409 time_conflict, Trash lists and restores it (running beside a new one 409), Empty Trash removes a purged task's entries, export opens them"
# (t1) v2.5 Task 2: forgotten timers. A timer running 5 h gets one outbox push (key timer:<id>:4h, body without the task title) and a second cron adds none; one running
# 13 h is stopped at start + 12 h with auto_stopped = 1. Quiet hours are switched off while it runs. Local D1 only; the seeded rows are removed.
T1Q=$(curl "${H[@]}" $B/api/settings | js '[d.quiet_from,d.quiet_to].join()'); curl "${H[@]}" -X PATCH $B/api/settings -d '{"quiet_from":"00:00","quiet_to":"00:00"}' >/dev/null
TB="{\"title\":\"Smoke forgotten timer $R\",\"kind\":\"personal\"}"; T1T=$(curl "${H[@]}" -X POST $B/api/tasks -d "$TB" | js d.task.id)
iso() { date -u -v-"$1"H +%Y-%m-%dT%H:%M:%S.000Z; }
T1S5=$(iso 5); T1S13=$(iso 13)
D1X "INSERT INTO time_entries (id, task_id, kind, started_at, source, created_at, updated_at) VALUES ('smk-t1-5','$T1T','personal','$T1S5','timer','$T1S5','$T1S5'), ('smk-t1-13','$T1T','personal','$T1S13','timer','$T1S13','$T1S13')" >/dev/null
cron; sleep 1
t1n() { D1X "SELECT count(*) AS n FROM push_outbox WHERE id LIKE 'timer:smk-t1-%'" | js 'd[0].results[0].n'; }
[ "$(t1n)" = 1 ] || fail "t1: expected one timer push, got $(t1n)"
D1X "SELECT body FROM push_outbox WHERE id = 'timer:smk-t1-5:4h'" | js 'd[0].results[0].body' | grep -qx 'A timer has been running 4h' || fail "t1: the push body"
D1X "SELECT title, body FROM push_outbox WHERE id LIKE 'timer:smk-t1-%'" | grep -q "Smoke forgotten" && fail "t1: the push carries the task title"
cron; sleep 1
[ "$(t1n)" = 1 ] || fail "t1: a second cron sent another push"
D1X "SELECT auto_stopped AS a, ended_at AS e, started_at AS s FROM time_entries WHERE id = 'smk-t1-13'" | js 'd[0].results[0].a+"|"+(d[0].results[0].e===new Date(Date.parse(d[0].results[0].s)+12*3600e3).toISOString())' | grep -qx '1|true' || fail "t1: the 13 h timer was not stopped at start + 12 h"
D1X "SELECT ended_at IS NULL AS r, auto_stopped AS a FROM time_entries WHERE id = 'smk-t1-5'" | js 'd[0].results[0].r+"|"+d[0].results[0].a' | grep -qx '1|0' || fail "t1: the 5 h timer should still run"
D1X "DELETE FROM time_entries WHERE id LIKE 'smk-t1-%'; DELETE FROM push_outbox WHERE id LIKE 'timer:smk-t1-%'; DELETE FROM push_log WHERE key LIKE 'timer:smk-t1-%'" >/dev/null
curl "${H[@]}" -X DELETE $B/api/tasks/$T1T >/dev/null
curl "${H[@]}" -X PATCH $B/api/settings -d "{\"quiet_from\":\"${T1Q%,*}\",\"quiet_to\":\"${T1Q#*,}\"}" >/dev/null
echo "smoke: (t1) forgotten timers: 5 h -> one outbox push without the task title, second cron adds none; 13 h -> stopped at start + 12 h, auto_stopped"
# clean up (local D1 only): the system rows, the test tasks and project
D1X "DELETE FROM knowledge_chunks WHERE collection_id IN (SELECT id FROM knowledge_collections WHERE system=1); DELETE FROM knowledge_items WHERE collection_id IN (SELECT id FROM knowledge_collections WHERE system=1); DELETE FROM knowledge_collections WHERE system=1; DELETE FROM audit_log WHERE action IN ('knowledge.apps.refresh','knowledge.apps.done')" >/dev/null
kill $STUB; wait $STUB 2>/dev/null || true; trap - EXIT
for x in $K4T1 $K4T2; do curl "${H[@]}" -X DELETE $B/api/tasks/$x >/dev/null; done; curl "${H[@]}" -X DELETE $B/api/projects/$K4WP >/dev/null
# The smoke's own leftovers (local D1 only): its tasks go to Trash, and the knowledge rows it made (collections, items, passages) are removed, so reruns see the same counts.
D1X "UPDATE tasks SET deleted_at = '$(date -u +%Y-%m-%dT%H:%M:%S.000Z)' WHERE deleted_at IS NULL AND created_at >= '$T0'; DELETE FROM knowledge_chunks WHERE collection_id IN (SELECT id FROM knowledge_collections WHERE created_at >= '$T0'); DELETE FROM knowledge_items WHERE collection_id IN (SELECT id FROM knowledge_collections WHERE created_at >= '$T0'); DELETE FROM knowledge_collections WHERE created_at >= '$T0'" >/dev/null
curl -s -o /dev/null -w '%{http_code}' $B/api/tasks | grep -q 401 || fail "guard (no cookie)"
echo "smoke: ok"
