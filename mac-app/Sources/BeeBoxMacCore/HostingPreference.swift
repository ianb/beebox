import Foundation

/// "Run a box on this Mac". Off by default: with it off the app never starts
/// the VM runtime, so it downloads no image and creates no VM disk.
public enum HostingPreference {
    public static let defaultsKey = "runLocalBox"

    /// The stored choice, or, before the boxholder has chosen, on only when a
    /// box already exists here, so an install from before this setting keeps
    /// running its box after the update.
    public static func resolve(stored: Bool?, existingBoxFolder: Bool) -> Bool {
        stored ?? existingBoxFolder
    }

    public static func read(_ defaults: UserDefaults, existingBoxFolder: Bool) -> Bool {
        let stored = defaults.object(forKey: defaultsKey) as? Bool
        return resolve(stored: stored, existingBoxFolder: existingBoxFolder)
    }

    public static func write(_ value: Bool, to defaults: UserDefaults) {
        defaults.set(value, forKey: defaultsKey)
    }
}
