import UIKit
import WebKit
import Capacitor

// Capacitor's web view with Compass's plugin (registered here because it lives in the app, not in an npm package) and one change:
// window.open follows CompassLink.route too. Capacitor's own handler would hand every window.open URL to the system, Compass's included.
final class CompassViewController: CAPBridgeViewController {
    private let windows = CompassWindows()

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CompassNativePlugin())
        guard let web = webView else { return }
        windows.inner = web.uiDelegate
        windows.server = bridge?.config.serverURL
        web.uiDelegate = windows
    }
}

/// The web view's UI delegate: window.open is decided here; everything else (alerts, confirms, menus) goes on to Capacitor's handler.
final class CompassWindows: NSObject, WKUIDelegate {
    var inner: WKUIDelegate?
    var server: URL?

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url, let server else { return nil }
        switch CompassLink.route(url, server: server) {
        case .inApp: webView.load(action.request)
        case .external: UIApplication.shared.open(url)
        case .drop: break
        }
        return nil
    }

    override func responds(to selector: Selector!) -> Bool { super.responds(to: selector) || inner?.responds(to: selector) == true }
    override func forwardingTarget(for selector: Selector!) -> Any? { inner?.responds(to: selector) == true ? inner : nil }
}

/// The window's root (Health's pattern): the web view starts below the status bar, because Compass's pages pad only the bottom edge for
/// the home bar themselves, on Compass's ground (--bg) with light status bar text.
final class CompassRootViewController: UIViewController {
    private let web = CompassViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 5 / 255, green: 5 / 255, blue: 7 / 255, alpha: 1) // #050507
        addChild(web)
        let page = web.view!
        page.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(page)
        NSLayoutConstraint.activate([
            page.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            page.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            page.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            page.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        web.didMove(toParent: self)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}
