import UIKit
import WebKit
import Capacitor
import AuthenticationServices
import UserNotifications

// Phase 4: what the page can't do itself in the app. web/src/native.ts is the caller; the contract is in its header:
//   signIn({ url, callbackScheme }) → { url }      Knocturn ID in the system sheet (N1); a closed sheet rejects with code 'cancelled'
//   registerPush() → { kind: 'apns', token, env } | { denied: true }
//   takeSharedText() → { text: string | null }    the share the Share Extension left in the app group (N4), cleared as it is read
//   openExternal({ url })                          http(s), mailto:, tel: in the system
//   events sharedText { text }, notificationTap { url }   (kept until the page listens, so a cold start loses neither)
// It also decides every top-level navigation of the web view (CompassLink.route): Compass stays in, other pages go to the browser.
@objc(CompassNativePlugin)
public class CompassNativePlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "CompassNativePlugin"
    public let jsName = "CompassNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "registerPush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeSharedText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),
    ]

    private var session: ASWebAuthenticationSession? // kept alive while the sheet is up

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        DispatchQueue.main.async {
            CompassOpen.shared.plugin = self
            self.becameActive()
        }
    }

    // MARK: sign-in (Health's HealthAuthPlugin pattern)

    @objc func signIn(_ call: CAPPluginCall) {
        guard let url = CompassLink.signIn(call.getString("url"), callbackScheme: call.getString("callbackScheme")) else {
            return call.reject("Sign-in couldn’t start.", "invalid_request")
        }
        DispatchQueue.main.async {
            let auth = ASWebAuthenticationSession(url: url, callbackURLScheme: CompassLink.callbackScheme) { [weak self] callback, error in
                self?.session = nil
                if let callback, callback.scheme == CompassLink.callbackScheme, callback.host == "auth" {
                    call.resolve(["url": callback.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.reject("Sign-in was cancelled.", "cancelled")
                } else {
                    call.reject("Sign-in didn’t finish. Try again.", "failed")
                }
            }
            auth.presentationContextProvider = self
            auth.prefersEphemeralWebBrowserSession = false // stays signed in to Knocturn ID between sign-ins
            self.session = auth
            if !auth.start() {
                self.session = nil
                call.reject("Sign-in couldn’t start.", "failed")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    // MARK: push (Aura's AuraPush pattern)

    @objc func registerPush(_ call: CAPPluginCall) {
        Task {
            do {
                call.resolve(["kind": "apns", "token": try await CompassPush.shared.register(), "env": CompassPush.environment])
            } catch is PushRefused {
                call.resolve(["denied": true])
            } catch {
                call.reject("Apple’s push service didn’t answer. Try again in a moment.", "failed")
            }
        }
    }

    // MARK: shared text (written by the Share Extension, Task 4)

    @objc func takeSharedText(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["text": SharedText.take() ?? NSNull()]) }
    }

    /// Coming to the front: a share waiting in the app group goes to the page now, and is cleared as it goes (never delivered twice).
    @objc private func becameActive() {
        guard let text = SharedText.take() else { return }
        notifyListeners("sharedText", data: ["text": text], retainUntilConsumed: true)
    }

    /// A notification tap or a universal link: the page opens it in place (only Compass URLs reach here).
    func deliverOpen(_ raw: String) {
        guard let server = bridge?.config.serverURL, let url = CompassLink.open(raw, server: server) else { return }
        notifyListeners("notificationTap", data: ["url": url], retainUntilConsumed: true)
    }

    // MARK: links

    @objc func openExternal(_ call: CAPPluginCall) {
        guard let url = CompassLink.external(call.getString("url")) else { return call.reject("That link can’t be opened.", "invalid_request") }
        DispatchQueue.main.async { UIApplication.shared.open(url) }
        call.resolve()
    }

    /// Every navigation of the web view comes here first (Capacitor's WebViewDelegationHandler). nil leaves it to Capacitor.
    override public func shouldOverrideLoad(_ action: WKNavigationAction) -> NSNumber? {
        guard let bridge, let url = action.request.url else { return nil }
        let newWindow = action.targetFrame == nil
        if !newWindow && action.targetFrame?.isMainFrame == false { return nil } // frames: the page's CSP governs them
        let local = bridge.config.localURL
        if url.scheme == local.scheme && url.host == local.host {
            // The bundled offline page; its "Try again" (or anything else local) goes back to the site.
            if url.path == "/" + (bridge.config.errorPath ?? "") { return nil }
            let server = bridge.config.serverURL
            DispatchQueue.main.async { bridge.webView?.load(URLRequest(url: server)) }
            return true
        }
        if url.scheme == "about" { return nil }
        switch CompassLink.route(url, server: bridge.config.serverURL) {
        case .inApp:
            if !newWindow { return false }
            let request = action.request
            DispatchQueue.main.async { bridge.webView?.load(request) } // a Compass link meant for a new tab opens in place
        case .external: DispatchQueue.main.async { UIApplication.shared.open(url) }
        case .drop: break
        }
        return true
    }
}

/// Notification taps and universal links that arrive before the page (a cold start) wait here for the plugin.
final class CompassOpen {
    static let shared = CompassOpen()
    weak var plugin: CompassNativePlugin? { didSet { flush() } }
    private var pending: [String] = []

    func request(_ raw: String) { // main thread
        pending.append(raw)
        flush()
    }
    private func flush() {
        guard let plugin else { return }
        let all = pending
        pending = []
        all.forEach(plugin.deliverOpen)
    }
}

/// The text the Share Extension (Task 4) leaves for the app: app group `group.com.knocturnlabs.compass`, key `sharedText`. Main thread.
enum SharedText {
    static let group = "group.com.knocturnlabs.compass"
    static let key = "sharedText"
    static func take() -> String? {
        guard let store = UserDefaults(suiteName: group), let text = store.string(forKey: key) else { return nil }
        store.removeObject(forKey: key)
        return text.isEmpty ? nil : text
    }
}

struct PushRefused: Error {}
struct PushTimedOut: Error {}

/// APNs for the app: the token (hex) and which APNs it belongs to, and notification taps.
final class CompassPush: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable { // `waiting` is touched on the main thread only
    static let shared = CompassPush()
    /// A debug build's token is the sandbox's; a TestFlight or App Store build's is production's.
    #if DEBUG
    static let environment = "development"
    #else
    static let environment = "production"
    #endif
    private var waiting: [UUID: (Result<String, Error>) -> Void] = [:]

    static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

    // From AppDelegate (main thread).
    func registered(_ token: Data) { finish(.success(Self.hex(token))) }
    func failed(_ error: Error) { finish(.failure(error)) }
    private func finish(_ result: Result<String, Error>) {
        let all = waiting.values
        waiting = [:]
        all.forEach { $0(result) }
    }

    /// Asks (iOS shows its question the first time only), then gets a token from APNs.
    func register() async throws -> String {
        guard try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) else { throw PushRefused() }
        return try await withCheckedThrowingContinuation { (done: CheckedContinuation<String, Error>) in
            DispatchQueue.main.async {
                let id = UUID()
                self.waiting[id] = { done.resume(with: $0) }
                UIApplication.shared.registerForRemoteNotifications()
                // No network, or no APNs (an unsigned simulator build): don't leave the page waiting. Only this call's wait ends.
                DispatchQueue.main.asyncAfter(deadline: .now() + 20) { self.waiting.removeValue(forKey: id)?(.failure(PushTimedOut())) }
            }
        }
    }

    // In the app: show it anyway (the page may be on another screen).
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let url = response.notification.request.content.userInfo["url"] as? String else { return }
        await MainActor.run { CompassOpen.shared.request(url) }
    }
}
