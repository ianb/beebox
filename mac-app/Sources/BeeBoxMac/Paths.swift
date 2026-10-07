import Foundation

/// Where the app keeps things. Two roots:
///
/// - `~/BeeBox/<name>/`: one folder per box, visible in Finder. Each is the
///   box's own git repository.
/// - `~/Library/Application Support/Bee Box/`: what every box on this Mac
///   shares. The container runtime (images, VM disks, init filesystem) records
///   absolute paths, so this folder must not move once created.
///
/// Accounts, the session key, secrets, and agent logins are machine-wide in
/// beebox (one account file serves every box on a host), so they live in the
/// shared part. The app runs one box today: `BEEBOX_BOX`, default `box`.
enum Paths {
    static let home = FileManager.default.homeDirectoryForCurrentUser
    private static let env = ProcessInfo.processInfo.environment

    // MARK: Shared by every box

    /// `BEEBOX_STATE_DIR` overrides it, for a second, throwaway instance.
    static let support: URL = {
        if let override = env["BEEBOX_STATE_DIR"] {
            return URL(filePath: override, directoryHint: .isDirectory)
        }
        return home.appending(path: "Library/Application Support/Bee Box", directoryHint: .isDirectory)
    }()

    /// Containerization's root: the image store, container roots, initfs.
    static let runtime = support.appending(path: "runtime", directoryHint: .isDirectory)
    /// Built by the framework from the vminit image, and the reference it was
    /// built from (see BoxRuntime.refreshInitfsIfStale).
    static let initfs = runtime.appending(path: "initfs.ext4")
    static let initfsSource = runtime.appending(path: "initfs.ext4.source")

    /// The container user's home, mounted at /home/node: accounts, the session
    /// key, the secret store, the Codex login, and uv/Docling caches. The
    /// image keeps nothing it needs there (see the Dockerfile).
    static let containerHome = support.appending(path: "home", directoryHint: .isDirectory)
    /// Claude Code's config and login (CLAUDE_CONFIG_DIR in the image).
    static let claudeConfig = support.appending(path: "claude-config", directoryHint: .isDirectory)

    static let logs = support.appending(path: "logs", directoryHint: .isDirectory)
    static let appLog = logs.appending(path: "app.log")
    static let timings = support.appending(path: "timings.json")
    /// Host ends of each box's vsock relay (see PortForwarder). Unix socket
    /// paths are limited to 104 bytes, so the names stay short.
    static let run = support.appending(path: "run", directoryHint: .isDirectory)

    // MARK: Per box

    /// The folder holding every box. `BEEBOX_BOXES_DIR` overrides it.
    static let boxes: URL = {
        if let override = env["BEEBOX_BOXES_DIR"] {
            return URL(filePath: override, directoryHint: .isDirectory)
        }
        return home.appending(path: "BeeBox", directoryHint: .isDirectory)
    }()

    /// The box this app runs. Its name is also its URL slug (`/box/`). At most
    /// 32 characters: it names the box's relay socket, and Unix socket paths
    /// are limited to 104 bytes.
    static let boxName: String = {
        let name = env["BEEBOX_BOX"] ?? "box"
        let allowed = CharacterSet.lowercaseLetters.union(.decimalDigits).union(CharacterSet(charactersIn: "-"))
        precondition((1...32).contains(name.count) && name.unicodeScalars.allSatisfy(allowed.contains),
                     "BEEBOX_BOX must be 1-32 lowercase letters, digits, and hyphens")
        return name
    }()

    static func box(named name: String) -> URL { boxes.appending(path: name, directoryHint: .isDirectory) }
    static func log(forBox name: String) -> URL { logs.appending(path: "box-\(name).log") }
    static func socket(forBox name: String) -> URL { run.appending(path: "\(name).sock") }

    /// The current box's folder, log, and relay socket.
    static var box: URL { box(named: boxName) }
    static var log: URL { log(forBox: boxName) }
    static var httpSocket: URL { socket(forBox: boxName) }

    // MARK: Inputs

    /// The Linux kernel the VM boots: bundled in the app
    /// (scripts/fetch-kernel.sh). `BEEBOX_KERNEL` overrides it for a bare
    /// `swift build` binary, which has no bundle.
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
