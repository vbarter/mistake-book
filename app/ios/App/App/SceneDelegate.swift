import UIKit
import Capacitor

/// iOS 27 SDK 要求采用 UIScene 生命周期；Main.storyboard 由 Info.plist 的场景配置自动加载 CAPBridgeViewController。
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard scene is UIWindowScene else { return }
        if let context = connectionOptions.urlContexts.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    /// 打开 iOS 原生的边缘右滑返回手势：WKWebView 默认关闭，开启后和前端路由的历史记录配合，手势带系统的滑动动画。
    func sceneDidBecomeActive(_ scene: UIScene) {
        guard let bridge = window?.rootViewController as? CAPBridgeViewController, let webView = bridge.webView else { return }
        if !webView.allowsBackForwardNavigationGestures {
            webView.allowsBackForwardNavigationGestures = true
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
