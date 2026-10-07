import XCTest
@testable import BeeBox

@MainActor
final class QuickChatOutboxTests: XCTestCase {
    /// Stands in for `quickChat.submit`: records each call and fails while
    /// `offline` is set, as a request with no signal does.
    private final class FakeServer {
        var offline = false
        var calls: [QuickChatOutboxEntry] = []
        var storedDuringCall: [[QuickChatOutboxEntry]] = []
        var repository: ComposerDraftRepository?

        func submit(_ entry: QuickChatOutboxEntry) async throws {
            calls.append(entry)
            if let repository {
                storedDuringCall.append(try await repository.loadQuickChatOutbox())
            }
            if offline {
                throw URLError(.notConnectedToInternet)
            }
        }
    }

    private final class Clock {
        var now = Date(timeIntervalSince1970: 1_800_000_000)

        func advance(_ seconds: TimeInterval) {
            now = now.addingTimeInterval(seconds)
        }
    }

    private var rootURL: URL!
    private let boxA = UUID()
    private let boxB = UUID()

    override func setUpWithError() throws {
        rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: rootURL)
    }

    private func makeOutbox(
        _ server: FakeServer,
        clock: Clock,
        repository: ComposerDraftRepository? = nil
    ) -> (QuickChatOutbox, ComposerDraftRepository) {
        let repository = repository ?? ComposerDraftRepository(rootURL: rootURL)
        let outbox = QuickChatOutbox(repository: repository, now: { clock.now }) { entry in
            try await server.submit(entry)
        }
        return (outbox, repository)
    }

    func testAddStoresTheEntryBeforeSubmittingAndAcceptRemovesIt() async throws {
        let server = FakeServer()
        let clock = Clock()
        let (outbox, repository) = makeOutbox(server, clock: clock)
        server.repository = repository
        await outbox.load()

        let addedEntry = await outbox.add(text: "call the plumber", origin: .voice, boxID: boxA)

        let entry = try XCTUnwrap(addedEntry)

        XCTAssertEqual(server.calls.map(\.id), [entry.id])
        XCTAssertEqual(server.calls.first?.text, "call the plumber")
        XCTAssertEqual(server.calls.first?.origin, .voice)
        XCTAssertEqual(server.storedDuringCall.first?.map(\.id), [entry.id], "on disk before the request")
        XCTAssertEqual(entry.createdAt, clock.now)
        XCTAssertTrue(outbox.entries.isEmpty)
        let stored = try await repository.loadQuickChatOutbox()
        XCTAssertTrue(stored.isEmpty)
    }

    func testANetworkFailureKeepsTheEntryAndRetriesOnTheBackoff() async throws {
        let server = FakeServer()
        server.offline = true
        let clock = Clock()
        let (outbox, repository) = makeOutbox(server, clock: clock)
        await outbox.load()

        let addedEntry = await outbox.add(text: "no signal here", origin: .typed, boxID: boxA)
        let entry = try XCTUnwrap(addedEntry)
        let kept = try XCTUnwrap(outbox.entries.first)
        XCTAssertEqual(kept.id, entry.id)
        XCTAssertEqual(kept.attempts, 1)
        XCTAssertEqual(kept.lastAttemptAt, clock.now)
        XCTAssertEqual(outbox.status(of: kept), .waiting(nextAttemptAt: clock.now.addingTimeInterval(10)))
        let stored = try await repository.loadQuickChatOutbox()
        XCTAssertEqual(stored, [kept])

        clock.advance(5)
        let next = await outbox.attemptDue()
        XCTAssertEqual(server.calls.count, 1, "not due yet")
        XCTAssertEqual(next, kept.lastAttemptAt?.addingTimeInterval(10))

        clock.advance(5)
        await outbox.attemptDue()
        XCTAssertEqual(server.calls.count, 2)
        XCTAssertEqual(outbox.entries.first?.attempts, 2)

        server.offline = false
        clock.advance(30)
        let none = await outbox.attemptDue()
        XCTAssertEqual(server.calls.map(\.id), [entry.id, entry.id, entry.id], "every attempt keeps the id")
        XCTAssertTrue(outbox.entries.isEmpty)
        XCTAssertNil(none)
    }

    func testBackoffScheduleGrowsAndThenHolds() {
        let clock = Clock()
        let (outbox, _) = makeOutbox(FakeServer(), clock: clock)
        let last = clock.now
        func entry(attempts: Int) -> QuickChatOutboxEntry {
            QuickChatOutboxEntry(id: UUID(), boxID: boxA, text: "x", origin: .typed, createdAt: last, attempts: attempts,
                lastAttemptAt: attempts == 0 ? nil : last)
        }
        XCTAssertEqual(outbox.nextAttemptAt(entry(attempts: 0)), last)
        let waits = (1...8).map { outbox.nextAttemptAt(entry(attempts: $0)).timeIntervalSince(last) }
        XCTAssertEqual(waits, [10, 30, 120, 600, 1800, 3600, 3600, 3600])
    }

    func testRetriesStopAfterSevenDaysUntilThePersonRetriesOrDiscards() async throws {
        let server = FakeServer()
        server.offline = true
        let clock = Clock()
        let (outbox, repository) = makeOutbox(server, clock: clock)
        await outbox.load()
        let addedEntry = await outbox.add(text: "the long trip", origin: .typed, boxID: boxA)

        let entry = try XCTUnwrap(addedEntry)

        clock.advance(QuickChatOutbox.retryWindow - 1)
        await outbox.attemptDue()
        XCTAssertEqual(server.calls.count, 2)
        clock.advance(1)
        let stopped = try XCTUnwrap(outbox.entries.first)
        XCTAssertEqual(outbox.status(of: stopped), .notSent)
        let next = await outbox.attemptDue()
        XCTAssertNil(next)
        XCTAssertEqual(server.calls.count, 2, "no automatic attempt after the window")

        await outbox.retry(id: entry.id)
        XCTAssertEqual(server.calls.count, 3, "the person's Retry still runs")
        XCTAssertEqual(outbox.status(of: try XCTUnwrap(outbox.entries.first)), .notSent)

        await outbox.discard(id: entry.id)
        XCTAssertTrue(outbox.entries.isEmpty)
        let stored = try await repository.loadQuickChatOutbox()
        XCTAssertTrue(stored.isEmpty)
    }

    func testALateRetrySucceedsAndRemovesTheEntry() async throws {
        let server = FakeServer()
        server.offline = true
        let clock = Clock()
        let (outbox, _) = makeOutbox(server, clock: clock)
        await outbox.load()
        let addedEntry = await outbox.add(text: "late", origin: .typed, boxID: boxA)
        let entry = try XCTUnwrap(addedEntry)
        clock.advance(QuickChatOutbox.retryWindow + 60)

        server.offline = false
        await outbox.retry(id: entry.id)

        XCTAssertTrue(outbox.entries.isEmpty)
    }

    /// An entry stored by a build from before `origin` existed reads as typed;
    /// a stored origin survives the round trip.
    func testAnEntryStoredWithoutAnOriginReadsAsTyped() async throws {
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let spoken = QuickChatOutboxEntry(id: UUID(), boxID: boxA, text: "spoken", origin: .voice,
            createdAt: Date(timeIntervalSince1970: 1_800_000_000), attempts: 0, lastAttemptAt: nil)
        try await repository.saveQuickChatOutbox([spoken])
        let url = await repository.quickChatOutboxURL
        var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let stored = try XCTUnwrap((manifest["entries"] as? [[String: Any]])?.first)
        var legacy = stored
        legacy.removeValue(forKey: "origin")
        legacy["id"] = UUID().uuidString
        legacy["text"] = "typed before origins"
        manifest["entries"] = [stored, legacy]
        try JSONSerialization.data(withJSONObject: manifest).write(to: url)

        let restored = try await repository.loadQuickChatOutbox()

        XCTAssertEqual(restored.map(\.text), ["spoken", "typed before origins"])
        XCTAssertEqual(restored.map(\.origin), [.voice, .typed])
    }

    func testEntriesSurviveARestartAndTheLaunchAttemptsThemOnce() async throws {
        let server = FakeServer()
        server.offline = true
        let clock = Clock()
        let (first, repository) = makeOutbox(server, clock: clock)
        await first.load()
        let addedFresh = await first.add(text: "fresh", origin: .typed, boxID: boxA)
        let fresh = try XCTUnwrap(addedFresh)
        let addedOld = await first.add(text: "old", origin: .typed, boxID: boxA)
        let old = try XCTUnwrap(addedOld)
        // Age only the second one past the window.
        var entries = first.entries
        entries[1].createdAt = clock.now.addingTimeInterval(-QuickChatOutbox.retryWindow)
        try await repository.saveQuickChatOutbox(entries)
        server.calls = []

        let (relaunched, _) = makeOutbox(server, clock: clock, repository: repository)
        await relaunched.load()

        XCTAssertEqual(relaunched.entries.map(\.id), [fresh.id, old.id])
        XCTAssertEqual(server.calls.map(\.id), [fresh.id], "the launch attempt skips the stopped entry, ignoring backoff")
        XCTAssertEqual(relaunched.entries.first?.attempts, 2)

        server.offline = false
        let (again, _) = makeOutbox(server, clock: clock, repository: repository)
        await again.load()
        XCTAssertEqual(again.entries.map(\.id), [old.id])
    }

    func testEachEntryIsSentToItsOwnBox() async throws {
        let server = FakeServer()
        server.offline = true
        let clock = Clock()
        let (outbox, _) = makeOutbox(server, clock: clock)
        await outbox.load()

        let addedA = await outbox.add(text: "for box A", origin: .typed, boxID: boxA)
        let a = try XCTUnwrap(addedA)
        let addedB = await outbox.add(text: "for box B", origin: .typed, boxID: boxB)

        let b = try XCTUnwrap(addedB)

        XCTAssertEqual(outbox.entries(for: boxA).map(\.id), [a.id])
        XCTAssertEqual(outbox.entries(for: boxB).map(\.id), [b.id])
        server.offline = false
        server.calls = []
        clock.advance(10)
        await outbox.attemptDue()
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: server.calls.map { ($0.id, $0.boxID) }), [a.id: boxA, b.id: boxB])
        XCTAssertTrue(outbox.entries.isEmpty)
    }

    func testACorruptOutboxIsQuarantinedWithANotice() async throws {
        let server = FakeServer()
        let (outbox, repository) = makeOutbox(server, clock: Clock())
        let url = await repository.quickChatOutboxURL
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: url)

        await outbox.load()

        XCTAssertTrue(outbox.entries.isEmpty)
        XCTAssertNotNil(outbox.notice)
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }
}
