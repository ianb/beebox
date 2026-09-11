import UIKit

final class BeeBoxAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // CBGitCommit is stamped into the built Info.plist by the "Stamp git
        // commit" build phase; logging it here makes the installed build's
        // exact source state greppable in client-debug.log — a stale build is
        // otherwise indistinguishable from a failed fix.
        let commit = Bundle.main.object(forInfoDictionaryKey: "CBGitCommit") as? String ?? "unstamped"
        BoxLog.info("launch build=\(commit)", category: .lifecycle)
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
        guard
            identifier == CaptureBackgroundSession.identifier || identifier == VoiceStagingBackgroundSession.identifier
        else {
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
