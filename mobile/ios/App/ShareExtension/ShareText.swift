import Foundation

/// What a share leaves for the app (app group `group.com.knocturnlabs.compass`, key `sharedText`): the page title, then its URL,
/// one per line, the way the web side's `sharedToQuickAdd` reads it (first line the title, a URL the notes). Android sends the same.
enum ShareText {
    static let group = "group.com.knocturnlabs.compass"
    static let key = "sharedText"
    static let limit = 4000

    static func compose(title: String?, url: URL?, text: String?) -> String? {
        let link = url.flatMap { ["http", "https"].contains($0.scheme?.lowercased() ?? "") ? $0.absoluteString : nil }
        var lines: [String] = []
        for part in [title, text, link] {
            guard let p = part?.trimmingCharacters(in: .whitespacesAndNewlines), !p.isEmpty, !lines.contains(p) else { continue }
            lines.append(p)
        }
        let all = lines.joined(separator: "\n")
        return all.isEmpty ? nil : String(all.prefix(limit))
    }
}
