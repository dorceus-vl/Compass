#!/bin/sh
# Checks the app's pure Swift (CompassLink: where the web view, sign-in, links and notification taps may go) with the Swift compiler
# alone: no Xcode project, no simulator, no network.   sh mobile/test-swift.sh
set -e
cd "$(dirname "$0")"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
cat > "$out/main.swift" <<'SWIFT'
import Foundation
func check(_ ok: Bool, _ what: String) { if !ok { print("FAIL: \(what)"); exit(1) } }
let u = { (s: String) in URL(string: s)! }
let prod = u("https://compass.knocturnlabs.com"), dev = u("http://localhost:5173")

// Navigation: Compass stays in, other pages go to the browser, mailto/tel to their apps, every other scheme nowhere.
check(CompassLink.route(u("https://compass.knocturnlabs.com/projects/1?x=1#y"), server: prod) == .inApp, "compass in")
check(CompassLink.route(u("https://COMPASS.knocturnlabs.com/"), server: prod) == .inApp, "host case")
check(CompassLink.route(u("http://localhost:5173/today"), server: dev) == .inApp, "local server in")
for out in ["https://example.com/", "http://compass.knocturnlabs.com/", "https://compass.knocturnlabs.com:8443/", "https://compass.knocturnlabs.com.evil.com/",
            "https://compass.knocturnlabs.com@evil.com/", "https://me@compass.knocturnlabs.com/", "https://id.knocturnlabs.com/", "http://localhost:5174/",
            "mailto:a@b.c", "tel:+15555550100"] {
    check(CompassLink.route(u(out), server: out.hasPrefix("http://localhost") ? dev : prod) == .external, "external: \(out)")
}
for bad in ["javascript:alert(1)", "data:text/html,hi", "file:///etc/hosts", "sms:1", "compass://auth?code=1", "itms-services://x", "blob:https://compass.knocturnlabs.com/1"] {
    check(CompassLink.route(u(bad), server: prod) == .drop, "dropped: \(bad)")
}

// openExternal: http(s), mailto, tel only.
check(CompassLink.external("https://example.com/a") != nil && CompassLink.external("mailto:a@b.c") != nil && CompassLink.external("tel:1") != nil, "external ok")
for bad: String? in [nil, "", "javascript:alert(1)", "file:///x", "compass://auth", "sms:1", "not a url"] { check(CompassLink.external(bad) == nil, "external refused: \(String(describing: bad))") }

// Sign-in: only Knocturn ID's https page, only back to compass://.
let good = "https://id.knocturnlabs.com/?app=compass&redirect_uri=compass%3A%2F%2Fauth&state=s"
check(CompassLink.signIn(good, callbackScheme: "compass")?.absoluteString == good, "sign-in ok")
for (url, scheme) in [(good, "health"), (good, nil), (good, "Compass"), ("http://id.knocturnlabs.com/", "compass"), ("https://evil.com/", "compass"),
                      ("https://id.knocturnlabs.com.evil.com/", "compass"), ("https://id.knocturnlabs.com@evil.com/", "compass"),
                      ("https://x@id.knocturnlabs.com/", "compass"), ("https://id.knocturnlabs.com:444/", "compass"), ("compass://auth", "compass")] as [(String, String?)] {
    check(CompassLink.signIn(url, callbackScheme: scheme) == nil, "sign-in refused: \(url) \(String(describing: scheme))")
}
check(CompassLink.signIn(nil, callbackScheme: "compass") == nil, "no url")

// Notification taps and universal links: Compass only, with ?search#hash kept.
check(CompassLink.open("/meetings/1?a=b#c", server: prod) == "https://compass.knocturnlabs.com/meetings/1?a=b#c", "path")
check(CompassLink.open("/", server: prod) == "https://compass.knocturnlabs.com/", "home")
check(CompassLink.open("https://compass.knocturnlabs.com/projects/2", server: prod) == "https://compass.knocturnlabs.com/projects/2", "full url")
check(CompassLink.open("/projects/2", server: dev) == "http://localhost:5173/projects/2", "local server path")
check(CompassLink.open("https://compass.knocturnlabs.com/x", server: dev) == "https://compass.knocturnlabs.com/x", "compass url on a local build")
for bad: Any? in [nil, 3, "", "https://evil.com/", "//evil.com/x", "javascript:alert(1)", "http://compass.knocturnlabs.com/", "https://me@compass.knocturnlabs.com/",
                  "https://compass.knocturnlabs.com.evil.com/", "compass://auth", "data:text/html,x", "https://compass.knocturnlabs.com:8443/"] {
    check(CompassLink.open(bad, server: prod) == nil, "tap refused: \(String(describing: bad))")
}
// Capture (Athena's mic): only the page on the server the app shows, only the microphone.
check(CompassLink.mayCapture(scheme: "https", host: "compass.knocturnlabs.com", port: 0, microphoneOnly: true, server: prod), "mic on compass")
check(CompassLink.mayCapture(scheme: "http", host: "localhost", port: 5173, microphoneOnly: true, server: dev), "mic on the local server")
check(!CompassLink.mayCapture(scheme: "https", host: "compass.knocturnlabs.com", port: 0, microphoneOnly: false, server: prod), "camera refused")
for (scheme, host, port) in [("https", "evil.com", 0), ("http", "compass.knocturnlabs.com", 0), ("https", "compass.knocturnlabs.com.evil.com", 0),
                             ("https", "compass.knocturnlabs.com", 8443), ("https", "id.knocturnlabs.com", 0), ("https", "", 0), ("file", "", 0),
                             ("http", "localhost", 5173)] {
    check(!CompassLink.mayCapture(scheme: scheme, host: host, port: port, microphoneOnly: true, server: prod), "mic refused: \(scheme)://\(host):\(port)")
}
print("CompassLink: all checks passed")
SWIFT
swiftc -o "$out/check" ios/App/App/CompassLink.swift "$out/main.swift"
"$out/check"

# The Share Extension's text: title, then the page's URL (http(s) only), no repeats.
mkdir "$out/s"; cat > "$out/s/main.swift" <<'SWIFT'
import Foundation
func check(_ ok: Bool, _ what: String) { if !ok { print("FAIL: \(what)"); exit(1) } }
check(ShareText.compose(title: " Pricing ", url: URL(string: "https://ex.com/p"), text: nil) == "Pricing\nhttps://ex.com/p", "title then url")
check(ShareText.compose(title: nil, url: nil, text: "buy milk\n") == "buy milk", "text alone")
check(ShareText.compose(title: "https://ex.com/p", url: URL(string: "https://ex.com/p"), text: nil) == "https://ex.com/p", "no repeat")
check(ShareText.compose(title: "x", url: URL(string: "file:///etc/hosts"), text: nil) == "x", "file url dropped")
check(ShareText.compose(title: " ", url: nil, text: "") == nil, "nothing")
check(ShareText.compose(title: String(repeating: "a", count: 5000), url: nil, text: nil)?.count == ShareText.limit, "capped")
print("ShareText: all checks passed")
SWIFT
swiftc -o "$out/share" ios/App/ShareExtension/ShareText.swift "$out/s/main.swift"
"$out/share"

# The widgets' App Group files and Keychain query (v2.3): atomic protected write, size and shape limits, ticks read and cleared.
mkdir "$out/w"; cat > "$out/w/main.swift" <<'SWIFT'
import Foundation
func check(_ ok: Bool, _ what: String) { if !ok { print("FAIL: \(what)"); exit(1) } }
let fm = FileManager.default
let dir = fm.temporaryDirectory.appendingPathComponent("widgetstore-\(UUID().uuidString)")
try fm.createDirectory(at: dir, withIntermediateDirectories: true)
defer { try? fm.removeItem(at: dir) }
let snap = dir.appendingPathComponent(WidgetStore.snapshotName)
func text() -> String? { try? String(contentsOf: snap, encoding: .utf8) }

// Write: the file holds exactly the text, a second write replaces it whole, nothing else is left in the folder (atomic: no temp file stays).
try WidgetStore.write("{\"v\":1,\"a\":\"first\"}", in: dir)
check(text() == "{\"v\":1,\"a\":\"first\"}", "written")
try WidgetStore.write("{\"v\":1,\"a\":\"second\"}", in: dir)
check(text() == "{\"v\":1,\"a\":\"second\"}", "replaced")
check(try fm.contentsOfDirectory(atPath: dir.path) == [WidgetStore.snapshotName], "no temp file left")
// File protection: readable only after the first unlock since boot, and the option is what the writer asks for.
check(WidgetStore.writeOptions.contains(.atomic) && WidgetStore.writeOptions.contains(.completeFileProtectionUntilFirstUserAuthentication), "write options")
check((try fm.attributesOfItem(atPath: snap.path)[.protectionKey] as? FileProtectionType) == .completeUntilFirstUserAuthentication, "protection attribute on the file")
// Limits: 64 KB exactly is fine, one byte more is refused and the old file stays; not a JSON object is refused too.
let pad = String(repeating: "x", count: WidgetStore.maxBytes - "{\"p\":\"\"}".utf8.count)
try WidgetStore.write("{\"p\":\"\(pad)\"}", in: dir)
check(text()?.utf8.count == WidgetStore.maxBytes, "64 KB accepted")
let before = text()
do { try WidgetStore.write("{\"p\":\"\(pad)x\"}", in: dir); check(false, "over 64 KB accepted") } catch { check(error as? WidgetStore.Failure == .tooBig, "too big") }
for bad in ["not json", "[1,2]", "\"str\"", "{"] {
    do { try WidgetStore.write(bad, in: dir); check(false, "accepted: \(bad)") } catch { check(error as? WidgetStore.Failure == .notJSON, "not json: \(bad)") }
}
check(text() == before, "a refused write leaves the old file")
// Empty text removes it (signed out), and removing twice is fine.
try WidgetStore.write("", in: dir)
check(!fm.fileExists(atPath: snap.path), "removed")
try WidgetStore.write("", in: dir)

// Ticks: none to start; a file is read oldest first, malformed entries skipped, then cleared; a tick written afterwards is a new file.
check(WidgetStore.takeTicks(in: dir).isEmpty, "no ticks")
let ticks = dir.appendingPathComponent(WidgetStore.ticksName)
try Data("[{\"id\":\"t1\",\"at\":\"2026-10-21T10:00:00Z\"},{\"id\":5},{\"at\":\"x\"},{\"id\":\"\",\"at\":\"y\"},{\"id\":\"t2\",\"at\":\"2026-10-21T10:01:00Z\"}]".utf8).write(to: ticks)
let got = WidgetStore.takeTicks(in: dir)
check(got == [["id": "t1", "at": "2026-10-21T10:00:00Z"], ["id": "t2", "at": "2026-10-21T10:01:00Z"]], "ticks read: \(got)")
check(!fm.fileExists(atPath: ticks.path) && WidgetStore.takeTicks(in: dir).isEmpty, "ticks cleared")
check(try fm.contentsOfDirectory(atPath: dir.path).isEmpty, "no .taking file left")
try Data("garbage".utf8).write(to: ticks)
check(WidgetStore.takeTicks(in: dir).isEmpty && !fm.fileExists(atPath: ticks.path), "a corrupt ticks file is dropped")
let many = "[" + (0..<300).map { "{\"id\":\"t\($0)\",\"at\":\"a\"}" }.joined(separator: ",") + "]"
try Data(many.utf8).write(to: ticks)
check(WidgetStore.takeTicks(in: dir).count == WidgetStore.maxTicks, "ticks capped")

// Keychain item: the shared group when given, this device only after the first unlock, and only well-formed tokens are stored.
let q = WidgetStore.tokenQuery(group: "TEAM.com.knocturnlabs.compass.shared")
check(q[kSecAttrAccessGroup as String] as? String == "TEAM.com.knocturnlabs.compass.shared", "access group")
check(q[kSecClass as String] as! CFString == kSecClassGenericPassword && q[kSecAttrAccount as String] as? String == "tick-token", "item identity")
check(WidgetStore.tokenQuery(group: nil)[kSecAttrAccessGroup as String] == nil && WidgetStore.tokenQuery(group: "")[kSecAttrAccessGroup as String] == nil, "no group, no key")
check(WidgetStore.validToken("abcdefghijklmnop_-ABC123") && WidgetStore.validToken(String(repeating: "a", count: 43)), "token ok")
for bad in ["", "short", String(repeating: "a", count: 201), "has space in it 1234567", "quote\"1234567890123456", "naïve-token-1234567890123"] { check(!WidgetStore.validToken(bad), "token refused: \(bad)") }
// A bad token is refused before the Keychain is touched (no entitlement needed to see that).
do { try WidgetStore.setToken("bad token", group: nil); check(false, "bad token stored") } catch { check(error as? WidgetStore.Failure == .badToken, "bad token error") }
print("WidgetStore: all checks passed")
SWIFT
swiftc -o "$out/widgets" ios/App/App/WidgetStore.swift "$out/w/main.swift"
"$out/widgets"
