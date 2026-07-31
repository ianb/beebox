import UIKit

final class CallbackBoxAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Without this the app runs on the implicit `.soloAmbient` default
        // until something records. Earcons, voice memos, and web audio all
        // play under whatever category is installed.
        SystemAudioSession().prepareIdle()
        return true
    }

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        guard identifier == CaptureBackgroundSession.identifier else {
            completionHandler()
            return
        }
        CaptureBackgroundEvents.shared.accept(
            identifier: identifier,
            completionHandler: completionHandler
        )
    }

    func application(
        _ application: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        Task { @MainActor in
            PairingURLInbox.shared.accept(url)
        }
        return true
    }
}
