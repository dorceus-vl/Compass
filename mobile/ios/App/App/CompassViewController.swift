import UIKit
import WebKit
import Capacitor

// Capacitor's web view with Compass's plugin (registered here because it lives in the app, not in an npm package) and two changes:
// window.open follows CompassLink.route too (Capacitor's own handler would hand every window.open URL to the system, Compass's
// included), and downloads work (Capacitor has none): see CompassDownloads.
final class CompassViewController: CAPBridgeViewController {
    private let windows = CompassWindows()
    private let downloads = CompassDownloads()

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CompassNativePlugin())
        guard let web = webView else { return }
        windows.inner = web.uiDelegate
        windows.server = bridge?.config.serverURL
        web.uiDelegate = windows
        downloads.inner = web.navigationDelegate
        downloads.server = bridge?.config.serverURL
        downloads.presenter = self
        web.navigationDelegate = downloads
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

/// The web view's navigation delegate: Compass's own downloads (`<a download>` of a blob the page made, a document from /api, an
/// attachment answer) become WKDownloads saved to a fresh temp folder and offered in the share sheet (Save to Files, AirDrop, Mail);
/// the folder goes when the sheet closes. Other hosts never download here. Everything else goes on to Capacitor's handler.
final class CompassDownloads: NSObject, WKNavigationDelegate, WKDownloadDelegate {
    var inner: WKNavigationDelegate?
    var server: URL?
    weak var presenter: UIViewController?
    private var folders: [ObjectIdentifier: URL] = [:]

    /// A blob the Compass page made (blob:https://compass.knocturnlabs.com/…) or a URL on the server.
    private func ours(_ url: URL?) -> Bool {
        guard let url, let server else { return false }
        if url.scheme == "blob", let inside = URL(string: String(url.absoluteString.dropFirst("blob:".count))) { return CompassLink.onServer(inside, server) }
        return CompassLink.onServer(url, server)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload && ours(action.request.url) { return decisionHandler(.download) }
        if inner?.webView?(webView, decidePolicyFor: action, decisionHandler: decisionHandler) == nil { decisionHandler(.allow) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let attachment = ((response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? "").lowercased().hasPrefix("attachment")
        let download = response.isForMainFrame && ours(response.response.url) && (attachment || !response.canShowMIMEType)
        decisionHandler(download ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("downloads", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
        do { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) } catch { return completionHandler(nil) }
        folders[ObjectIdentifier(download)] = folder
        let name = (suggestedFilename as NSString).lastPathComponent
        completionHandler(folder.appendingPathComponent(name.isEmpty || name == "." || name == ".." ? "download" : name))
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let folder = folders.removeValue(forKey: ObjectIdentifier(download)),
              let file = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).first,
              let from = presenter, let view = from.view else { return }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: folder) }
        if let pop = sheet.popoverPresentationController { // iPad: a popover needs an anchor
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        (from.presentedViewController ?? from).present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let folder = folders.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: folder) }
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
