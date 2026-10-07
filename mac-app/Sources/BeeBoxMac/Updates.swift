import Foundation
import Sparkle

/// Sparkle, with gentle reminders: a menu-bar app has no window to raise, so a
/// scheduled check that finds an update shows it as a menu item instead of a
/// dialog appearing out of nowhere. A check the user asked for still shows
/// Sparkle's own window.
@MainActor
final class Updates: NSObject, ObservableObject, @preconcurrency SPUStandardUserDriverDelegate {
    /// The version a scheduled check found, until its update session ends.
    @Published private(set) var available: String?
    private var controller: SPUStandardUpdaterController?

    /// Off when the bundle has no feed or no signing key (development builds).
    var enabled: Bool { controller != nil }

    override init() {
        super.init()
        if BundleConfig.updatesConfigured {
            controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: self)
        }
    }

    func checkForUpdates() {
        controller?.checkForUpdates(nil)
    }

    var supportsGentleScheduledUpdateReminders: Bool { true }

    /// Let Sparkle show a scheduled update only when the app is already in
    /// focus; otherwise the menu item carries it.
    func standardUserDriverShouldHandleShowingScheduledUpdate(_ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool) -> Bool {
        immediateFocus
    }

    func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
        if !handleShowingUpdate {
            available = update.displayVersionString
        }
    }

    func standardUserDriverWillFinishUpdateSession() {
        available = nil
    }
}
