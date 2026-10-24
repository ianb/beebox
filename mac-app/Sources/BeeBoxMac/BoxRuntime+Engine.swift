import BeeBoxMacCore
import Containerization
import Foundation

/// What Preferences shows about the engine: the version in use and what the
/// last check against the channel concluded.
struct EngineStatus: Equatable {
    var version: String?
    var checkedAt: Date?
    /// Why the engine did not move, or that it is waiting; nil when current.
    var note: String?
}

/// Engine updates at a start: the record written before the image
/// references change, the promotion, the success test, and the rollback.
/// See beebox/docs/plans/mac-app-engine-channel.md, Track C.
///
/// Every look at the box's git state and the reset run inside the VM, on the
/// engine image, through the entrypoint's "any arguments → exec them" path.
/// The host's `/usr/bin/git` is a stub that offers to install the developer
/// tools on a Mac without them, so the app never calls it.
extension BoxRuntime {
    /// An update is possible: a candidate differs from the current image. A
    /// box with uncommitted edits defers it (the record would otherwise
    /// authorize a reset over the person's own work); a clean box gets the
    /// record, then the promotion. Returns the image to start with.
    func beginUpdate(
        _ manager: inout ContainerManager,
        source: ImageSource,
        from current: Containerization.Image,
        to candidate: Containerization.Image,
        log: LogWriter
    ) async throws -> Containerization.Image? {
        let target = await source.info(candidate)
        let label = target.version ?? String(candidate.digest.prefix(19))
        guard boxIsInitialized() else {
            // No box yet: nothing to roll back, the candidate is simply current.
            try await source.promote(candidate)
            return try await manager.imageStore.get(reference: ImageSource.current)
        }
        phase = .working("Checking the box before updating to engine \(label)…")
        let state = try await boxGitState(&manager, image: current, log: log)
        guard state.clean else {
            appLog("engine update to \(label) deferred: the box has uncommitted edits")
            engine.note = "Engine \(label) is waiting: the box has uncommitted edits. It applies at the first start after they are committed."
            return nil
        }
        let record = UpdateRecord(previousDigest: current.digest, candidateDigest: candidate.digest, boxHead: state.head, startedAt: Date())
        try writeUpdateRecord(record)
        phase = .working("Updating to engine \(label)…")
        try await source.promote(candidate)
        return try await manager.imageStore.get(reference: ImageSource.current)
    }

    /// The window closes only when the beebox server itself answers: `/api/build-info`
    /// exists on no other process that could sit on the port.
    func finishUpdate(_ base: URL) async throws {
        guard readUpdateRecord() != nil else { return }
        let deadline = Date().addingTimeInterval(120)
        while Date() < deadline {
            if let (_, response) = try? await URLSession.shared.data(from: base.appending(path: "api/build-info")),
               let http = response as? HTTPURLResponse, http.statusCode == 200 {
                try removeUpdateRecord()
                appLog("engine update finished: the server answered build-info")
                return
            }
            try await Task.sleep(for: .seconds(1))
        }
        throw RuntimeError("the updated engine served HTTP but not as the Bee Box server (no build-info within 2 minutes); see \(Paths.log.path)")
    }

    /// A start ended in failure while a record exists: put the previous
    /// engine back, undo the sweep's commits when there were any, and say
    /// which engine to restart on. Nil when no update was in progress.
    func rollBackUpdate(after error: Error) async -> String? {
        guard let record = readUpdateRecord(), var manager, let log else { return nil }
        let source = ImageSource(store: manager.imageStore) { [weak self] line in
            await MainActor.run { self?.phase = .working(line) }
        }
        do {
            phase = .working("The new engine did not start; going back…")
            try await source.rollBack()
            let restored = try await manager.imageStore.get(reference: ImageSource.current)
            let state = try await boxGitState(&manager, image: restored, log: log)
            if state.head != record.boxHead || !state.clean {
                appLog("resetting the box to \(record.boxHead) (HEAD \(state.head), clean \(state.clean))")
                try await runOnce(&manager, image: restored, log: log, arguments: ["git", "-C", "/data/box", "reset", "--hard", record.boxHead])
            }
            try removeUpdateRecord()
            let version = await source.info(restored).version ?? "the previous engine"
            engine.note = "The update to engine \(engine.version ?? "?") failed; back on \(version). See \(Paths.appLog.path)"
            engine.version = version
            self.manager = manager
            return version
        } catch let rollbackError {
            appLog("rollback failed: \(rollbackError)")
            engine.note = "The engine update failed and so did going back: \(rollbackError). Pre-update commit \(record.boxHead). See \(Paths.appLog.path)"
            self.manager = manager
            return nil
        }
    }

    /// A record left by an earlier run (the app quit mid-update). The store
    /// says how far it got; `UpdateRecord.recovery` says what to do.
    func recoverUnfinishedUpdate(_ manager: inout ContainerManager, source: ImageSource, log: LogWriter) async throws {
        guard let record = readUpdateRecord() else { return }
        let currentDigest = await source.currentDigest()
        let previousExists = await source.previousExists()
        var state = (head: record.boxHead, clean: true)
        if currentDigest == record.candidateDigest, previousExists, boxIsInitialized(),
           let current = try? await manager.imageStore.get(reference: ImageSource.current) {
            state = try await boxGitState(&manager, image: current, log: log)
        }
        switch record.recovery(currentDigest: currentDigest, previousExists: previousExists, boxHead: state.head, boxClean: state.clean) {
        case .discardRecord:
            appLog("an earlier update stopped before changing images; forgetting its record")
            try removeUpdateRecord()
        case .rollBack(let resetBox):
            appLog("an earlier update to \(record.candidateDigest.prefix(19)) never finished; rolling back (reset \(resetBox))")
            phase = .working("Finishing an interrupted engine update…")
            try await source.rollBack()
            if resetBox {
                let restored = try await manager.imageStore.get(reference: ImageSource.current)
                try await runOnce(&manager, image: restored, log: log, arguments: ["git", "-C", "/data/box", "reset", "--hard", record.boxHead])
            }
            try removeUpdateRecord()
            engine.note = "An interrupted engine update was undone. See \(Paths.appLog.path)"
        case .stop(let reason):
            throw RuntimeError("an engine update was interrupted and cannot be undone automatically: \(reason). Pre-update commit \(record.boxHead); record \(Paths.updateRecord.path)")
        }
    }

    /// Record what is running and what the check said, for Preferences.
    func noteEngine(source: ImageSource, image: Containerization.Image, selection: ImageSource.Selection) async {
        let version = await source.info(image).version
        var status = EngineStatus(version: version, checkedAt: Date(), note: engine.note)
        if let failure = selection.checkFailure {
            status.note = "Could not check the channel: \(failure)"
        } else if let decision = selection.decision, decision != .upToDate, selection.candidate == nil, status.note == nil {
            status.note = ImageSource.explain(decision)
        }
        engine = status
    }

    // MARK: Box git state, read inside the VM

    /// HEAD and whether the tree is clean, read by the engine image's own git.
    func boxGitState(_ manager: inout ContainerManager, image: Containerization.Image, log: LogWriter) async throws -> (head: String, clean: Bool) {
        let capture = CaptureWriter(also: log)
        try? manager.delete(Self.containerID)
        let container = try await create(&manager, image: image, log: log, arguments: ["bash", "-c", "cd /data/box && git rev-parse HEAD && git status --porcelain"], stdout: capture)
        try await container.create()
        try await container.start()
        let status = try await container.wait()
        try await container.stop()
        try manager.delete(Self.containerID)
        guard status.exitCode == 0 else {
            throw RuntimeError("could not read the box's git state (exit \(status.exitCode)); see \(Paths.log.path)")
        }
        let lines = capture.text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let head = lines.first, head.count == 40 else {
            throw RuntimeError("could not read the box's HEAD: \(capture.text.prefix(200))")
        }
        let clean = lines.dropFirst().allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty }
        return (head, clean)
    }

    // MARK: The record

    func readUpdateRecord() -> UpdateRecord? {
        guard let data = try? Data(contentsOf: Paths.updateRecord) else { return nil }
        do {
            return try JSONDecoder().decode(UpdateRecord.self, from: data)
        } catch {
            // Treat an unreadable record as one that cannot be settled here.
            appLog("update record unreadable: \(error)")
            return UpdateRecord(previousDigest: "?", candidateDigest: "?", boxHead: "?", startedAt: Date())
        }
    }

    private func writeUpdateRecord(_ record: UpdateRecord) throws {
        try JSONEncoder().encode(record).write(to: Paths.updateRecord, options: .atomic)
    }

    private func removeUpdateRecord() throws {
        if FileManager.default.fileExists(atPath: Paths.updateRecord.path) {
            try FileManager.default.removeItem(at: Paths.updateRecord)
        }
    }
}

/// Collects a process's stdout while also appending it to the box log.
final class CaptureWriter: Writer, @unchecked Sendable {
    private let also: LogWriter
    private let lock = NSLock()
    private var buffer = Data()

    init(also: LogWriter) { self.also = also }

    var text: String { lock.withLock { String(decoding: buffer, as: UTF8.self) } }

    func write(_ data: Data) throws {
        lock.withLock { buffer.append(data) }
        try also.write(data)
    }

    func close() throws {}
}
