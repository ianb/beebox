import BeeBoxShared

/// The Mac app's Keychain items, one service per kind of secret, in the app's
/// default access group (it has no extensions to share with).
enum MacKeychain {
    static let deviceTokens = PairedBoxCredentialStore(service: "run.beebox.mac.device-token", accessGroup: nil)

    static let all = [deviceTokens]
}
