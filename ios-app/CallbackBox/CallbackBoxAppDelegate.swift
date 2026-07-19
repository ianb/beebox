import UIKit

final class CallbackBoxAppDelegate: NSObject, UIApplicationDelegate {
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
