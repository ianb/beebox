import Containerization
import ContainerizationExtras
import Foundation
import Virtualization

/// Owns the VM that runs the beebox image: prepares the runtime, initializes
/// the box on first run, serves it, and reports status and memory.
@MainActor
final class BoxRuntime: ObservableObject {
    enum Phase: Equatable {
        case stopped
        case working(String)
        case running(URL)
        case failed(String)
    }

    /// A start or stop in progress, for the menu's elapsed/expected line.
    struct Progress: Equatable {
        var operation: TimedOperation
        let startedAt: Date
    }

    @Published private(set) var phase: Phase = .stopped
    @Published private(set) var memorySummary = ""
    @Published private(set) var progress: Progress?
    /// The last completed start or stop and how long it took.
    @Published private(set) var lastCompleted: (operation: TimedOperation, seconds: TimeInterval)?
    /// Ticks once a second while an operation is in progress, so the menu's
    /// elapsed time moves.
    @Published private(set) var now = Date()
    private(set) var timings = Timings.load()
    private var ticker: Timer?

    static let containerID = "box"
    static let serverPort: UInt16 = 3210
    /// The relay's socket inside the VM.
    nonisolated static let guestSocket = "/tmp/beebox-http.sock"
    /// Stable local port for the browser. `BEEBOX_PORT` overrides it.
    static let localPort: UInt16 = {
        if let override = ProcessInfo.processInfo.environment["BEEBOX_PORT"], let port = UInt16(override) {
            return port
        }
        return 3280
    }()

    private var manager: ContainerManager?
    private var container: LinuxContainer?
    private var log: LogWriter?
    private var statsTask: Task<Void, Never>?
    private var forwarder: PortForwarder?
    /// Set when the current container's main process exits.
    private var exitedWith: Int32?

    var firstRunSetupURL: URL? {
        guard case .running(let boxURL) = phase, let path = log?.firstRunSetupPath else { return nil }
        return URL(string: path, relativeTo: boxURL)?.absoluteURL
    }

    func start() {
        guard phase == .stopped || isFailed else { return }
        Task { await run() }
    }

    func stop() async {
        statsTask?.cancel()
        statsTask = nil
        // The forwarder stays up until the server has exited: the server's
        // WebSocket close frames reach the browser through it, and without
        // them the server waits out its 30 s close timeout.
        defer {
            forwarder?.stop()
            forwarder = nil
        }
        let stopping = Date()
        defer { appLog("stopped in \(String(format: "%.1f", Date().timeIntervalSince(stopping)))s") }
        let hadContainer = container != nil
        if hadContainer { begin(.stop) }
        if let container {
            // Clear first so the exit watcher does not report this as a crash.
            self.container = nil
            phase = .working("Stopping…")
            // Container.stop() SIGKILLs everything. Ask the server to exit
            // first so it can finish in-flight git work.
            do {
                try await container.kill(.term)
                let signalled = Date()
                let status = try await container.wait(timeoutInSeconds: 60)
                appLog("server exited \(status.exitCode) \(String(format: "%.1f", Date().timeIntervalSince(signalled)))s after SIGTERM")
            } catch {
                // A forced stop leaves the server's lock files behind; the next
                // start waits for them to go stale (5 minutes).
                appLog("server did not exit within 60s of SIGTERM, forcing: \(error)")
            }
            do {
                try await container.stop()
            } catch {
                appLog("stop failed: \(error)")
            }
        }
        if var manager {
            do {
                try manager.delete(Self.containerID)
            } catch {
                appLog("delete failed: \(error)")
            }
            self.manager = manager
        }
        phase = .stopped
        memorySummary = ""
        if hadContainer { finish(succeeded: true) }
    }

    private func begin(_ operation: TimedOperation) {
        progress = Progress(operation: operation, startedAt: Date())
        now = Date()
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.now = Date() }
        }
    }

    /// Ends the operation; a successful one is recorded for future estimates.
    private func finish(succeeded: Bool) {
        ticker?.invalidate()
        ticker = nil
        guard let progress else { return }
        self.progress = nil
        guard succeeded else { return }
        let seconds = Date().timeIntervalSince(progress.startedAt)
        timings.record(progress.operation, seconds: seconds)
        lastCompleted = (progress.operation, seconds)
    }

    private var isFailed: Bool {
        if case .failed = phase { return true }
        return false
    }

    private func run() async {
        do {
            let started = Date()
            begin(.start)
            phase = .working("Preparing runtime…")
            guard VZVirtualMachine.isSupported else {
                throw RuntimeError("this Mac cannot run virtual machines (for example, macOS itself running in a VM without nested virtualization)")
            }
            guard let kernelPath = Paths.kernel else {
                throw RuntimeError("the app bundle has no Linux kernel; build it with scripts/build-app.sh, or set BEEBOX_KERNEL")
            }
            try prepareDirectories()
            // The init filesystem comes from Apple's vminit image, pulled once
            // (small) at the version matching the pinned Containerization.
            var manager = try await ContainerManager(
                kernel: Kernel(path: kernelPath, platform: .linuxArm),
                initfsReference: BundleConfig.vminit,
                root: Paths.state,
                network: try VmnetNetwork()
            )
            let source = ImageSource(store: manager.imageStore) { [weak self] line in
                await MainActor.run { self?.phase = .working(line) }
            }
            let (image, fetched) = try await source.image()
            if fetched || !boxIsInitialized() { progress?.operation = .firstStart }
            let log = try LogWriter(url: Paths.log)
            self.log = log

            if !boxIsInitialized() {
                phase = .working("Creating your box…")
                try await runOnce(&manager, image: image, log: log, arguments: ["bbx", "engine", "init", "/data/box"])
            }

            phase = .working("Starting box…")
            try? manager.delete(Self.containerID)
            let container = try await create(&manager, image: image, log: log, arguments: nil)
            try await container.create()
            try await container.start()
            self.manager = manager
            self.container = container
            // One wait per container: startup watches it to stop waiting on a
            // server that already exited, and `watch` reports a later crash.
            exitedWith = nil
            let exit = Task { await (try? container.wait())?.exitCode }
            Task { [weak self] in
                let code = await exit.value
                if self?.container === container { self?.exitedWith = code ?? -1 }
            }

            try await startHTTPRelay(container, log: log)
            let forwarder = try PortForwarder(localPort: Self.localPort, targetSocket: Paths.httpSocket)
            try await forwarder.start()
            self.forwarder = forwarder
            let base = URL(string: "http://localhost:\(Self.localPort)/")!
            phase = .working("Waiting for the server…")
            try await waitForServer(base)
            appLog("ready in \(String(format: "%.1f", Date().timeIntervalSince(started)))s at \(base)")
            phase = .running(base.appending(path: "box/"))
            finish(succeeded: true)
            watch(container, exit: exit)
        } catch {
            appLog("start failed: \(error)")
            finish(succeeded: false)
            phase = .failed(String(describing: error))
        }
    }

    private func prepareDirectories() throws {
        for dir in [Paths.state, Paths.box, Paths.claudeConfig, Paths.containerHome] {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        try moveLegacyMachineState()
    }

    /// Earlier builds pointed BBX_AUTH_FILE / BBX_SECRETS_FILE into a
    /// `machine` folder; move those files to where the home volume keeps them.
    private func moveLegacyMachineState() throws {
        let fm = FileManager.default
        let moves = [
            (Paths.legacyMachine.appending(path: "bbx-auth.json"), Paths.containerHome.appending(path: ".bbx-auth.json")),
            (Paths.legacyMachine.appending(path: "secrets.json"), Paths.containerHome.appending(path: ".config/beebox/secrets.json")),
        ]
        for (from, to) in moves where fm.fileExists(atPath: from.path) && !fm.fileExists(atPath: to.path) {
            try fm.createDirectory(at: to.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.moveItem(at: from, to: to)
            appLog("moved \(from.lastPathComponent) into the home volume")
        }
        // Earlier builds copied in the kernel and initfs the `container` CLI
        // had downloaded; the kernel is bundled now and the initfs comes from
        // the vminit image.
        for stale in ["vmlinux", "initfs.ext4"] {
            let url = Paths.state.appending(path: stale)
            if fm.fileExists(atPath: url.path) {
                try fm.removeItem(at: url)
                appLog("removed the old copied \(stale)")
            }
        }
    }

    private func boxIsInitialized() -> Bool {
        FileManager.default.fileExists(atPath: Paths.box.appending(path: ".beebox/box.json").path)
    }

    /// Size the VM from the host: a quarter of physical memory, 2–4 GiB.
    /// `BEEBOX_VM_MEMORY_MB` overrides it for spike measurements.
    private static var boxMemory: UInt64 {
        if let override = ProcessInfo.processInfo.environment["BEEBOX_VM_MEMORY_MB"], let mb = UInt64(override) {
            return mb.mib()
        }
        let quarter = ProcessInfo.processInfo.physicalMemory / 4
        return min(max(quarter, 2.gib()), 4.gib())
    }

    private func create(
        _ manager: inout ContainerManager,
        image: Image,
        log: LogWriter,
        arguments: [String]?
    ) async throws -> LinuxContainer {
        let memory = Self.boxMemory
        return try await manager.create(
            Self.containerID,
            image: image,
            rootfsSizeInBytes: 8.gib(),
            vm: VMResources(cpus: 4, memoryInBytes: memory + VMResources.guestMemoryOverhead)
        ) { @Sendable config in
            config.cpus = 4
            config.memoryInBytes = memory
            config.hostname = "beebox"
            config.mounts.append(.share(source: Paths.box.path, destination: "/data/box"))
            config.mounts.append(.share(source: Paths.claudeConfig.path, destination: "/app/claude-config"))
            config.mounts.append(.share(source: Paths.containerHome.path, destination: "/home/node"))
            if arguments == nil {
                config.sockets = [UnixSocketConfiguration(
                    source: URL(filePath: Self.guestSocket),
                    destination: Paths.httpSocket,
                    direction: .outOf
                )]
            }
            config.process.environmentVariables += [
                // Claude writes transcripts under CLAUDE_CONFIG_DIR, not ~/.claude.
                "BBX_CLAUDE_PROJECTS_DIR=/app/claude-config/projects",
            ]
            config.process.stdout = log
            config.process.stderr = log
            if let arguments {
                config.process.arguments = ["/app/entrypoint.sh"] + arguments
            }
        }
    }

    private func runOnce(_ manager: inout ContainerManager, image: Image, log: LogWriter, arguments: [String]) async throws {
        try? manager.delete(Self.containerID)
        let container = try await create(&manager, image: image, log: log, arguments: arguments)
        try await container.create()
        try await container.start()
        let status = try await container.wait()
        try await container.stop()
        try manager.delete(Self.containerID)
        guard status.exitCode == 0 else {
            throw RuntimeError("\(arguments.joined(separator: " ")) exited \(status.exitCode); see \(Paths.log.path)")
        }
    }

    /// Inside the VM, relay a Unix socket to the server's TCP port, using the
    /// image's own Node; Containerization carries that socket out to the host
    /// (`config.sockets`, direction .outOf). Started per launch, it dies with
    /// the VM.
    private func startHTTPRelay(_ container: LinuxContainer, log: LogWriter) async throws {
        let script = """
            const net = require("net"), fs = require("fs");
            try { fs.unlinkSync("\(Self.guestSocket)"); } catch (_e) {}
            net.createServer((c) => {
              const u = net.connect(\(Self.serverPort), "127.0.0.1");
              c.pipe(u); u.pipe(c);
              c.on("error", () => u.destroy()); u.on("error", () => c.destroy());
            }).listen("\(Self.guestSocket)");
            """
        let relay = try await container.exec("http-relay") { config in
            config.arguments = ["node", "-e", script]
            config.stdout = log
            config.stderr = log
        }
        try await relay.start()
    }

    private func waitForServer(_ base: URL) async throws {
        let deadline = Date().addingTimeInterval(600)
        while Date() < deadline {
            if let (_, response) = try? await URLSession.shared.data(from: base),
               let http = response as? HTTPURLResponse, http.statusCode < 500 {
                return
            }
            if let code = exitedWith {
                throw RuntimeError("the box exited (\(code)) before serving; see \(Paths.log.path)")
            }
            try await Task.sleep(for: .seconds(1))
        }
        throw RuntimeError("the server did not answer within 10 minutes; see \(Paths.log.path)")
    }

    private func watch(_ container: LinuxContainer, exit: Task<Int32?, Never>) {
        statsTask = Task { [weak self] in
            while !Task.isCancelled {
                if let stats = try? await container.statistics(categories: .memory), let mem = stats.memory {
                    self?.memorySummary = String(
                        format: "VM memory: %.0f MB used (%.0f MB cache) of %.0f MB",
                        Double(mem.usageBytes) / 1_048_576,
                        Double(mem.cacheBytes) / 1_048_576,
                        Double(mem.limitBytes) / 1_048_576
                    )
                }
                try? await Task.sleep(for: .seconds(10))
            }
        }
        Task { [weak self] in
            let code = await exit.value
            guard let self, self.container === container else { return }
            self.statsTask?.cancel()
            self.container = nil
            self.phase = .failed("the box exited (\(code.map { String($0) } ?? "unknown")); see \(Paths.log.path)")
        }
    }
}

struct RuntimeError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}
