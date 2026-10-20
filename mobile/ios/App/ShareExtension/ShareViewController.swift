import UIKit
import UniformTypeIdentifiers

/// Compass's Share Extension: takes the text or URL shared from another app, leaves it in the app group for Compass
/// (`CompassNative`'s `SharedText.take()` reads it when the app next comes to the front, and opens quick add prefilled),
/// says so, and closes. Nothing is sent anywhere from here.
final class ShareViewController: UIViewController {
    private let label = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 5 / 255, green: 5 / 255, blue: 7 / 255, alpha: 0.92) // #050507, the app's ground
        label.textColor = .white
        label.font = .preferredFont(forTextStyle: .headline)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0
        label.textAlignment = .center
        label.text = "Adding to Compass…"
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor, constant: -16),
        ])
        Task { await self.take() }
    }

    @MainActor private func take() async {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let title = items.lazy.compactMap { ($0.attributedContentText ?? $0.attributedTitle)?.string }.first
        var url: URL?
        var text: String?
        for provider in items.flatMap({ $0.attachments ?? [] }) {
            if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL
            } else if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String
            }
        }
        if let shared = ShareText.compose(title: title, url: url, text: text), let store = UserDefaults(suiteName: ShareText.group) {
            store.set(shared, forKey: ShareText.key) // ponytail: one pending share; a second share before Compass opens replaces the first
            label.text = "Added to Compass quick add — open Compass to finish"
        } else {
            label.text = "Nothing to add: share a page or some text."
        }
        UIAccessibility.post(notification: .announcement, argument: label.text)
        try? await Task.sleep(for: .seconds(1.6))
        extensionContext?.completeRequest(returningItems: nil)
    }
}
