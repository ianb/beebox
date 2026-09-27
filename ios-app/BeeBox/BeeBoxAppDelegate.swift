import UIKit
import UserNotifications

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
        // The delegate must be set before launch finishes, or a tap that
        // cold-launched the app is not delivered (contract §5.10).
        UNUserNotificationCenter.current().delegate = NotificationCenterDelegate.shared
        // Every launch: tokens change on reinstall and restore with no signal
        // (contract §5.9). Registration needs no permission; showing does.
        application.registerForRemoteNotifications()
        #if DEBUG
        // The simulator gets no APNs token. `-BBXFakePushToken <hex>` feeds one
        // so the registration post can be exercised end to end.
        if let fake = UserDefaults.standard.string(forKey: "BBXFakePushToken"), fake.isEmpty == false {
            Task { @MainActor in
                await PushRegistrar.shared.tokenDidChange(fake.lowercased())
            }
        }
        #endif
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        #if DEBUG
        // A fake token under test wins over whatever the simulator reports.
        if UserDefaults.standard.string(forKey: "BBXFakePushToken")?.isEmpty == false {
            return
        }
        #endif
        let hex = PushToken.hex(deviceToken)
        Task { @MainActor in
            await PushRegistrar.shared.tokenDidChange(hex)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        let nsError = error as NSError
        BoxLog.warn(
            "apns registration failed domain=\(nsError.domain) code=\(nsError.code): \(nsError.localizedDescription)",
            category: .push
        )
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
