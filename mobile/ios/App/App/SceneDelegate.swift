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

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if let url = userActivity.webpageURL { CompassOpen.shared.request(url.absoluteString) }
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
