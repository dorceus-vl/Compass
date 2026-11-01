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
// v2.5 pending timer actions: the action rides along, none is a done tick, an unknown one (or a non-string) is dropped; a repeat of the last action for a task is
// kept once, start/stop/start stays three; a 200 drops its own entry and the earlier timer actions of that task, never a done tick or another task's.
try Data("[{\"id\":\"a\",\"at\":\"1\",\"action\":\"start\"},{\"id\":\"b\",\"at\":\"2\"},{\"id\":\"c\",\"at\":\"3\",\"action\":\"stop\"},{\"id\":\"d\",\"at\":\"4\",\"action\":\"done\"},{\"id\":\"e\",\"at\":\"5\",\"action\":7}]".utf8).write(to: ticks)
check(WidgetStore.takeTicks(in: dir) == [["id": "a", "at": "1", "action": "start"], ["id": "b", "at": "2"], ["id": "c", "at": "3", "action": "stop"]], "actions pass through, unknown dropped")
try WidgetStore.appendTick("t", at: "1", action: "start", in: dir)
try WidgetStore.appendTick("t", at: "2", action: "start", in: dir)
try WidgetStore.appendTick("t", at: "3", action: "stop", in: dir)
try WidgetStore.appendTick("t", at: "4", action: "start", in: dir)
try WidgetStore.appendTick("t", at: "5", in: dir)
try WidgetStore.appendTick("t", at: "6", in: dir)
try WidgetStore.appendTick("t", at: "7", action: "bogus", in: dir)
try WidgetStore.appendTick("u", at: "8", action: "start", in: dir)
let pending = try JSONSerialization.jsonObject(with: Data(contentsOf: ticks)) as! [[String: String]]
check(pending == [["id": "t", "at": "1", "action": "start"], ["id": "t", "at": "3", "action": "stop"], ["id": "t", "at": "4", "action": "start"], ["id": "t", "at": "5"], ["id": "u", "at": "8", "action": "start"]], "pending file shape: \(pending)")
try WidgetStore.removeTick("t", action: "stop", at: "nope", in: dir)
check((try JSONSerialization.jsonObject(with: Data(contentsOf: ticks)) as! [Any]).count == 5, "no exact match: nothing dropped")
try WidgetStore.removeTick("t", action: "stop", at: "3", in: dir)
check(WidgetStore.takeTicks(in: dir) == [["id": "t", "at": "4", "action": "start"], ["id": "t", "at": "5"], ["id": "u", "at": "8", "action": "start"]], "a settled stop drops itself and the earlier start")
try WidgetStore.appendTick("t", at: "1", action: "start", in: dir)
try WidgetStore.appendTick("t", at: "2", in: dir)
try WidgetStore.removeTick("t", in: dir)
check(WidgetStore.takeTicks(in: dir) == [["id": "t", "at": "1", "action": "start"]], "a settled done tick leaves timer actions")
print("WidgetStore: all checks passed")
SWIFT
swiftc -o "$out/widgets" ios/App/App/WidgetStore.swift "$out/w/main.swift"
"$out/widgets"

# The widget extension's snapshot (v2.3, W1 and the optimistic tick): the fixture decodes, a tick moves the right counts and is queued once,
# titles follow the Offline and Lock Screen rules, taps stay on the Compass host, and a bad file is the placeholder.
mkdir "$out/x"; cat > "$out/x/main.swift" <<'SWIFT'
import Foundation
func check(_ ok: Bool, _ what: String) { if !ok { print("FAIL: \(what)"); exit(1) } }
let fm = FileManager.default
let fixture = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
guard let s = Snapshot.decode(fixture) else { print("FAIL: fixture decodes"); exit(1) }
check(s.today.due == 3 && s.today.late == 1 && s.today.done == 1 && s.today.total == 4 && s.today.next?.id == "t-vendor", "today")
check(s.items.count == 6 && s.projects.count == 4 && s.week.count == 7 && s.blocked == 1 && s.lock.hideWork, "lists")
check(Snapshot.decode(Data(s.encoded()!.utf8)) == s, "round trip")
check(Snapshot.decode(Data("{\"v\":2}".utf8)) == nil && Snapshot.decode(Data("garbage".utf8)) == nil, "bad file is the placeholder")
check(Snapshot.decode(Data(s.encoded()!.replacingOccurrences(of: "\"v\":1", with: "\"v\":2").utf8)) == nil, "another version is the placeholder")

// Titles: Offline never named, work hidden only on the Lock Screen while hide_work is on.
let secret = s.items.first { $0.id == "t-secret" }!, vendor = s.items.first { $0.id == "t-vendor" }!, dentist = s.items.first { $0.id == "t-dentist" }!
check(secret.shown(lock: false, hideWork: false) == "Offline-only task" && secret.shown(lock: true, hideWork: true) == "Offline-only task", "offline never named")
check(vendor.shown(lock: false, hideWork: true) == "Call the vendor about the test env", "home screen shows work")
check(vendor.shown(lock: true, hideWork: true) == "Work task" && vendor.shown(lock: true, hideWork: false) == "Call the vendor about the test env", "lock rule")
check(dentist.shown(lock: true, hideWork: true) == "Book the dentist", "personal shown on lock")
check(s.projects.first { $0.id == "p-secret" }!.shownName == "Offline-only project", "offline project unnamed")
check(s.footerMilestone?.milestone.name == "Pilot site live", "footer milestone")
// Locked device: work words are marked for redaction while hide_work is on, personal ones never.
check(s.hides(vendor) && !s.hides(dentist) && s.hides(s.projects.first { $0.id == "p-branch" }!) && !s.hides(s.projects.first { $0.id == "p-home" }!), "redaction marks")
let shownOff = Snapshot.decode(Data(s.encoded()!.replacingOccurrences(of: "\"hide_work\":true", with: "\"hide_work\":false").utf8))!
check(!shownOff.hides(vendor), "hide_work off: nothing redacted")
// The iPad's day cells: listed tasks found by their labels; a far date names no day.
check(s.items(on: "2026-10-21").map(\.id) == ["t-vendor", "t-secret"] && s.items(on: "2026-10-23").map(\.id) == ["t-sow"], "items on a day")
check(s.items(on: "2026-10-20").map(\.id) == ["t-status"] && s.items(on: "2026-10-25").isEmpty, "yesterday and empty day")

// Ticking a late task: due, late, overdue and its day move; done grows; total stays.
let a = s.markingDone("t-status")
check(a.today.due == 2 && a.today.late == 0 && a.today.done == 2 && a.today.total == 4, "late tick counts")
check(!a.items.contains { $0.id == "t-status" } && !a.horizons.medium.contains { $0.id == "t-status" }, "late tick leaves the lists")
check(a.projects.first { $0.id == "p-branch" }!.overdue == 0 && a.week.first { $0.day == "2026-10-20" }!.medium == 0, "overdue and yesterday")
// Ticking the next task: the next due today takes its place; a weekday task moves its day; an unknown id changes nothing.
let b = s.markingDone("t-vendor")
check(b.today.next?.id == "t-secret" && b.today.due == 2 && b.today.late == 1 && b.week.first { $0.day == "2026-10-21" }!.short == 1, "next tick")
check(s.markingDone("t-sow").week.first { $0.day == "2026-10-23" }!.short == 0 && s.markingDone("t-sow").today == s.today, "Fri tick")
check(s.markingDone("nope") == s, "unknown id")
check(Snapshot.dayOffset("3d late", today: "2026-10-21") == -3 && Snapshot.dayOffset("Mon", today: "2026-10-21") == 5 && Snapshot.dayOffset("Oct 30", today: "2026-10-21") == nil, "day offsets")
check(Snapshot.addDays("2026-10-31", 1) == "2026-11-01" && Snapshot.weekday("2026-10-21") == "Wed", "dates")
check(s.isStale(Snapshot.date("2026-10-22T05:00:00Z")!) && !s.isStale(Snapshot.date("2026-10-22T03:59:00Z")!), "stale at Toronto midnight")

// The tick on disk: the snapshot is rewritten (protected), the tick is queued once, and takeTicks hands it to the app.
let dir = fm.temporaryDirectory.appendingPathComponent("widgettick-\(UUID().uuidString)")
try fm.createDirectory(at: dir, withIntermediateDirectories: true)
defer { try? fm.removeItem(at: dir) }
try fixture.write(to: dir.appendingPathComponent(WidgetStore.snapshotName))
WidgetStore.tick("t-status", at: Snapshot.date("2026-10-21T15:05:00.000Z")!, in: dir)
WidgetStore.tick("t-status", in: dir)
check(Snapshot.load(from: dir) == a, "file rewritten")
check((try fm.attributesOfItem(atPath: dir.appendingPathComponent(WidgetStore.snapshotName).path)[.protectionKey] as? FileProtectionType) == .completeUntilFirstUserAuthentication, "rewritten file protected")
check(WidgetStore.takeTicks(in: dir) == [["id": "t-status", "at": "2026-10-21T15:05:00.000Z"]], "tick queued once")
try fm.removeItem(at: dir.appendingPathComponent(WidgetStore.snapshotName))
WidgetStore.tick("t-x", in: dir)
check(Snapshot.load(from: dir) == nil && WidgetStore.takeTicks(in: dir).first?["id"] == "t-x", "no snapshot: the tick is still queued")

// Tick delivery (Task 2): a delivered tick leaves the queue (others stay, an empty queue is no file); an unknown id or no file changes nothing.
try WidgetStore.appendTick("t-a", at: "2026-10-21T15:00:00.000Z", in: dir)
try WidgetStore.appendTick("t-b", at: "2026-10-21T15:01:00.000Z", in: dir)
try WidgetStore.removeTick("t-nope", in: dir)
try WidgetStore.removeTick("t-a", in: dir)
check(WidgetStore.takeTicks(in: dir) == [["id": "t-b", "at": "2026-10-21T15:01:00.000Z"]], "removeTick keeps the others")
try WidgetStore.appendTick("t-c", at: "2026-10-21T15:02:00.000Z", in: dir)
try WidgetStore.removeTick("t-c", in: dir)
check(!fm.fileExists(atPath: dir.appendingPathComponent(WidgetStore.ticksName).path), "an empty queue is no file")
try WidgetStore.removeTick("t-c", in: dir)

// The tick's address: Compass over https, or (Debug builds only) http on this Mac; the bearer token never goes anywhere else.
let prod = URL(string: "https://compass.knocturnlabs.com")!, local = URL(string: "http://localhost:8790")!
check(WidgetServer.doneURL("t-1", server: prod)?.absoluteString == "https://compass.knocturnlabs.com/api/widget/tasks/t-1/done", "done url")
check(WidgetServer.doneURL("t-1", server: URL(string: "https://compass.knocturnlabs.com/")!)?.absoluteString == "https://compass.knocturnlabs.com/api/widget/tasks/t-1/done", "done url, trailing slash")
check(WidgetServer.doneURL("a/../b?c#d", server: prod)?.absoluteString == "https://compass.knocturnlabs.com/api/widget/tasks/a%2F%2E%2E%2Fb%3Fc%23d/done", "id encoded")
check(WidgetServer.doneURL("t-1", server: local, allowLocal: true)?.absoluteString == "http://localhost:8790/api/widget/tasks/t-1/done", "local server in a debug build")
check(WidgetServer.doneURL("t-1", server: local) == nil, "local server refused in a release build")
check(WidgetServer.doneURL("t-1", server: URL(string: "http://127.0.0.1:8790")!, allowLocal: true) != nil, "127.0.0.1 in a debug build")
for bad in ["https://example.com", "http://compass.knocturnlabs.com", "https://compass.knocturnlabs.com:8443", "https://compass.knocturnlabs.com.evil.com",
            "https://compass.knocturnlabs.com@evil.com", "https://me@compass.knocturnlabs.com", "https://id.knocturnlabs.com", "https://compass.knocturnlabs.com/x",
            "https://compass.knocturnlabs.com?x=1", "ftp://compass.knocturnlabs.com", "https://localhost:8790", "http://localhost.evil.com", "http://evil.com:8790", "file:///x"] {
    check(WidgetServer.doneURL("t-1", server: URL(string: bad)!, allowLocal: true) == nil, "server refused: \(bad)")
}
check(WidgetServer.doneURL("", server: prod) == nil && WidgetServer.doneURL(String(repeating: "a", count: 65), server: prod) == nil, "bad ids refused")
check(WidgetServer.configured(nil) == WidgetServer.production && WidgetServer.configured("") == WidgetServer.production && WidgetServer.configured("https://evil.com") == WidgetServer.production, "configured falls back to production")
let req = WidgetServer.request(prod.appendingPathComponent("x"), token: "tok")
check(req.httpMethod == "POST" && req.value(forHTTPHeaderField: "Authorization") == "Bearer tok" && req.timeoutInterval == 8 && req.httpBody == nil && !req.httpShouldHandleCookies, "request shape")
check(WidgetServer.settles(200), "200 settles the tick")
for st: Int? in [nil, 401, 403, 404, 429, 500, 503, 201, 302] { check(!WidgetServer.settles(st), "stays queued: \(String(describing: st))") }

// Taps: the Compass host only, ids encoded.
check(CompassURL.task("t-1").absoluteString == "https://compass.knocturnlabs.com/?task=t-1", "task link")
check(CompassURL.task("a&b=c#d").host == "compass.knocturnlabs.com" && URLComponents(url: CompassURL.task("a&b=c#d"), resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "a&b=c#d", "task id encoded")
check(CompassURL.dashboard("p-1").absoluteString == "https://compass.knocturnlabs.com/projects/p-1/dashboard", "dashboard link")
check(CompassURL.dashboard("../x?y").absoluteString == "https://compass.knocturnlabs.com/projects/%2E%2E%2Fx%3Fy/dashboard", "dashboard id encoded")
for u in [CompassURL.today, CompassURL.quickAdd, CompassURL.athena] { check(u.scheme == "https" && u.host == "compass.knocturnlabs.com", "host: \(u)") }
// v2.5 timers: decoded from the fixture with fail-closed titles; Start and Stop change the file at once; older files without timers still decode.
check(s.running.map(\.id) == ["e-vendor", "e-secret", "e-home"] && s.running[1].title == nil && s.running[2].taskId == nil && s.running[0].work, "timers decoded")
check(s.items.first { $0.id == "t-vendor" }!.running && !s.items.first { $0.id == "t-status" }!.running, "timer_running decoded")
check(s.running[1].shown(lock: false, hideWork: true) == "Running timer" && s.running[0].shown(lock: true, hideWork: true) == "Work task" && s.running[0].shown(lock: false, hideWork: true) == "Call the vendor about the test env", "timer titles")
check(s.hides(s.running[0]) && !s.hides(s.running[2]), "timer redaction marks")
let old = s.encoded()!.replacingOccurrences(of: "\"timer_running\":true,", with: "").replacingOccurrences(of: "\"timer_running\":false,", with: "").replacingOccurrences(of: "\"timer_running\":true", with: "").replacingOccurrences(of: "\"timer_running\":false", with: "")
let oldData = try JSONSerialization.data(withJSONObject: { var o = try! JSONSerialization.jsonObject(with: Data(old.utf8)) as! [String: Any]; o.removeValue(forKey: "timers"); return o }())
let older = Snapshot.decode(oldData)
check(older != nil && older!.running.isEmpty && older!.items.allSatisfy { !$0.running }, "a v2.3 file still decodes")
let started = s.timing("t-status", "start", at: Snapshot.date("2026-10-21T15:10:00.000Z")!)
check(started.running.first?.taskId == "t-status" && started.running.first?.startedAt == "2026-10-21T15:10:00.000Z" && started.running.first?.title == "Send the status report", "start adds a timer first")
check(started.items.first { $0.id == "t-status" }!.running && started.horizons.medium.first { $0.id == "t-status" }!.running, "start marks the rows")
check(s.timing("t-vendor", "start") == s && s.timing("nope", "start") == s && s.timing("t-vendor", "bogus") == s, "start on a running or unknown task, or a bad action: unchanged")
check(s.timing("t-secret", "start") == s, "already running (offline task)")
let stopped = s.timing("t-vendor", "stop")
check(!stopped.running.contains { $0.taskId == "t-vendor" } && stopped.running.count == 2 && !stopped.items.first { $0.id == "t-vendor" }!.running && stopped.today.next?.running == false, "stop removes it")
check(["t-status", "t-dentist", "t-sow", "t-cab"].reduce(stopped) { $0.timing($1, "start") }.running.count == 5, "at most 5 timers")
try fixture.write(to: dir.appendingPathComponent(WidgetStore.snapshotName))
WidgetStore.timer("t-status", action: "start", at: Snapshot.date("2026-10-21T15:10:00.000Z")!, in: dir)
check(Snapshot.load(from: dir) == started, "timer rewrites the file")
check(WidgetStore.takeTicks(in: dir) == [["id": "t-status", "at": "2026-10-21T15:10:00.000Z", "action": "start"]], "timer action queued")
// Its address and body: the same host rule as a tick, a JSON body, still no cookies.
check(WidgetServer.timerURL("t-1", server: prod)?.absoluteString == "https://compass.knocturnlabs.com/api/widget/tasks/t-1/timer", "timer url")
check(WidgetServer.timerURL("a/../b", server: prod)?.absoluteString == "https://compass.knocturnlabs.com/api/widget/tasks/a%2F%2E%2E%2Fb/timer", "timer id encoded")
check(WidgetServer.timerURL("t-1", server: local, allowLocal: true)?.absoluteString == "http://localhost:8790/api/widget/tasks/t-1/timer" && WidgetServer.timerURL("t-1", server: local) == nil, "timer local only in debug")
for bad in ["https://example.com", "http://compass.knocturnlabs.com", "https://compass.knocturnlabs.com.evil.com", "https://compass.knocturnlabs.com:8443"] {
    check(WidgetServer.timerURL("t-1", server: URL(string: bad)!, allowLocal: true) == nil, "timer server refused: \(bad)")
}
check(WidgetServer.timerBody("start", at: "x").flatMap { String(data: $0, encoding: .utf8) } == "{\"action\":\"start\",\"at\":\"x\"}" && WidgetServer.timerBody("done", at: "x") == nil, "timer body")
let treq = WidgetServer.request(prod, token: "tok", body: WidgetServer.timerBody("stop", at: "x"))
check(treq.httpBody != nil && treq.value(forHTTPHeaderField: "Content-Type") == "application/json" && !treq.httpShouldHandleCookies && treq.value(forHTTPHeaderField: "Authorization") == "Bearer tok", "timer request shape")
// Siri's "what's due today": the snapshot's day only, Lock Screen titles, at most three named.
let at = Snapshot.date(s.at)!
check(s.spokenDueToday(now: at) == "3 due today, 1 late: Work task, Work task, Offline-only task.", "siri due today")
check(s.spokenDueToday(now: at.addingTimeInterval(86_400)) == "Open Compass to update today's list.", "siri stale snapshot")
var none = s; none.today.due = 0; none.today.late = 0
check(none.spokenDueToday(now: at) == "Nothing left due today. 1 done.", "siri nothing due")
print("Widget snapshot: all checks passed")
SWIFT
swiftc -o "$out/snap" ios/App/App/WidgetStore.swift ios/App/CompassWidgets/Snapshot.swift "$out/x/main.swift"
"$out/snap" ../scripts/fixtures/widget-snapshot.sample.json
