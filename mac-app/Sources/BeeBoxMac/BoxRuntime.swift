import Containerization
import ContainerizationExtras
import Foundation

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

    @Published private(set) var phase: Phase = .stopped
    @Published private(set) var memorySummary = ""

    static let containerID = "box"
    static let imageReference = "beebox:phase0"
    static let serverPort = 3210

    private var manager: ContainerManager?
    private var container: LinuxContainer?
    private var log: LogWriter?
    private var statsTask: Task<Void, Never>?

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
        let stopping = Date()
        defer { NSLog("beebox: stopped in \(String(format: "%.1f", Date().timeIntervalSince(stopping)))s") }
        if let container {
            // Clear first so the exit watcher does not report this as a crash.
            self.container = nil
            phase = .working("Stopping…")
            // Container.stop() SIGKILLs everything. Ask the server to exit
            // first so it can finish in-flight git work.
            do {
                try await container.kill(.term)
                let status = try await container.wait(timeoutInSeconds: 20)
                NSLog("beebox: server exited \(status.exitCode) after SIGTERM")
            } catch {
                NSLog("beebox: graceful exit failed, forcing: \(error)")
            }
            do {
                try await container.stop()
            } catch {
                NSLog("beebox: stop failed: \(error)")
            }
        }
        if var manager {
            do {
                try manager.delete(Self.containerID)
            } catch {
                NSLog("beebox: delete failed: \(error)")
            }
            self.manager = manager
        }
        phase = .stopped
        memorySummary = ""
    }

    private var isFailed: Bool {
        if case .failed = phase { return true }
        return false
    }

    private func run() async {
        do {
            let started = Date()
            phase = .working("Preparing runtime…")
            try prepareDirectories()
            try prepareKernelAndInitfs()
            var manager = try ContainerManager(
                kernel: Kernel(path: Paths.kernel, platform: .linuxArm),
                initfs: .block(format: "ext4", source: Paths.initfs.path, destination: "/", options: ["ro"]),
                root: Paths.state,
                network: try VmnetNetwork()
            )
            let image = try await loadImage(manager.imageStore)
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

            guard let ip = container.interfaces.first?.ipv4Address.address else {
                throw RuntimeError("the VM has no network interface")
            }
            let base = URL(string: "http://\(ip):\(Self.serverPort)/")!
            phase = .working("Waiting for the server…")
            try await waitForServer(base)
            NSLog("beebox: ready in \(String(format: "%.1f", Date().timeIntervalSince(started)))s at \(base)")
            phase = .running(base.appending(path: "box/"))
            watch(container)
        } catch {
            NSLog("beebox: start failed: \(error)")
            phase = .failed(String(describing: error))
        }
    }

    private func prepareDirectories() throws {
        for dir in [Paths.state, Paths.box, Paths.claudeConfig] {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }

    /// Spike: reuse the kernel and initfs the `container` CLI downloaded.
    private func prepareKernelAndInitfs() throws {
        let fm = FileManager.default
        let cliRoot = Paths.spikeInputs.appending(path: "app")
        if !fm.fileExists(atPath: Paths.kernel.path) {
            let link = cliRoot.appending(path: "kernels/default.kernel-arm64")
            let target = try fm.destinationOfSymbolicLink(atPath: link.path)
            try clone(URL(filePath: target), to: Paths.kernel)
        }
        if !fm.fileExists(atPath: Paths.initfs.path) {
            try clone(cliRoot.appending(path: "containers/buildkit/initfs.ext4"), to: Paths.initfs)
        }
    }

    private func clone(_ source: URL, to destination: URL) throws {
        if Darwin.clonefile(source.path, destination.path, 0) != 0 {
            try FileManager.default.copyItem(at: source, to: destination)
        }
    }

    private func loadImage(_ store: ImageStore) async throws -> Image {
        if let image = try? await store.get(reference: Self.imageReference) {
            return image
        }
        phase = .working("Loading the beebox image…")
        let layout = Paths.spikeInputs.appending(path: "oci/layout")
        let images = try await store.load(from: layout)
        guard let image = images.first else {
            throw RuntimeError("no image in \(layout.path)")
        }
        return image
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

    private func waitForServer(_ base: URL) async throws {
        let deadline = Date().addingTimeInterval(600)
        while Date() < deadline {
            if let (_, response) = try? await URLSession.shared.data(from: base),
               let http = response as? HTTPURLResponse, http.statusCode < 500 {
                return
            }
            try await Task.sleep(for: .seconds(1))
        }
        throw RuntimeError("the server did not answer within 10 minutes; see \(Paths.log.path)")
    }

    private func watch(_ container: LinuxContainer) {
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
            let status = try? await container.wait()
            guard let self, self.container === container else { return }
            self.statsTask?.cancel()
            self.container = nil
            self.phase = .failed("the box exited (\(status.map { String($0.exitCode) } ?? "unknown")); see \(Paths.log.path)")
        }
    }
}

struct RuntimeError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}
