import BeeBoxShared

extension PairedBoxCredentialStore {
    /// The iOS app's device tokens, shared with its extensions through the
    /// app-group Keychain access group.
    static let ios = PairedBoxCredentialStore(
        service: "app.beebox.ios.device-token",
        accessGroup: "44AJ3D25ZD.group.app.beebox.ios"
    )
}
