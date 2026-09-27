import Combine
import Foundation
import UserNotifications

/// Foreground presentation and taps for box notifications (contract §5.10).
///
/// While the app is open, `loud` shows the system banner with sound; `quiet`
/// and `dot` show nothing, because the webview shows its own in-app banner. A
/// tap hands the payload's target to `NotificationTapInbox`, which `RootView`
/// turns into a navigation of the chat webview.
final class NotificationCenterDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationCenterDelegate()

    static func presentationOptions(for loudness: NotificationLoudness) -> UNNotificationPresentationOptions {
        switch loudness {
        case .loud:
            [.banner, .sound, .badge]
        case .quiet, .dot:
            []
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let loudness = NotificationLoudness(userInfo: notification.request.content.userInfo)
        completionHandler(Self.presentationOptions(for: loudness))
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let tap = NotificationTap(userInfo: response.notification.request.content.userInfo)
        Task { @MainActor in
            NotificationTapInbox.shared.accept(tap)
        }
        completionHandler()
    }

    /// On foreground: clear the badge (the box keeps no unread count, so every
    /// payload sets it to 1) and drop delivered `dot` notifications, which exist
    /// only to set that badge.
    static func clearOnForeground() {
        let center = UNUserNotificationCenter.current()
        center.setBadgeCount(0) { error in
            if let error {
                BoxLog.warn("badge clear failed: \(error.localizedDescription)", category: .push)
            }
        }
        center.getDeliveredNotifications { delivered in
            let dots = delivered
                .filter { NotificationLoudness(userInfo: $0.request.content.userInfo) == .dot }
                .map(\.request.identifier)
            if dots.isEmpty == false {
                center.removeDeliveredNotifications(withIdentifiers: dots)
            }
        }
    }
}

/// Holds a tapped notification until the SwiftUI tree can act on it. A cold
/// launch from a tap delivers `didReceive` before `RootView` exists; the
/// published value waits for it, the way `PairingURLInbox` holds a pairing URL.
@MainActor
final class NotificationTapInbox: ObservableObject {
    static let shared = NotificationTapInbox()

    struct Pending: Equatable, Identifiable {
        let id = UUID()
        var tap: NotificationTap
    }

    @Published private(set) var pending: Pending?

    private init() {}

    func accept(_ tap: NotificationTap) {
        pending = Pending(tap: tap)
    }

    func clear(_ id: Pending.ID) {
        guard pending?.id == id else {
            return
        }
        pending = nil
    }
}
