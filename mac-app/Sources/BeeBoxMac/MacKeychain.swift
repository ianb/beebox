import BeeBoxMacCore
import BeeBoxShared

/// The Mac app's Keychain items, one service per kind of secret, in the app's
/// default access group (it has no extensions to share with). The app reads
/// them through a cache, so each item is read at most once per launch.
enum MacKeychain {
    private static let deviceTokenItems = PairedBoxCredentialStore(service: "run.beebox.mac.device-token", accessGroup: nil)
    /// This Mac's scan token per box, keyed by the box's id.
    private static let scanTokenItems = PairedBoxCredentialStore(service: "run.beebox.mac.scan-token", accessGroup: nil)

    static let deviceTokens = CachedCredentialStore(deviceTokenItems)
    static let scanTokens = CachedCredentialStore(scanTokenItems)

    /// The raw stores, for uninstall to purge.
    static let all = [deviceTokenItems, scanTokenItems]
}
