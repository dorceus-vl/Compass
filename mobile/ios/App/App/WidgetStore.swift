import Foundation
import Security

/// The widgets' side of the App Group (v2.3): the snapshot file the page writes, the ticks a widget couldn't send, and the tick token's Keychain item.
/// Plain Foundation and Security, so `mobile/test-swift.sh` checks it with the Swift compiler alone. Compiled into both targets: CompassNative.swift is
/// the only caller in the app; the widget extension (CompassWidgets) reads the same files and the same Keychain item, and appends ticks.
enum WidgetStore {
    static let group = "group.com.knocturnlabs.compass"
    static let snapshotName = "widget-snapshot.json"
    static let ticksName = "pending-ticks.json"
    static let maxBytes = 64 * 1024
    static let maxTicks = 200
    /// Info.plist key holding `$(AppIdentifierPrefix)com.knocturnlabs.compass.shared`, the Keychain group the app and the widget share.
    static let keychainGroupKey = "WidgetKeychainGroup"
    static let keychainService = "com.knocturnlabs.compass.widget"
    static let keychainAccount = "tick-token"

    enum Failure: Error, Equatable { case tooBig, notJSON, badToken, keychain(OSStatus) }

    /// One serial queue for every widget file and Keychain call in a process, so a clear (sign-out) can't be overtaken by an earlier write.
    /// The app and the extension are separate processes: between them, atomic writes and `takeTicks`' rename keep each file whole.
    static let queue = DispatchQueue(label: "com.knocturnlabs.compass.widgets", qos: .utility)

    /// Atomic, and readable only after the first unlock since boot (the widgets must still refresh when the phone is locked).
    static let writeOptions: Data.WritingOptions = [.atomic, .completeFileProtectionUntilFirstUserAuthentication]

    static func container() -> URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) }

    /// Writes the snapshot into `dir`; an empty string removes it (signed out). Refuses text over 64 KB or that isn't a JSON object.
    static func write(_ json: String, in dir: URL) throws {
        let file = dir.appendingPathComponent(snapshotName)
        if json.isEmpty { try coordinated(file, .forDeleting) { try? FileManager.default.removeItem(at: $0) }; return }
        let data = Data(json.utf8)
        guard data.count <= maxBytes else { throw Failure.tooBig }
        guard (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { throw Failure.notJSON }
        try coordinated(file, .forReplacing) { try data.write(to: $0, options: writeOptions) }
    }

    /// Runs `body` while holding the file against the other process (the app and the widget extension share the App Group), so a widget's
    /// read-modify-write of the snapshot can't interleave with the app's write or its sign-out removal.
    static func coordinated(_ file: URL, _ options: NSFileCoordinator.WritingOptions = [], _ body: (URL) throws -> Void) throws {
        var outer: NSError?, inner: Error?
        NSFileCoordinator().coordinate(writingItemAt: file, options: options, error: &outer) { url in
            do { try body(url) } catch { inner = error }
        }
        if let e = inner ?? outer { throw e }
    }

    /// A pending entry's action (v2.5): nil is a done tick (files from before timers read the same), "start" or "stop" a timer action.
    static func validAction(_ a: String?) -> Bool { a == nil || a == "start" || a == "stop" }

    /// What a widget queued while offline, oldest first: done ticks (`id`, `at`) and timer actions (also `action`); the file is cleared as it is read.
    /// The file is moved aside first (a rename is atomic), so an entry the widget appends meanwhile starts a new file instead of being lost.
    /// An entry with an unknown action is dropped, never read as a done tick.
    static func takeTicks(in dir: URL) -> [[String: String]] {
        let file = dir.appendingPathComponent(ticksName), taken = dir.appendingPathComponent("\(ticksName).\(UUID().uuidString).taking")
        guard (try? FileManager.default.moveItem(at: file, to: taken)) != nil else { return [] }
        defer { try? FileManager.default.removeItem(at: taken) }
        guard let data = try? Data(contentsOf: taken), let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return list.prefix(maxTicks).compactMap { t in
            guard let id = t["id"] as? String, let at = t["at"] as? String, !id.isEmpty, id.count <= 64, at.count <= 40 else { return nil }
            let action = t["action"] as? String
            guard validAction(action), t["action"] == nil || t["action"] is NSNull || action != nil else { return nil }
            return action.map { ["id": id, "at": at, "action": $0] } ?? ["id": id, "at": at]
        }
    }

    /// An entry from a widget, kept for the app to send (`takeTicks`): a done tick (`action` nil) or a timer action. A tap that repeats the last queued action
    /// for the same task is kept once (start, stop, start stays three entries, in order); past `maxTicks` new ones are dropped, as `takeTicks` would. If the app
    /// takes the file meanwhile, this write starts a new one: an entry may then be sent twice, which is harmless (the app skips tasks already done, timers already running).
    static func appendTick(_ id: String, at: String, action: String? = nil, in dir: URL) throws {
        guard !id.isEmpty, id.count <= 64, at.count <= 40, validAction(action) else { return }
        let file = dir.appendingPathComponent(ticksName)
        var list = (try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] } ?? []
        guard list.count < maxTicks else { return }
        if let last = list.last(where: { $0["id"] as? String == id }), last["action"] as? String == action { return }
        var entry: [String: Any] = ["id": id, "at": at]
        if let action { entry["action"] = action }
        list.append(entry)
        try JSONSerialization.data(withJSONObject: list).write(to: file, options: writeOptions)
    }

    /// Drops what the widget has now delivered (a 200), so the app doesn't send it again. A done tick drops the task's done ticks. A timer action drops its own
    /// entry (same `at`) and every earlier timer action for that task: the server's answer already settles them (a 200 start means none was running; after a 200
    /// stop none is). A file the app already took has nothing to drop.
    static func removeTick(_ id: String, action: String? = nil, at: String? = nil, in dir: URL) throws {
        let file = dir.appendingPathComponent(ticksName)
        guard let data = try? Data(contentsOf: file), let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
        let isTimer = { (t: [String: Any]) in t["id"] as? String == id && (t["action"] as? String).map { $0 == "start" || $0 == "stop" } == true }
        var kept: [[String: Any]]
        if action == nil {
            kept = list.filter { !($0["id"] as? String == id && $0["action"] == nil) }
        } else if let mine = list.lastIndex(where: { isTimer($0) && $0["action"] as? String == action && $0["at"] as? String == at }) {
            kept = list.enumerated().filter { i, t in !(i <= mine && isTimer(t)) }.map(\.element)
        } else { return }
        if kept.count == list.count { return }
        if kept.isEmpty { try? FileManager.default.removeItem(at: file); return }
        try JSONSerialization.data(withJSONObject: kept).write(to: file, options: writeOptions)
    }

    // MARK: Keychain (W6)

    static func tokenQuery(group: String?) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService, kSecAttrAccount as String: keychainAccount]
        if let group, !group.isEmpty { q[kSecAttrAccessGroup as String] = group }
        return q
    }
    static var keychainGroup: String? { Bundle.main.object(forInfoDictionaryKey: keychainGroupKey) as? String }

    /// A token is the text the server gave: letters, digits, `-` and `_`, 16 to 200 characters. Nothing else is stored.
    static func validToken(_ t: String) -> Bool {
        (16...200).contains(t.utf8.count) && t.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || $0 == 45 || $0 == 95 }
    }

    /// The token the app stored (the widget's intent is the reader); nil when there is none or the Keychain won't answer.
    static func readToken(group: String? = keychainGroup) -> String? {
        var q = tokenQuery(group: group)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data, let t = String(data: d, encoding: .utf8), validToken(t) else { return nil }
        return t
    }

    /// Stores (or with nil deletes) the token in the Keychain item the widget extension reads. This device only, after the first unlock.
    static func setToken(_ token: String?, group: String? = keychainGroup) throws {
        if let token, !validToken(token) { throw Failure.badToken } // before anything is deleted: a bad token never wipes a good one
        let q = tokenQuery(group: group)
        let gone = SecItemDelete(q as CFDictionary)
        guard gone == errSecSuccess || gone == errSecItemNotFound else { throw Failure.keychain(gone) }
        guard let token else { return }
        var add = q
        add[kSecValueData as String] = Data(token.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw Failure.keychain(status) }
    }
}
