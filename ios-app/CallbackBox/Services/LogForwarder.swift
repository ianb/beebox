import Foundation
import os

/// The levels that are forwarded. `info` never reaches the queue, so it has no
/// case here; the box's `debugLog.submit` accepts a wider enum for the web.
enum BoxLogLevel: String, Codable, Sendable {
    case error
    case warn
}

/// One queued log line. The `id` is what makes acknowledgement safe: actors are
/// reentrant across `await`, so a flush that removed "the first N" entries after
/// its POST would delete lines recorded while it was in flight.
struct LogEntry: Codable, Equatable, Sendable, Identifiable {
    var id: UUID
    var at: Date
    var level: BoxLogLevel
    var category: BoxLogCategory
    var message: String
    var boxID: UUID
    /// Set only on the synthetic marker entry that reports a bounded queue
    /// dropping older lines. Markers coalesce: one per box, its count growing.
    var droppedCount: Int?

    init(
        id: UUID = UUID(),
        at: Date = Date(),
        level: BoxLogLevel,
        category: BoxLogCategory,
        message: String,
        boxID: UUID,
        droppedCount: Int? = nil
    ) {
        self.id = id
        self.at = at
        self.level = level
        self.category = category
        self.message = message
        self.boxID = boxID
        self.droppedCount = droppedCount
    }
}

protocol LogTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

struct URLSessionLogTransport: LogTransport {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await URLSession.shared.data(for: request)
    }
}

/// Persisted, bounded queue of native error/warn lines, flushed to each paired
/// box's `debugLog.submit`.
///
/// Persistence is the guarantee; the network flush is opportunistic. Every
/// enqueue writes the whole (small) queue atomically before returning, so an
/// entry recorded through the awaitable tier survives a suspension, a kill, or
/// a crash and lands on the box at the next launch or foreground.
///
/// The forwarder never enqueues an entry about its own failures — that would be
/// a feedback loop with a network error as its clock. Transport problems are
/// visible in unified logging only.
actor LogForwarder {
    static let shared = LogForwarder()

    typealias Sleep = @Sendable (UInt64) async throws -> Void

    /// Bounds count real entries. A coalesced drop marker is exempt: it is the
    /// record that the bound did its job, and dropping it would make the loss
    /// silent — which is the one thing a bound must not be.
    static let perBoxLimit = 200
    static let globalLimit = 500
    /// Mirrored with the server caps in `debugLog.submit` (mobile-contract §8).
    /// Enforced here BEFORE persistence, so a conforming client can never make
    /// a batch the box has to reject for size.
    static let maxMessageLength = 4000
    static let maxBatchSize = 100
    static let debounceNanoseconds: UInt64 = 2_000_000_000

    private enum FlushOutcome {
        /// 2xx — the box holds these lines now.
        case acknowledged
        /// Network error, 5xx, 408, 429, anything else transient. No retry loop:
        /// forwarding must not become a second unreliable upload.
        case keep
        /// 400 — impossible from a conforming client, so it is a bug signal.
        case discardBatch
        /// 401/403 — a revoked device should stop writing to the box.
        case dropBox
    }

    private struct QueueManifest: Codable {
        static let currentVersion = 1

        var version: Int
        var entries: [LogEntry]

        init(entries: [LogEntry]) {
            version = Self.currentVersion
            self.entries = entries
        }
    }

    private struct WireEntry: Encodable {
        var level: String
        var message: String
        var at: String
    }

    private struct SubmitBody: Encodable {
        var source: String
        var entries: [WireEntry]
    }

    private static let log = Logger(subsystem: BoxLog.subsystem, category: "log-forwarder")

    private let storageURL: URL
    private let fileManager: FileManager
    private let transport: any LogTransport
    private let sleep: Sleep
    private let timestampFormatter: ISO8601DateFormatter
    private var entries: [LogEntry] = []
    private var boxes: [UUID: PairedBox] = [:]
    private var selectedBoxID: UUID?
    private var inFlightBoxes: Set<UUID> = []
    private var isActive = true
    private var debounceTask: Task<Void, Never>?

    init(
        storageURL: URL? = nil,
        fileManager: FileManager = .default,
        transport: any LogTransport = URLSessionLogTransport(),
        sleep: @escaping Sleep = { nanoseconds in try await Task.sleep(nanoseconds: nanoseconds) }
    ) {
        self.fileManager = fileManager
        self.storageURL = storageURL ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("log-forwarder", isDirectory: true)
            .appendingPathComponent("queue.json")
        self.transport = transport
        self.sleep = sleep
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        timestampFormatter = formatter
        entries = Self.loadEntries(url: self.storageURL, fileManager: fileManager)
    }

    // MARK: - Recording

    /// Persist an entry and return. This is the awaitable durability tier: when
    /// it returns, the entry is on disk.
    func record(_ entry: LogEntry) {
        var stored = entry
        stored.message = String(entry.message.prefix(Self.maxMessageLength))
        entries.append(stored)
        enforceBounds()
        persist()
        scheduleFlush()
    }

    func record(level: BoxLogLevel, category: BoxLogCategory, message: String, boxID: UUID) {
        record(LogEntry(level: level, category: category, message: message, boxID: boxID))
    }

    /// Record against the box the user is looking at. Used by `BoxLog`, whose
    /// call sites do not carry a box. With no box paired there is nowhere to
    /// forward to — the line stays in unified logging only.
    func record(level: BoxLogLevel, category: BoxLogCategory, message: String) {
        guard let boxID = selectedBoxID ?? boxes.keys.sorted(by: { $0.uuidString < $1.uuidString }).first else {
            return
        }
        record(level: level, category: category, message: message, boxID: boxID)
    }

    /// Returns once everything enqueued before this call is on disk. The actor's
    /// serialization does the work; the method exists so the background-URLSession
    /// completion path can state the guarantee it depends on.
    func awaitPersistence() {}

    func queuedEntries() -> [LogEntry] {
        entries
    }

    // MARK: - Lifecycle

    /// Track the paired boxes and which one untargeted entries belong to. Boxes
    /// that are gone take their queued entries with them — an unpaired (or
    /// re-paired, hence new-UUID) box must not keep an orphan queue.
    func updateBoxes(_ boxes: [PairedBox], selectedBoxID: UUID?) {
        self.boxes = Dictionary(uniqueKeysWithValues: boxes.map { ($0.id, $0) })
        self.selectedBoxID = selectedBoxID
        let known = Set(self.boxes.keys)
        let before = entries.count
        entries.removeAll { known.contains($0.boxID) == false }
        guard entries.count != before else {
            return
        }
        Self.log.notice("purged \(before - self.entries.count, privacy: .public) entries for unpaired boxes")
        persist()
    }

    /// Foreground state. The debounce only arms while active, because a network
    /// flush is a foreground affordance; backgrounded work relies on persistence
    /// plus the explicit best-effort flush the scene-phase hook makes.
    func setActive(_ active: Bool) {
        isActive = active
    }

    // MARK: - Flushing

    func flush() async {
        let pending = Set(entries.map(\.boxID)).sorted { $0.uuidString < $1.uuidString }
        for boxID in pending {
            await flushBox(boxID)
        }
    }

    private func flushBox(_ boxID: UUID) async {
        guard let box = boxes[boxID] else {
            return
        }
        // Actors are reentrant across the transport `await`, so overlapping
        // triggers would otherwise send the same batch twice.
        guard inFlightBoxes.contains(boxID) == false else {
            return
        }
        inFlightBoxes.insert(boxID)
        defer { inFlightBoxes.remove(boxID) }

        while true {
            let batch = Array(entries.filter { $0.boxID == boxID }.prefix(Self.maxBatchSize))
            guard batch.isEmpty == false else {
                return
            }
            switch await send(batch, box: box) {
            case .acknowledged:
                remove(ids: Set(batch.map(\.id)))
                persist()
            case .keep:
                return
            case .discardBatch:
                remove(ids: Set(batch.map(\.id)))
                persist()
                return
            case .dropBox:
                remove(ids: Set(entries.filter { $0.boxID == boxID }.map(\.id)))
                persist()
                return
            }
        }
    }

    private func send(_ batch: [LogEntry], box: PairedBox) async -> FlushOutcome {
        var request = BoxRequest.authenticated(
            url: box.apiURL.appendingPathComponent("trpc/debugLog.submit"),
            box: box
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = SubmitBody(source: "ios", entries: batch.map { wireEntry(for: $0) })
        do {
            request.httpBody = try JSONEncoder().encode(body)
        } catch {
            Self.log.fault("could not encode a log batch: \(error.localizedDescription, privacy: .public)")
            return .discardBatch
        }

        do {
            let (_, response) = try await transport.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                Self.log.error("log flush got a non-HTTP response")
                return .keep
            }
            return classify(statusCode: http.statusCode, box: box)
        } catch {
            Self.log.error("log flush failed: \(error.localizedDescription, privacy: .public)")
            return .keep
        }
    }

    private func classify(statusCode: Int, box: PairedBox) -> FlushOutcome {
        if (200..<300).contains(statusCode) {
            return .acknowledged
        }
        switch statusCode {
        case 400:
            Self.log.fault("the box rejected a log batch as malformed (400) — client bug")
            return .discardBatch
        case 401, 403:
            Self.log.notice("box \(box.id.uuidString, privacy: .public) refused this device; dropping its log queue")
            return .dropBox
        default:
            Self.log.error("log flush got HTTP \(statusCode, privacy: .public); keeping entries")
            return .keep
        }
    }

    private func wireEntry(for entry: LogEntry) -> WireEntry {
        let composed = "\(entry.category.rawValue): \(redacted(entry.message))"
        return WireEntry(
            level: entry.level.rawValue,
            message: String(composed.prefix(Self.maxMessageLength)),
            at: timestampFormatter.string(from: entry.at)
        )
    }

    /// Last line of defence before a message leaves the device: no paired box's
    /// device token may appear in it, however it got there.
    private func redacted(_ message: String) -> String {
        var result = message
        for token in boxes.values.compactMap(\.authToken) where token.isEmpty == false {
            result = result.replacingOccurrences(of: token, with: "[redacted-token]")
        }
        return result
    }

    private func remove(ids: Set<UUID>) {
        entries.removeAll { ids.contains($0.id) }
    }

    private func scheduleFlush() {
        guard isActive else {
            return
        }
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            guard let self else {
                return
            }
            await self.debouncedFlush()
        }
    }

    private func debouncedFlush() async {
        do {
            try await sleep(Self.debounceNanoseconds)
        } catch {
            return
        }
        guard Task.isCancelled == false else {
            return
        }
        await flush()
    }

    // MARK: - Bounds

    private func enforceBounds() {
        var dropped: [UUID: Int] = [:]
        for boxID in Set(entries.map(\.boxID)) {
            let indices = entries.indices.filter { entries[$0].boxID == boxID && entries[$0].droppedCount == nil }
            let excess = indices.count - Self.perBoxLimit
            guard excess > 0 else {
                continue
            }
            drop(indices: Set(indices.prefix(excess)), counting: &dropped)
        }

        let realIndices = entries.indices.filter { entries[$0].droppedCount == nil }
        let globalExcess = realIndices.count - Self.globalLimit
        if globalExcess > 0 {
            drop(indices: Set(realIndices.prefix(globalExcess)), counting: &dropped)
        }

        for (boxID, count) in dropped.sorted(by: { $0.key.uuidString < $1.key.uuidString }) {
            noteDrops(count, boxID: boxID)
        }
    }

    private func drop(indices: Set<Int>, counting dropped: inout [UUID: Int]) {
        for index in indices {
            dropped[entries[index].boxID, default: 0] += 1
        }
        entries = entries.enumerated()
            .filter { indices.contains($0.offset) == false }
            .map(\.element)
    }

    private func noteDrops(_ count: Int, boxID: UUID) {
        if let index = entries.lastIndex(where: { $0.boxID == boxID && $0.droppedCount != nil }) {
            let total = (entries[index].droppedCount ?? 0) + count
            entries[index].droppedCount = total
            entries[index].message = Self.dropMessage(total)
            return
        }
        entries.append(LogEntry(
            level: .warn,
            category: .net,
            message: Self.dropMessage(count),
            boxID: boxID,
            droppedCount: count
        ))
    }

    private static func dropMessage(_ count: Int) -> String {
        "log queue overflowed; dropped \(count) older entries"
    }

    // MARK: - Persistence

    private static func loadEntries(url: URL, fileManager: FileManager) -> [LogEntry] {
        guard fileManager.fileExists(atPath: url.path) else {
            return []
        }
        do {
            let manifest = try JSONDecoder().decode(QueueManifest.self, from: Data(contentsOf: url))
            guard manifest.version == QueueManifest.currentVersion else {
                log.error("log queue has unsupported version \(manifest.version, privacy: .public); resetting")
                return []
            }
            return manifest.entries
        } catch {
            log.error("log queue is unreadable, resetting: \(error.localizedDescription, privacy: .public)")
            return []
        }
    }

    private func persist() {
        do {
            try fileManager.createDirectory(
                at: storageURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try JSONEncoder().encode(QueueManifest(entries: entries)).write(to: storageURL, options: .atomic)
        } catch {
            // Never forwarded: a persistence failure that enqueued an entry
            // would try to persist again to report it.
            Self.log.error("could not persist the log queue: \(error.localizedDescription, privacy: .public)")
        }
    }
}
