#!/bin/sh
# Checks the Android app's pure Java (CompassLink, and the widgets' snapshot, URLs and files: where the web view, sign-in, links, notification taps and shares may go) with javac
# alone: no Gradle, no emulator, no network.   sh mobile/test-java.sh
set -e
cd "$(dirname "$0")"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
mkdir -p "$out/src/com/knocturnlabs/compass"
cp android/app/src/main/java/com/knocturnlabs/compass/CompassLink.java "$out/src/com/knocturnlabs/compass/"
cat > "$out/src/com/knocturnlabs/compass/Check.java" <<'JAVA'
package com.knocturnlabs.compass;

import java.net.URI;

public class Check {
    static void check(boolean ok, String what) { if (!ok) { System.out.println("FAIL: " + what); System.exit(1); } }
    static URI u(String s) { return URI.create(s); }

    public static void main(String[] args) {
        URI prod = u("https://compass.knocturnlabs.com"), dev = u("http://localhost:5173");

        // Navigation: Compass stays in, other pages go to the browser, mailto/tel to their apps, every other scheme nowhere.
        check(CompassLink.route(u("https://compass.knocturnlabs.com/projects/1?x=1#y"), prod) == CompassLink.Route.IN_APP, "compass in");
        check(CompassLink.route(u("https://COMPASS.knocturnlabs.com/"), prod) == CompassLink.Route.IN_APP, "host case");
        check(CompassLink.route(u("http://localhost:5173/today"), dev) == CompassLink.Route.IN_APP, "local server in");
        for (String out : new String[] { "https://example.com/", "http://compass.knocturnlabs.com/", "https://compass.knocturnlabs.com:8443/",
                "https://compass.knocturnlabs.com.evil.com/", "https://compass.knocturnlabs.com@evil.com/", "https://me@compass.knocturnlabs.com/",
                "https://id.knocturnlabs.com/", "http://localhost:5174/", "https://localhost/", "mailto:a@b.c", "tel:+15555550100" }) {
            check(CompassLink.route(u(out), out.startsWith("http://localhost") ? dev : prod) == CompassLink.Route.EXTERNAL, "external: " + out);
        }
        for (String bad : new String[] { "javascript:alert(1)", "data:text/html,hi", "file:///etc/hosts", "sms:1", "compass://auth?code=1",
                "intent://x#Intent;scheme=https;end", "market://details?id=x", "blob:https://compass.knocturnlabs.com/1", "content://x/y" }) {
            check(CompassLink.route(u(bad), prod) == CompassLink.Route.DROP, "dropped: " + bad);
        }

        // openExternal: http(s), mailto, tel only.
        check(CompassLink.external("https://example.com/a") != null && CompassLink.external("mailto:a@b.c") != null && CompassLink.external("tel:1") != null, "external ok");
        for (String bad : new String[] { null, "", "javascript:alert(1)", "file:///x", "compass://auth", "sms:1", "not a url", "intent://x#Intent;end" }) {
            check(CompassLink.external(bad) == null, "external refused: " + bad);
        }

        // Sign-in: only Knocturn ID's https page, only back to compass://.
        String good = "https://id.knocturnlabs.com/?app=compass&redirect_uri=compass%3A%2F%2Fauth&state=s";
        check(good.equals(CompassLink.signIn(good, "compass")), "sign-in ok");
        String[][] refused = { { good, "health" }, { good, null }, { good, "Compass" }, { "http://id.knocturnlabs.com/", "compass" },
            { "https://evil.com/", "compass" }, { "https://id.knocturnlabs.com.evil.com/", "compass" }, { "https://id.knocturnlabs.com@evil.com/", "compass" },
            { "https://x@id.knocturnlabs.com/", "compass" }, { "https://id.knocturnlabs.com:444/", "compass" }, { "compass://auth", "compass" }, { null, "compass" } };
        for (String[] r : refused) check(CompassLink.signIn(r[0], r[1]) == null, "sign-in refused: " + r[0] + " " + r[1]);

        // Notification taps and App Links: Compass only, with ?search#hash kept.
        check("https://compass.knocturnlabs.com/meetings/1?a=b#c".equals(CompassLink.open("/meetings/1?a=b#c", prod)), "path");
        check("https://compass.knocturnlabs.com/".equals(CompassLink.open("/", prod)), "home");
        check("https://compass.knocturnlabs.com/projects/2".equals(CompassLink.open("https://compass.knocturnlabs.com/projects/2", prod)), "full url");
        check("http://localhost:5173/projects/2".equals(CompassLink.open("/projects/2", dev)), "local server path");
        check("https://compass.knocturnlabs.com/x".equals(CompassLink.open("https://compass.knocturnlabs.com/x", dev)), "compass url on a local build");
        for (Object bad : new Object[] { null, 3, "", "https://evil.com/", "//evil.com/x", "javascript:alert(1)", "http://compass.knocturnlabs.com/",
                "https://me@compass.knocturnlabs.com/", "https://compass.knocturnlabs.com.evil.com/", "compass://auth", "data:text/html,x",
                "https://compass.knocturnlabs.com:8443/", "https://compass.knocturnlabs.com\\@evil.com/" }) {
            check(CompassLink.open(bad, prod) == null, "tap refused: " + bad);
        }

        // Shares: a browser's title (subject) and URL (text) become title then URL; text alone stays as it is.
        check("Page title\nhttps://example.com/a".equals(CompassLink.shared("Page title", "https://example.com/a")), "subject + url");
        check("Buy milk".equals(CompassLink.shared(null, "  Buy milk ")), "text only");
        check("Note https://x.y".equals(CompassLink.shared("Note", "Note https://x.y")), "subject already in text");
        check("Title".equals(CompassLink.shared("Title", "")), "subject only");
        check(CompassLink.shared(null, "  ") == null && CompassLink.shared(" ", null) == null, "nothing");

        // Capture (Athena's mic): only the page on the server the app shows, only the microphone.
        String[] mic = { CompassLink.AUDIO_CAPTURE };
        check(CompassLink.mayCapture("https://compass.knocturnlabs.com/", mic, prod), "mic on compass");
        check(CompassLink.mayCapture("https://compass.knocturnlabs.com", mic, prod), "origin without a slash");
        check(CompassLink.mayCapture("http://localhost:5173/", mic, dev), "mic on the local server");
        check(!CompassLink.mayCapture("https://compass.knocturnlabs.com/", new String[] { "android.webkit.resource.VIDEO_CAPTURE" }, prod), "camera refused");
        check(!CompassLink.mayCapture("https://compass.knocturnlabs.com/", new String[] { CompassLink.AUDIO_CAPTURE, "android.webkit.resource.VIDEO_CAPTURE" }, prod), "mic + camera refused");
        check(!CompassLink.mayCapture("https://compass.knocturnlabs.com/", new String[] { "android.webkit.resource.MIDI_SYSEX" }, prod), "midi refused");
        check(!CompassLink.mayCapture("https://compass.knocturnlabs.com/", new String[0], prod) && !CompassLink.mayCapture("https://compass.knocturnlabs.com/", null, prod), "nothing asked");
        for (String bad : new String[] { null, "", "null", "https://evil.com/", "http://compass.knocturnlabs.com/", "https://compass.knocturnlabs.com.evil.com/",
                "https://compass.knocturnlabs.com:8443/", "https://me@compass.knocturnlabs.com/", "https://id.knocturnlabs.com/", "file:///x", "http://localhost:5173/" }) {
            check(!CompassLink.mayCapture(bad, mic, prod), "mic refused: " + bad);
        }

        // Download names can't name a folder.
        check("report.docx".equals(CompassLink.fileName("report.docx")), "plain name");
        check("passwd".equals(CompassLink.fileName("../../etc/passwd")), "no path");
        check("x.md".equals(CompassLink.fileName("a\\b\\x.md")), "no backslash path");
        check("ab.txt".equals(CompassLink.fileName("a\nb.txt")), "no control characters");
        for (String bad : new String[] { null, "", " ", ".", "..", "a/" }) check("download".equals(CompassLink.fileName(bad)), "fallback: " + bad);
        check(CompassLink.fileName("x".repeat(400)).length() == 150, "150 at most");

        System.out.println("CompassLink (Android): all checks passed");
    }
}
JAVA
javac -d "$out/classes" "$out/src/com/knocturnlabs/compass/"*.java
java -cp "$out/classes" com.knocturnlabs.compass.Check

# Widgets (v2.3, Android): the snapshot, the URLs a tap or tick may use, the files and the token's sealing. They use org.json, which is
# Android's own: its sources come from the SDK (sources/android-*), with the four annotations they name stubbed. No device needed.
sdk="${ANDROID_HOME:-$(sed -n 's/^sdk.dir=//p' android/local.properties 2>/dev/null)}"
json=$(ls -d "$sdk"/sources/android-*/org/json 2>/dev/null | tail -1)
if [ -z "$json" ]; then echo "FAIL: org.json sources not found under \$ANDROID_HOME/sources (install 'Sources for Android SDK')"; exit 1; fi
w="$out/w"
mkdir -p "$w/org/json" "$w/android/annotation" "$w/android/compat/annotation" "$w/libcore/util" "$w/com/knocturnlabs/compass/widgets"
cp "$json"/*.java "$w/org/json/"
echo 'package android.annotation; public @interface SystemApi { enum Client { MODULE_LIBRARIES } Client client(); }' > "$w/android/annotation/SystemApi.java"
echo 'package android.compat.annotation; public @interface UnsupportedAppUsage { int maxTargetSdk() default 0; long trackingBug() default 0; String publicAlternatives() default ""; }' > "$w/android/compat/annotation/UnsupportedAppUsage.java"
echo 'package libcore.util; @java.lang.annotation.Target({java.lang.annotation.ElementType.TYPE_USE, java.lang.annotation.ElementType.METHOD, java.lang.annotation.ElementType.PARAMETER, java.lang.annotation.ElementType.FIELD}) public @interface Nullable {}' > "$w/libcore/util/Nullable.java"
echo 'package libcore.util; @java.lang.annotation.Target({java.lang.annotation.ElementType.TYPE_USE, java.lang.annotation.ElementType.METHOD, java.lang.annotation.ElementType.PARAMETER, java.lang.annotation.ElementType.FIELD}) public @interface NonNull {}' > "$w/libcore/util/NonNull.java"
cp android/app/src/main/java/com/knocturnlabs/compass/widgets/WidgetSnapshot.java android/app/src/main/java/com/knocturnlabs/compass/widgets/WidgetUrls.java \
   android/app/src/main/java/com/knocturnlabs/compass/widgets/WidgetStore.java "$w/com/knocturnlabs/compass/widgets/"
cat > "$w/com/knocturnlabs/compass/widgets/Check.java" <<'JAVA'
package com.knocturnlabs.compass.widgets;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.json.JSONObject;

public class Check {
    static void check(boolean ok, String what) { if (!ok) { System.out.println("FAIL: " + what); System.exit(1); } }
    static boolean eq(Object a, Object b) { return a == null ? b == null : a.equals(b); }

    public static void main(String[] args) throws Exception {
        // URLs: taps are Compass links with the ids encoded; a tick goes to Compass only.
        check(WidgetUrls.task("t-1").equals("https://compass.knocturnlabs.com/?task=t-1"), "task url");
        check(WidgetUrls.task("a/b?c=d#e f").equals("https://compass.knocturnlabs.com/?task=a%2Fb%3Fc%3Dd%23e%20f"), "task id encoded");
        check(WidgetUrls.dashboard("p 1/..").equals("https://compass.knocturnlabs.com/projects/p%201%2F%2E%2E/dashboard"), "dashboard id encoded");
        check(WidgetUrls.task(null).equals(WidgetUrls.TODAY) && WidgetUrls.dashboard("").equals(WidgetUrls.TODAY), "no id: Today");
        String prod = "https://compass.knocturnlabs.com";
        check(eq(WidgetUrls.doneUrl("t-1", prod, false), "https://compass.knocturnlabs.com/api/widget/tasks/t-1/done"), "done url");
        check(eq(WidgetUrls.doneUrl("t-1", prod + "/", false), "https://compass.knocturnlabs.com/api/widget/tasks/t-1/done"), "trailing slash");
        check(eq(WidgetUrls.doneUrl("../x?y", prod, false), "https://compass.knocturnlabs.com/api/widget/tasks/%2E%2E%2Fx%3Fy/done"), "done id encoded");
        for (String bad : new String[] { "http://compass.knocturnlabs.com", "https://compass.knocturnlabs.com:8443", "https://evil.com",
                "https://compass.knocturnlabs.com.evil.com", "https://me@compass.knocturnlabs.com", "https://compass.knocturnlabs.com@evil.com",
                "https://compass.knocturnlabs.com/api", "https://compass.knocturnlabs.com/?x=1", "https://compass.knocturnlabs.com/#x",
                "https://id.knocturnlabs.com", "http://localhost:8790", "http://127.0.0.1:5173", "ftp://compass.knocturnlabs.com",
                "https://compass.knocturnlabs.com\\@evil.com", "", "not a url", null }) {
            check(WidgetUrls.doneUrl("t-1", bad, false) == null, "tick refused: " + bad);
        }
        check(eq(WidgetUrls.doneUrl("t-1", "http://localhost:5173", true), "http://localhost:5173/api/widget/tasks/t-1/done"), "localhost when allowed");
        check(eq(WidgetUrls.doneUrl("t-1", "http://127.0.0.1:8790/", true), "http://127.0.0.1:8790/api/widget/tasks/t-1/done"), "127.0.0.1 when allowed");
        for (String bad : new String[] { "http://10.0.2.2:5173", "http://localhost.evil.com:5173", "https://localhost:5173", "http://me@localhost:5173" }) {
            check(WidgetUrls.doneUrl("t-1", bad, true) == null, "local refused: " + bad);
        }
        check(WidgetUrls.doneUrl("", prod, false) == null && WidgetUrls.doneUrl(null, prod, false) == null && WidgetUrls.doneUrl("x".repeat(65), prod, false) == null, "bad ids");
        check(WidgetUrls.server(null, true).equals(prod) && WidgetUrls.server("http://localhost:5173", false).equals(prod), "production by default");
        check(WidgetUrls.server("http://localhost:5173", true).equals("http://localhost:5173"), "a debuggable local build");
        check(WidgetUrls.server("https://evil.com", true).equals(prod) && WidgetUrls.server("http://10.0.2.2:5173", true).equals(prod), "never another server");
        check(WidgetUrls.settles(200), "200 settles");
        for (int s : new int[] { 201, 204, 301, 302, 401, 404, 429, 500, -1 }) check(!WidgetUrls.settles(s), "stays queued: " + s);

        // Snapshot: the sample parses; missing fields are empty; anything else is the placeholder.
        String sample = new String(Files.readAllBytes(new File("../scripts/fixtures/widget-snapshot.sample.json").toPath()), StandardCharsets.UTF_8);
        WidgetSnapshot s = WidgetSnapshot.parse(sample);
        check(s != null && s.due == 3 && s.late == 1 && s.done == 1 && s.total == 4 && s.blocked == 1, "sample counts");
        check(s.items.size() == 6 && s.projects.size() == 4 && s.week.size() == 7 && s.next != null && s.next.id.equals("t-vendor"), "sample lists");
        WidgetSnapshot.Item secret = null;
        for (WidgetSnapshot.Item i : s.items) if (i.id.equals("t-secret")) secret = i;
        check(secret != null && secret.title == null && secret.shown().equals("Offline-only task") && !secret.named(), "an Offline task has no title (not \"null\")");
        check(s.items.get(0).shown().equals("Send the status report") && s.items.get(0).late && s.items.get(0).dueLabel.equals("Yesterday"), "a named task");
        check(s.projects.get(2).shownName().equals("Offline-only project") && s.projects.get(2).milestoneName == null, "an Offline project has no name");
        check(s.projects.get(0).slipDays == 7 && s.projects.get(0).highRisks == 3 && s.projects.get(1).slipDays == null && s.projects.get(3).rag.equals("none") && !s.projects.get(3).hasMilestone, "project fields");
        check(s.footerMilestone() == s.projects.get(0) && s.weekOpen() == 5, "footer milestone and week total");
        WidgetSnapshot bare = WidgetSnapshot.parse("{\"v\":1}");
        check(bare != null && bare.items.isEmpty() && bare.projects.isEmpty() && bare.week.isEmpty() && bare.next == null && bare.due == 0 && bare.footerMilestone() == null, "missing fields are empty");
        WidgetSnapshot odd = WidgetSnapshot.parse("{\"v\":1,\"items\":[null,3,{\"title\":\"no id\"},{\"id\":\"a\"}],\"today\":{\"next\":{}},\"projects\":[{\"id\":\"p\",\"rag\":null}]}");
        check(odd != null && odd.items.size() == 1 && odd.items.get(0).dueLabel.equals("") && odd.next == null && odd.projects.get(0).rag.equals("none"), "odd entries skipped");
        for (String bad : new String[] { null, "", "garbage", "[]", "{\"v\":2}", "{\"v\":\"1x\"}", "{" }) check(WidgetSnapshot.parse(bad) == null, "placeholder for: " + bad);

        // A tick: the late task leaves every list and its counts move.
        WidgetSnapshot a = WidgetSnapshot.parse(s.markingDone("t-status"));
        check(a.due == 2 && a.late == 0 && a.done == 2 && a.total == 4, "late tick counts");
        check(a.items.size() == 5 && a.mediumItems.size() == 1 && a.projects.get(0).overdue == 0 && a.week.get(1).mediumCount == 0, "late tick lists, overdue, week");
        check(a.next.id.equals("t-vendor"), "next unchanged");
        WidgetSnapshot b = WidgetSnapshot.parse(s.markingDone("t-vendor"));
        check(b.next != null && b.next.id.equals("t-secret") && b.due == 2 && b.late == 1 && b.week.get(2).shortCount == 1, "next re-picked: due today first");
        WidgetSnapshot c = WidgetSnapshot.parse(s.markingDone("t-sow"));
        check(c.due == 3 && c.done == 1 && c.week.get(4).shortCount == 0 && c.shortItems.size() == 2, "a Friday task: only its day moves");
        check(s.markingDone("nope") == null && s.markingDone(null) == null, "unknown id: unchanged");
        check(new JSONObject(s.markingDone("t-status")).getJSONObject("lock").getBoolean("hide_work"), "other fields kept");

        // Dates in the snapshot's zone.
        check(eq(s.atDay(), "2026-10-21") && WidgetSnapshot.weekday("2026-10-20").equals("Tue") && WidgetSnapshot.weekday("bad").equals(""), "days");
        check(WidgetSnapshot.header(java.time.Instant.parse("2026-10-21T15:00:00Z").toEpochMilli(), "America/Toronto").equals("Wed Oct 21"), "header");
        long late = java.time.Instant.parse("2026-10-22T03:30:00Z").toEpochMilli(), after = java.time.Instant.parse("2026-10-22T04:30:00Z").toEpochMilli();
        check(!s.isStale(late) && s.isStale(after), "stale after Toronto midnight");
        check(WidgetSnapshot.parse("{\"v\":1,\"at\":\"x\"}").isStale(late), "unreadable at is stale");
        check(WidgetSnapshot.ymd(late, "Not/AZone") != null, "unknown zone does not throw");
        check(eq(WidgetSnapshot.dayOffset("Today", "2026-10-21"), 0) && eq(WidgetSnapshot.dayOffset("3d late", "2026-10-21"), -3) && eq(WidgetSnapshot.dayOffset("Fri", "2026-10-21"), 2)
            && WidgetSnapshot.dayOffset("Thu", "2026-10-21") == null && WidgetSnapshot.dayOffset("Oct 30", "2026-10-21") == null && WidgetSnapshot.dayOffset("xd late", "2026-10-21") == null, "day offsets");
        check(eq(WidgetSnapshot.addDays("2026-10-31", 1), "2026-11-01") && WidgetSnapshot.addDays("x", 1) == null, "add days");

        // Files: written whole, refused when too big or not an object, removed with '', ticks queued once and taken once.
        File dir = Files.createTempDirectory("widgets").toFile();
        WidgetStore.write(dir, sample);
        check(WidgetStore.read(dir) != null && !new File(dir, WidgetStore.SNAPSHOT + ".tmp").exists(), "written, no temp left");
        String code = null;
        try { WidgetStore.write(dir, "{\"v\":1,\"x\":\"" + "a".repeat(WidgetStore.MAX_BYTES) + "\"}"); } catch (WidgetStore.Failure f) { code = f.code; }
        check("too_big".equals(code) && WidgetStore.read(dir) != null, "over 64 KB refused, old file kept");
        code = null;
        try { WidgetStore.write(dir, "[1]"); } catch (WidgetStore.Failure f) { code = f.code; }
        check("invalid_request".equals(code) && WidgetStore.read(dir) != null, "not an object refused");
        WidgetStore.tick(dir, "t-status", "2026-10-21T15:01:00.000Z");
        WidgetStore.tick(dir, "t-status", "2026-10-21T15:02:00.000Z");
        check(WidgetStore.read(dir).late == 0 && WidgetStore.read(dir).items.size() == 5, "tick rewrites the snapshot");
        WidgetStore.appendTick(dir, "t-2", "2026-10-21T15:03:00.000Z");
        WidgetStore.removeTick(dir, "t-2");
        List<String[]> taken = WidgetStore.takeTicks(dir);
        check(taken.size() == 1 && taken.get(0)[0].equals("t-status") && taken.get(0)[1].equals("2026-10-21T15:01:00.000Z"), "queued once, removed tick gone");
        check(WidgetStore.takeTicks(dir).isEmpty() && !new File(dir, WidgetStore.TICKS).exists(), "taken once");
        Files.write(new File(dir, WidgetStore.TICKS).toPath(), "[{\"id\":\"ok\",\"at\":\"t\"},{\"id\":5,\"at\":\"t\"},null,{\"id\":\"\",\"at\":\"t\"},{\"id\":\"no-at\"}]".getBytes());
        taken = WidgetStore.takeTicks(dir);
        check(taken.size() == 1 && taken.get(0)[0].equals("ok"), "only well-formed ticks");
        Files.write(new File(dir, WidgetStore.TICKS).toPath(), "garbage".getBytes());
        check(WidgetStore.takeTicks(dir).isEmpty(), "corrupt ticks file");
        for (int i = 0; i < 205; i++) WidgetStore.appendTick(dir, "t" + i, "at");
        check(WidgetStore.takeTicks(dir).size() == WidgetStore.MAX_TICKS, "200 at most");
        WidgetStore.appendTick(dir, "x".repeat(65), "at");
        check(WidgetStore.takeTicks(dir).isEmpty(), "a long id is not queued");
        boolean threw = false;
        try { WidgetStore.tick(new File(dir, "none"), "t-1", "at"); } catch (java.io.IOException e) { threw = true; }
        check(threw, "a tick that can't be queued says so (the receiver keeps going)");
        WidgetStore.write(dir, "");
        check(WidgetStore.read(dir) == null && !new File(dir, WidgetStore.SNAPSHOT).exists(), "'' removes it");
        WidgetStore.tick(dir, "t-1", "at");
        check(WidgetStore.read(dir) == null && WidgetStore.takeTicks(dir).size() == 1, "a tick with no snapshot is still queued, never re-creates the file");

        // Token: only the server's shape; sealed with AES-GCM (a software key here, the Keystore's on a device), opened only by that key.
        String tok = "abcdefghijklmnopqrstuvwxyz0123456789-_AB";
        check(WidgetStore.validToken(tok) && !WidgetStore.validToken("short") && !WidgetStore.validToken(tok + " ") && !WidgetStore.validToken(null) && !WidgetStore.validToken("a".repeat(201)), "token shape");
        KeyGenerator kg = KeyGenerator.getInstance("AES");
        kg.init(256);
        SecretKey k1 = kg.generateKey(), k2 = kg.generateKey();
        byte[] blob = WidgetStore.seal(k1, tok);
        check(eq(WidgetStore.open(k1, blob), tok), "round trip");
        check(!new String(blob, StandardCharsets.ISO_8859_1).contains(tok), "sealed, not plain");
        check(!java.util.Arrays.equals(blob, WidgetStore.seal(k1, tok)), "a fresh iv each time");
        check(WidgetStore.open(k2, blob) == null, "another key can't open it");
        blob[blob.length - 1] ^= 1;
        check(WidgetStore.open(k1, blob) == null && WidgetStore.open(k1, new byte[20]) == null && WidgetStore.open(k1, null) == null && WidgetStore.open(null, blob) == null, "tampered or short");
        check(WidgetStore.open(k1, WidgetStore.seal(k1, "bad token!")) == null, "only a valid token comes out");

        System.out.println("Widgets (Android): all checks passed");
    }
}
JAVA
javac -nowarn -d "$out/wclasses" $(find "$w" -name '*.java') 2>&1 | grep -v '^Note:' || true
test -f "$out/wclasses/com/knocturnlabs/compass/widgets/Check.class" || { echo "FAIL: widget checks didn't compile"; exit 1; }
java -cp "$out/wclasses" com.knocturnlabs.compass.widgets.Check
