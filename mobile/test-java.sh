#!/bin/sh
# Checks the Android app's pure Java (CompassLink: where the web view, sign-in, links, notification taps and shares may go) with javac
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
