import Combine
import Foundation

enum QuickChatOrigin: String, Codable, Sendable {
    case typed
    case voice
    case external
}

/// A quick chat message the phone has not yet handed to the server. Its `id`
/// is the message id the server's record will carry, so a repeated submit of
/// one entry returns one record.
struct QuickChatOutboxEntry: Codable, Equatable, Identifiable, Sendable {
    var id: UUID
    var boxID: UUID
    var text: String
    /// How the person entered the thought; distinct from the webview emission vocabulary.
    var origin: QuickChatOrigin
    var source: String? = nil
    var createdAt: Date
    var attempts: Int
    var lastAttemptAt: Date?

    private enum CodingKeys: String, CodingKey {
        case id, boxID, text, origin, source, createdAt, attempts, lastAttemptAt
    }
}

extension QuickChatOutboxEntry {
    /// An entry stored before `origin` existed was typed.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        boxID = try container.decode(UUID.self, forKey: .boxID)
        text = try container.decode(String.self, forKey: .text)
        origin = try container.decodeIfPresent(QuickChatOrigin.self, forKey: .origin) ?? .typed
        source = try container.decodeIfPresent(String.self, forKey: .source)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        attempts = try container.decode(Int.self, forKey: .attempts)
        lastAttemptAt = try container.decodeIfPresent(Date.self, forKey: .lastAttemptAt)
    }
}

struct QuickChatOutboxManifest: Codable, Equatable, Sendable {
    static let currentVersion = 1

    var version: Int
    var entries: [QuickChatOutboxEntry]

    init(entries: [QuickChatOutboxEntry]) {
        version = Self.currentVersion
        self.entries = entries
    }
}

/// Quick chat messages waiting for the server, for every paired box.
///
/// An entry leaves the outbox only when `submit` returns, which means the
/// server returned a record for its id. A failed attempt keeps it and retries
/// on the backoff schedule while the app is in the foreground, and once on
/// each launch. After `retryWindow` it stops and reads "Not sent" until the
/// person retries or discards it. An entry has no server record, so nothing
/// was delivered and a late retry cannot post twice.
@MainActor
final class QuickChatOutbox: ObservableObject {
    typealias Submit = @MainActor (QuickChatOutboxEntry) async throws -> Void

    enum Status: Equatable {
        case sending
        case waiting(nextAttemptAt: Date)
        case notSent
    }

    static let retryWindow: TimeInterval = 7 * 24 * 60 * 60
    /// The wait after the Nth failed attempt; the last step repeats.
    static let backoff: [TimeInterval] = [10, 30, 2 * 60, 10 * 60, 30 * 60, 60 * 60]

    @Published private(set) var entries: [QuickChatOutboxEntry] = []
    @Published private(set) var isLoaded = false
    @Published private(set) var notice: String?
    @Published private(set) var inFlight: Set<UUID> = []

    private let repository: ComposerDraftRepository
    private let submit: Submit
    private let now: () -> Date
    /// Entries whose stop has been logged, so the log carries one line per stop.
    private var stopLoggedIDs: Set<UUID> = []
    private var restoreFailed = false

    init(
        repository: ComposerDraftRepository,
        now: @escaping () -> Date = Date.init,
        submit: @escaping Submit
    ) {
        self.repository = repository
        self.now = now
        self.submit = submit
    }

    func entries(for boxID: UUID) -> [QuickChatOutboxEntry] {
        entries.filter { $0.boxID == boxID }
    }

    func status(of entry: QuickChatOutboxEntry) -> Status {
        if inFlight.contains(entry.id) {
            return .sending
        }
        if isStopped(entry) {
            return .notSent
        }
        return .waiting(nextAttemptAt: nextAttemptAt(entry))
    }

    /// Restore the stored entries and make the launch attempt for each one
    /// still inside its retry window.
    func load() async {
        await restore()
        for entry in entries where isStopped(entry) == false {
            await attempt(entry.id)
        }
    }

    /// Restore durable entries without attempting any network delivery. App Intents
    /// use this before appending so they cannot overwrite older offline entries.
    func restore() async {
        guard isLoaded == false else {
            return
        }
        do {
            entries = try await repository.loadQuickChatOutbox()
        } catch {
            entries = []
            restoreFailed = true
            notice = "Unsent quick chat messages could not be restored."
            BoxLog.error("quick chat outbox restore failed error=\(type(of: error))", category: .composer)
        }
        isLoaded = true
        logStops()
    }

    /// Store a new thought, then make the first attempt. The entry is on disk
    /// before any request starts.
    @discardableResult
    func add(text: String, origin: QuickChatOrigin, source: String? = nil, boxID: UUID) async -> QuickChatOutboxEntry? {
        guard let entry = await store(text: text, origin: origin, source: source, boxID: boxID) else {
            return nil
        }
        await attempt(entry.id)
        return entry
    }

    /// Store a new thought without attempting it. Returns nil when it could not
    /// be written, so the caller keeps its own copy.
    func store(text: String, origin: QuickChatOrigin, source: String? = nil, boxID: UUID) async -> QuickChatOutboxEntry? {
        guard isLoaded, restoreFailed == false else { return nil }
        let entry = QuickChatOutboxEntry(
            id: UUID(),
            boxID: boxID,
            text: text,
            origin: origin,
            source: source,
            createdAt: now(),
            attempts: 0,
            lastAttemptAt: nil
        )
        entries.append(entry)
        guard await persist() else {
            entries.removeAll { $0.id == entry.id }
            return nil
        }
        return entry
    }

    /// Drop the entries of boxes that are no longer paired. Called when a box
    /// is removed; an unpaired box's entries are never removed earlier.
    func forgetBoxes(except pairedBoxIDs: Set<UUID>) async {
        let removed = entries.filter { pairedBoxIDs.contains($0.boxID) == false }
        guard removed.isEmpty == false else {
            return
        }
        entries.removeAll { pairedBoxIDs.contains($0.boxID) == false }
        await persist()
        BoxLog.info("quick chat outbox dropped entries of unpaired boxes count=\(removed.count)", category: .composer)
    }

    /// The person's Retry. Runs whatever the backoff or the retry window says.
    func retry(id: UUID) async {
        await attempt(id)
    }

    func discard(id: UUID) async {
        guard let entry = entries.first(where: { $0.id == id }) else {
            return
        }
        entries.removeAll { $0.id == id }
        await persist()
        BoxLog.info("quick chat outbox discarded attempts=\(entry.attempts)", category: .composer, targetBoxID: entry.boxID)
    }

    /// Attempt every entry whose backoff has passed. Returns when the next
    /// entry becomes due, or nil when nothing is waiting.
    @discardableResult
    func attemptDue() async -> Date? {
        logStops()
        let current = now()
        for entry in entries where isStopped(entry) == false && nextAttemptAt(entry) <= current {
            await attempt(entry.id)
        }
        return entries
            .filter { isStopped($0) == false && inFlight.contains($0.id) == false }
            .map(nextAttemptAt)
            .min()
    }

    /// Retry on the backoff schedule until cancelled. The host runs this while
    /// the app is in the foreground.
    func runRetries() async {
        while Task.isCancelled == false {
            guard let next = await attemptDue() else {
                return
            }
            let wait = max(1, next.timeIntervalSince(now()))
            do {
                try await Task.sleep(for: .seconds(wait))
            } catch {
                return
            }
        }
    }

    func nextAttemptAt(_ entry: QuickChatOutboxEntry) -> Date {
        guard let lastAttemptAt = entry.lastAttemptAt, entry.attempts > 0 else {
            return entry.createdAt
        }
        let step = min(entry.attempts, Self.backoff.count) - 1
        return lastAttemptAt.addingTimeInterval(Self.backoff[step])
    }

    func isStopped(_ entry: QuickChatOutboxEntry) -> Bool {
        now().timeIntervalSince(entry.createdAt) >= Self.retryWindow
    }

    private func attempt(_ id: UUID) async {
        guard inFlight.contains(id) == false,
              let entry = entries.first(where: { $0.id == id }) else {
            return
        }
        inFlight.insert(id)
        defer { inFlight.remove(id) }
        do {
            try await submit(entry)
        } catch {
            recordFailure(id: id, error: error)
            await persist()
            return
        }
        entries.removeAll { $0.id == id }
        await persist()
        if entry.attempts > 0 {
            BoxLog.info(
                "quick chat outbox accepted after attempts=\(entry.attempts + 1)",
                category: .composer,
                targetBoxID: entry.boxID
            )
        }
    }

    private func recordFailure(id: UUID, error: Error) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else {
            return
        }
        entries[index].attempts += 1
        entries[index].lastAttemptAt = now()
        let entry = entries[index]
        // One line per transition: the first failure here, the stop in `logStops`.
        if entry.attempts == 1 {
            BoxLog.warn(
                "quick chat outbox submit failed; retrying error=\(type(of: error))",
                category: .composer,
                targetBoxID: entry.boxID
            )
        }
    }

    private func logStops() {
        for entry in entries where isStopped(entry) && stopLoggedIDs.contains(entry.id) == false {
            stopLoggedIDs.insert(entry.id)
            BoxLog.warn(
                "quick chat outbox stopped retrying attempts=\(entry.attempts)",
                category: .composer,
                targetBoxID: entry.boxID
            )
        }
    }

    @discardableResult
    private func persist() async -> Bool {
        do {
            try await repository.saveQuickChatOutbox(entries)
            return true
        } catch {
            notice = "Quick chat messages could not be saved."
            BoxLog.error("quick chat outbox save failed error=\(type(of: error))", category: .composer)
            return false
        }
    }
}
