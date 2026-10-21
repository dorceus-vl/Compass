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

    /// The ticks a widget queued while offline, oldest first; the file is cleared as it is read. The file is moved aside first (a rename is atomic),
    /// so a tick the widget appends meanwhile starts a new file instead of being lost.
    static func takeTicks(in dir: URL) -> [[String: String]] {
        let file = dir.appendingPathComponent(ticksName), taken = dir.appendingPathComponent("\(ticksName).\(UUID().uuidString).taking")
        guard (try? FileManager.default.moveItem(at: file, to: taken)) != nil else { return [] }
        defer { try? FileManager.default.removeItem(at: taken) }
        guard let data = try? Data(contentsOf: taken), let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return list.prefix(maxTicks).compactMap { t in
            guard let id = t["id"] as? String, let at = t["at"] as? String, !id.isEmpty, id.count <= 64, at.count <= 40 else { return nil }
            return ["id": id, "at": at]
        }
    }

    /// A tick from a widget, kept for the app to send (`takeTicks`). The same task twice is kept once; past `maxTicks` new ones are dropped,
    /// as `takeTicks` would. If the app takes the file meanwhile, this write starts a new one: a tick may then be sent twice, which is harmless
    /// (the app skips tasks already done).
    static func appendTick(_ id: String, at: String, in dir: URL) throws {
        guard !id.isEmpty, id.count <= 64, at.count <= 40 else { return }
        let file = dir.appendingPathComponent(ticksName)
        var list = (try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] } ?? []
        guard list.count < maxTicks, !list.contains(where: { $0["id"] as? String == id }) else { return }
        list.append(["id": id, "at": at])
        try JSONSerialization.data(withJSONObject: list).write(to: file, options: writeOptions)
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
