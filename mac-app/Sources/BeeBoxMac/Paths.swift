import Foundation

/// Where the spike keeps its state. The runtime records absolute paths, so the
/// state directory must never move once created.
enum Paths {
    static let home = FileManager.default.homeDirectoryForCurrentUser

    /// Runtime state: image store, container roots, kernel, initfs, logs.
    static let state = home.appending(path: "Library/Application Support/BeeBoxSpike", directoryHint: .isDirectory)

    /// The box itself: a folder the user can see in Finder. Overridable for the spike.
    static let box: URL = {
        if let override = ProcessInfo.processInfo.environment["BEEBOX_BOX_DIR"] {
            return URL(filePath: override, directoryHint: .isDirectory)
        }
        return home.appending(path: "BeeBoxSpike/box", directoryHint: .isDirectory)
    }()

    /// Claude Code's config and credentials (CLAUDE_CONFIG_DIR in the image).
    static let claudeConfig = state.appending(path: "claude-config", directoryHint: .isDirectory)

    static let kernel = state.appending(path: "vmlinux")
    static let initfs = state.appending(path: "initfs.ext4")
    static let log = state.appending(path: "box.log")

    /// Spike-only inputs, prepared outside the app: an OCI layout of the image,
    /// and the kernel + initfs the `container` CLI already downloaded. A real
    /// app bundles the kernel and initfs and pulls the image from a registry.
    static let spikeInputs: URL = {
        if let override = ProcessInfo.processInfo.environment["BEEBOX_SPIKE_INPUTS"] {
            return URL(filePath: override, directoryHint: .isDirectory)
        }
        return home.appending(path: "Library/Caches/beebox-phase0", directoryHint: .isDirectory)
    }()
}
