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
print("CompassLink: all checks passed")
SWIFT
swiftc -o "$out/check" ios/App/App/CompassLink.swift "$out/main.swift"
"$out/check"
