import Foundation

// Phase 4: where the app may go. Foundation only, so mobile/test-swift.sh checks it with the Swift compiler alone.
// Rules (Global Constraints, native contract): the web view stays on the Compass host; any other web page opens in the system browser,
// mailto: and tel: in their apps, and every other scheme goes nowhere. Sign-in opens only Knocturn ID and comes back only to compass://.
enum CompassLink {
    static let home = "compass.knocturnlabs.com"
    static let signInHost = "id.knocturnlabs.com"
    static let callbackScheme = "compass"

    enum Route: Equatable { case inApp, external, drop }

    /// Same scheme, host and port as the server the app shows (https://compass.knocturnlabs.com, or COMPASS_URL for local tests).
    static func onServer(_ url: URL, _ server: URL) -> Bool {
        url.scheme?.lowercased() == server.scheme?.lowercased() && url.host?.lowercased() == server.host?.lowercased() && url.port == server.port
            && url.user == nil && url.password == nil
    }

    /// A top-level navigation (link, redirect, window.open) to `url` while the app shows `server`.
    static func route(_ url: URL, server: URL) -> Route {
        switch url.scheme?.lowercased() {
        case "http", "https": return onServer(url, server) ? .inApp : .external
        case "mailto", "tel": return .external
        default: return .drop
        }
    }

    /// What openExternal may open: a web page, mailto: or tel:. Anything else is nil.
    static func external(_ raw: String?) -> URL? {
        guard let raw, let url = URL(string: raw), ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url
    }

    /// The page asked for a sign-in sheet: only Knocturn ID's https page, and only back to compass://. Anything else is nil.
    static func signIn(_ raw: String?, callbackScheme scheme: String?) -> URL? {
        guard scheme == callbackScheme, let raw, let url = URL(string: raw), url.scheme == "https", url.host == signInHost,
              url.port == nil, url.user == nil, url.password == nil else { return nil }
        return url
    }

    /// A notification's (or a universal link's) url: a path such as /meetings/1, or a full Compass URL, kept with its ?search#hash.
    /// Only the Compass host (or the server the app shows); nil for anything else.
    static func open(_ raw: Any?, server: URL) -> String? {
        guard let s = raw as? String, !s.isEmpty, let url = URL(string: s, relativeTo: server)?.absoluteURL else { return nil }
        let compass = url.scheme == "https" && url.host?.lowercased() == home && url.port == nil && url.user == nil && url.password == nil
        return compass || onServer(url, server) ? url.absoluteString : nil
    }
}
