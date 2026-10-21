import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CompassRootViewController()
        window?.makeKeyAndVisible()

        // A cold start from a universal link (applinks:compass.knocturnlabs.com): the page opens it once it listens.
        connectionOptions.userActivities.compactMap(\.webpageURL).forEach { CompassOpen.shared.request($0.absoluteString) }
        // A cold start from a widget tap (v2.3, W4): widgets hand their https link over as a URL context, not a user activity.
        Self.widgetLinks(connectionOptions.urlContexts).forEach { CompassOpen.shared.request($0) }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        Self.widgetLinks(URLContexts).forEach { CompassOpen.shared.request($0) }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if let url = userActivity.webpageURL { CompassOpen.shared.request(url.absoluteString) }
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    /// https links only (compass:// stays with the sign-in callback); `deliverOpen` keeps those on the Compass host (CompassLink.open).
    private static func widgetLinks(_ contexts: Set<UIOpenURLContext>) -> [String] {
        contexts.map(\.url).filter { $0.scheme == "https" }.map(\.absoluteString)
    }
}
