import Foundation

/// Where the app keeps its state, and where its inputs come from. The runtime
/// records absolute paths, so the state directory must never move once created.
enum Paths {
    static let home = FileManager.default.homeDirectoryForCurrentUser
    private static let env = ProcessInfo.processInfo.environment

    /// Runtime state: image store, container roots, initfs, logs.
    /// `BEEBOX_STATE_DIR` overrides it, for a second, throwaway instance.
    static let state: URL = {
        if let override = env["BEEBOX_STATE_DIR"] {
            return URL(filePath: override, directoryHint: .isDirectory)
        }
        return home.appending(path: "Library/Application Support/BeeBoxSpike", directoryHint: .isDirectory)
    }()

    /// The box itself: a folder the user can see in Finder.
    static let box: URL = {
        if let override = env["BEEBOX_BOX_DIR"] {
            return URL(filePath: override, directoryHint: .isDirectory)
        }
        return home.appending(path: "BeeBoxSpike/box", directoryHint: .isDirectory)
    }()

    /// Claude Code's config and credentials (CLAUDE_CONFIG_DIR in the image).
    static let claudeConfig = state.appending(path: "claude-config", directoryHint: .isDirectory)

    /// The container user's home, mounted at /home/node: accounts, the session
    /// key, the secret store, the Codex login, and uv/Docling caches. The
    /// image keeps nothing it needs there (see the Dockerfile).
    static let containerHome = state.appending(path: "home", directoryHint: .isDirectory)
    /// Earlier spike builds kept accounts and secrets here via env overrides.
    static let legacyMachine = state.appending(path: "machine", directoryHint: .isDirectory)

    static let log = state.appending(path: "box.log")
    static let appLog = state.appending(path: "app.log")
    /// Built by the framework from the vminit image (ContainerManager), and
    /// the reference it was built from.
    static let initfs = state.appending(path: "initfs.ext4")
    static let initfsSource = state.appending(path: "initfs.ext4.source")
    /// Host end of the vsock relay to the server (see PortForwarder).
    static let httpSocket = state.appending(path: "http.sock")
    static let timings = state.appending(path: "timings.json")

    /// The Linux kernel the VM boots: bundled in the app
    /// (scripts/fetch-kernel.sh). `BEEBOX_KERNEL` overrides it for a bare
    /// `swift run` build, which has no bundle.
    static var kernel: URL? {
        if let override = env["BEEBOX_KERNEL"] {
            return URL(filePath: override)
        }
        return Bundle.main.url(forResource: "vmlinux", withExtension: nil)
    }

    /// For development: load the image from a local OCI layout instead of
    /// pulling it (`container image save`, then untar).
    static var imageLayout: URL? {
        env["BEEBOX_IMAGE_LAYOUT"].map { URL(filePath: $0, directoryHint: .isDirectory) }
    }
}

/// What the bundle pins, from Info.plist (written by scripts/build-app.sh).
enum BundleConfig {
    private static func string(_ key: String) -> String? {
        Bundle.main.object(forInfoDictionaryKey: key) as? String
    }

    static var version: String {
        string("CFBundleShortVersionString") ?? "dev"
    }

    /// The beebox image this build of the app runs. The app and the image are
    /// released together, so the tag is the app's version. `BEEBOX_IMAGE`
    /// overrides it.
    static var image: String {
        if let override = ProcessInfo.processInfo.environment["BEEBOX_IMAGE"] {
            return override
        }
        return string("BeeBoxImage") ?? "ghcr.io/ianb/beebox:latest"
    }

    /// The init image for the VM, matching the pinned Containerization package.
    static let vminit = "ghcr.io/apple/containerization/vminit:0.48.0"

    /// Sparkle needs both a feed and the public half of the update-signing key.
    /// Until the key exists, updates stay off rather than failing at runtime.
    static var updatesConfigured: Bool {
        guard let feed = string("SUFeedURL"), !feed.isEmpty,
              let key = string("SUPublicEDKey"), !key.isEmpty
        else { return false }
        return true
    }
}
