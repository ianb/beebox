import XCTest
@testable import CallbackBox

/// Covers the native log forwarder: its bounded persisted queue, its
/// single-in-flight-batch flush, and how it classifies what the box answers.
/// The transport and the debounce clock are both injected, so nothing here
/// waits on wall time or a network.
final class LogForwarderTests: XCTestCase {
    private var root: URL!
    private var box: PairedBox!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("log-forwarder-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        box = makeBox(authToken: "device-token")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    // MARK: - Debounce

    /// A burst of failures must produce one POST, not one per line: the
    /// debounce is cancel-and-replace, so only the last scheduled flush runs.
    func testDebounceCoalescesABurstIntoOneFlush() async {
        let clock = Gate()
        let transport = StubLogTransport()
        let flushed = expectation(description: "exactly one flush")
        transport.onSend = { flushed.fulfill() }
        let forwarder = makeForwarder(transport: transport, sleep: { _ in await clock.wait() })
        await forwarder.updateBoxes([box], selectedBoxID: box.id)

        for index in 0..<3 {
            await forwarder.record(makeEntry(message: "e\(index)"))
        }
        await clock.open()

        await fulfillment(of: [flushed], timeout: 5)
        XCTAssertEqual(transport.requestCount, 1)
        XCTAssertEqual(transport.batches.first?.count, 3, "the whole burst should ride in one batch")
    }

    // MARK: - Bounds

    /// The per-box bound drops the oldest lines and says so once. A marker per
    /// drop event would itself become the error storm it is reporting.
    func testPerBoxBoundDropsOldestAndCoalescesOneMarker() async {
        let forwarder = makeForwarder()

        for index in 0..<250 {
            await forwarder.record(makeEntry(message: "e\(index)"))
        }

        let queued = await forwarder.queuedEntries()
        let real = queued.filter { $0.droppedCount == nil }
        XCTAssertEqual(real.count, LogForwarder.perBoxLimit)
        XCTAssertEqual(real.first?.message, "e50", "the oldest lines are the ones dropped")
        let markers = queued.filter { $0.droppedCount != nil }
        XCTAssertEqual(markers.count, 1, "drop markers must coalesce, not stack")
        XCTAssertEqual(markers.first?.droppedCount, 50)
        XCTAssertEqual(markers.first?.level, .warn)
    }

    /// The bound runs while a flush is suspended in its POST. Evicting from the
    /// batch that POST is carrying would delete lines the box then answers
    /// `.keep` for — gone despite "keep".
    func testTheBoundNeverEvictsTheBatchAPostIsCarrying() async {
        let gate = Gate()
        let transport = StubLogTransport(statuses: [500], gate: gate)
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)
        for index in 0..<100 {
            await forwarder.record(makeEntry(message: "inflight\(index)"))
        }

        let flush = Task { await forwarder.flush() }
        await waitUntil { await gate.arrivals == 1 }
        // Fill past the per-box bound while the POST is suspended.
        for index in 0..<200 {
            await forwarder.record(makeEntry(message: "later\(index)"))
        }
        await gate.open()
        await flush.value

        let queued = await forwarder.queuedEntries()
        let real = queued.filter { $0.droppedCount == nil }
        XCTAssertEqual(real.count, LogForwarder.perBoxLimit)
        XCTAssertEqual(
            real.filter { $0.message.hasPrefix("inflight") }.count,
            100,
            "HTTP 500 said keep, so every in-flight entry must still be here"
        )
        XCTAssertEqual(real.filter { $0.message.hasPrefix("later") }.first?.message, "later100")
    }

    /// Several boxes each under the per-box bound can still exceed the global
    /// one; the global trim is what keeps the file small.
    func testGlobalBoundTrimsAcrossBoxes() async {
        let forwarder = makeForwarder()
        let boxes = (0..<3).map { _ in makeBox(authToken: nil) }

        for box in boxes {
            for index in 0..<200 {
                await forwarder.record(makeEntry(message: "e\(index)", boxID: box.id))
            }
        }

        let queued = await forwarder.queuedEntries()
        let real = queued.filter { $0.droppedCount == nil }
        XCTAssertEqual(real.count, LogForwarder.globalLimit)
        XCTAssertEqual(real.filter { $0.boxID == boxes[0].id }.count, 100, "the oldest box loses its oldest lines")
        let markers = queued.filter { $0.droppedCount != nil }
        XCTAssertEqual(markers.map(\.droppedCount), [100])
    }

    // MARK: - Persistence

    /// The whole point of the queue: a line recorded by a run that then died
    /// is still there for the next one.
    func testQueueSurvivesANewForwarderInstance() async {
        let first = makeForwarder()
        await first.record(makeEntry(message: "capture upload failed status=500"))

        let second = makeForwarder()
        let queued = await second.queuedEntries()
        XCTAssertEqual(queued.map(\.message), ["capture upload failed status=500"])
    }

    func testUnreadableQueueFileResetsToEmpty() async throws {
        try FileManager.default.createDirectory(
            at: storageURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data("this is not json".utf8).write(to: storageURL)

        let forwarder = makeForwarder()

        let queued = await forwarder.queuedEntries()
        XCTAssertTrue(queued.isEmpty)
    }

    /// Wire caps are enforced before persistence, so a batch can never be
    /// rejected for size by a box that is enforcing the same numbers.
    func testMessageIsTruncatedToTheWireCap() async {
        let transport = StubLogTransport()
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)

        await forwarder.record(makeEntry(message: String(repeating: "a", count: 5000)))
        await forwarder.flush()

        let stored = await forwarder.queuedEntries()
        XCTAssertTrue(stored.isEmpty)
        let sent = try? XCTUnwrap(transport.batches.first?.first?["message"] as? String)
        XCTAssertEqual(sent?.count, LogForwarder.maxMessageLength)
    }

    /// The server's cap counts UTF-16 code units, so a message of astral-plane
    /// characters is twice as long as its `Character` count suggests — truncating
    /// by characters would send 6000 units and 400 the whole batch.
    func testAstralMessageIsTruncatedByUTF16Units() async {
        let transport = StubLogTransport()
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)

        // The leading "a" puts the cap boundary in the middle of a surrogate pair.
        await forwarder.record(makeEntry(message: "a" + String(repeating: "😀", count: 3000)))
        await forwarder.flush()

        let sent = transport.batches.first?.first?["message"] as? String
        XCTAssertNotNil(sent)
        XCTAssertLessThanOrEqual(sent?.utf16.count ?? 0, LogForwarder.maxMessageLength)
        XCTAssertFalse(sent?.contains("\u{FFFD}") == true, "a surrogate pair must not be split")
    }

    func testStoredMessageIsTruncatedBeforeItIsPersisted() async {
        let forwarder = makeForwarder()

        await forwarder.record(makeEntry(message: String(repeating: "a", count: 5000)))

        let queued = await forwarder.queuedEntries()
        XCTAssertEqual(queued.first?.message.count, LogForwarder.maxMessageLength)
    }

    // MARK: - Flush shape

    /// The submitted body is pinned by the shared golden fixtures under
    /// `callback-box/test/mobile-contract/fixtures/debug-log-submit/`, which the
    /// TS side POSTs verbatim in `test/webapp/debug-log-submit.doctest.md`.
    /// Editing a fixture fails both suites until both catch up.
    func testFlushPostsTheFixtureWireShape() async throws {
        let fixtures = try MobileContractFixtures.load("debug-log-submit")
        XCTAssertFalse(fixtures.isEmpty, "no debug-log-submit fixtures found at \(MobileContractFixtures.root.path)")

        for (name, fixture) in fixtures {
            let input = try XCTUnwrap(fixture["input"] as? [[String: Any]], "\(name): input must be a list of entries")
            let expected = try XCTUnwrap(fixture["expected"] as? [String: Any], "\(name): expected must be an object")

            let transport = StubLogTransport()
            let forwarder = makeForwarder(transport: transport)
            await forwarder.updateBoxes([box], selectedBoxID: box.id)
            for entry in input {
                await forwarder.record(try makeEntry(from: entry, file: name))
            }

            await forwarder.flush()

            XCTAssertEqual(transport.lastRequest?.url?.path, "/box/api/trpc/debugLog.submit", name)
            XCTAssertEqual(transport.lastRequest?.httpMethod, "POST", name)
            XCTAssertEqual(transport.lastRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer device-token", name)
            XCTAssertEqual(transport.lastRequest?.value(forHTTPHeaderField: "User-Agent"), "CallbackBox-iOS/0.1", name)
            XCTAssertEqual(transport.lastRequest?.value(forHTTPHeaderField: "Content-Type"), "application/json", name)
            let body = try XCTUnwrap(transport.lastBody, name)
            XCTAssertEqual(
                try MobileContractFixtures.canonicalJSON(body),
                try MobileContractFixtures.canonicalJSON(expected),
                "\(name): the submitted body must match the fixture"
            )
            try? FileManager.default.removeItem(at: storageURL)
        }
    }

    /// More than one POST's worth of queue drains in batches rather than being
    /// sent as one oversized body.
    func testALargeQueueIsSentInBatches() async {
        let transport = StubLogTransport()
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)
        for index in 0..<150 {
            await forwarder.record(makeEntry(message: "e\(index)"))
        }

        await forwarder.flush()

        XCTAssertEqual(transport.requestCount, 2)
        XCTAssertEqual(transport.batches.map(\.count), [LogForwarder.maxBatchSize, 50])
        let queued = await forwarder.queuedEntries()
        XCTAssertTrue(queued.isEmpty)
    }

    /// Actors are reentrant across the transport `await`, so two triggers that
    /// overlap would otherwise send the same lines twice.
    func testOverlappingFlushesSendOneBatch() async {
        let gate = Gate()
        let transport = StubLogTransport(gate: gate)
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)
        await forwarder.record(makeEntry(message: "e0"))

        let first = Task { await forwarder.flush() }
        await waitUntil { await gate.arrivals == 1 }
        await forwarder.flush()
        await gate.open()
        await first.value

        XCTAssertEqual(transport.requestCount, 1)
    }

    /// A line recorded while the POST is in flight is neither acknowledged by
    /// that POST nor lost: the ack removes ids, not "the first N".
    func testEntryRecordedDuringAFlushIsSentAfterwards() async {
        let gate = Gate()
        let transport = StubLogTransport(gate: gate)
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)
        await forwarder.record(makeEntry(message: "before"))

        let flush = Task { await forwarder.flush() }
        await waitUntil { await gate.arrivals == 1 }
        await forwarder.record(makeEntry(message: "during"))
        await gate.open()
        await flush.value

        XCTAssertEqual(transport.requestCount, 2)
        XCTAssertEqual(transport.batches.map { $0.compactMap { $0["message"] as? String } }, [
            ["net: before"],
            ["net: during"],
        ])
        let queued = await forwarder.queuedEntries()
        XCTAssertTrue(queued.isEmpty)
    }

    // MARK: - Response classification

    /// Retryable answers keep everything and wait for the next trigger; a retry
    /// loop here would make forwarding a second unreliable upload.
    func testRetryableAnswersKeepTheQueue() async {
        for status in [500, 503, 408, 429] {
            let transport = StubLogTransport(statuses: [status])
            let forwarder = makeForwarder(transport: transport)
            await forwarder.updateBoxes([box], selectedBoxID: box.id)
            await forwarder.record(makeEntry(message: "e0"))

            await forwarder.flush()

            let queued = await forwarder.queuedEntries()
            XCTAssertEqual(queued.count, 1, "HTTP \(status) must keep the entry")
            XCTAssertEqual(transport.requestCount, 1, "HTTP \(status) must not retry in place")
            try? FileManager.default.removeItem(at: storageURL)
        }
    }

    func testNetworkFailureKeepsTheQueue() async {
        let transport = StubLogTransport()
        transport.failure = URLError(.notConnectedToInternet)
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)
        await forwarder.record(makeEntry(message: "e0"))

        await forwarder.flush()

        let queued = await forwarder.queuedEntries()
        XCTAssertEqual(queued.count, 1)
    }

    /// A revoked device stops writing to the box entirely rather than retrying
    /// a credential that will never work again.
    func testRevokedDeviceDropsThatBoxsQueue() async {
        for status in [401, 403] {
            let transport = StubLogTransport(statuses: [status])
            let forwarder = makeForwarder(transport: transport)
            await forwarder.updateBoxes([box], selectedBoxID: box.id)
            for index in 0..<3 {
                await forwarder.record(makeEntry(message: "e\(index)"))
            }

            await forwarder.flush()

            let queued = await forwarder.queuedEntries()
            XCTAssertTrue(queued.isEmpty, "HTTP \(status) must drop the whole queue for that box")
            XCTAssertEqual(transport.requestCount, 1)
            try? FileManager.default.removeItem(at: storageURL)
        }
    }

    /// Only the batch the box actually refused is dropped. A line recorded while
    /// that POST was in flight was never offered to the box, so the refusal says
    /// nothing about it — it waits for the next cycle.
    func testARevokedDeviceOnlyDropsTheAttemptedBatch() async {
        let gate = Gate()
        let transport = StubLogTransport(statuses: [401], gate: gate)
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)
        await forwarder.record(makeEntry(message: "before"))

        let flush = Task { await forwarder.flush() }
        await waitUntil { await gate.arrivals == 1 }
        await forwarder.record(makeEntry(message: "during"))
        await gate.open()
        await flush.value

        let queued = await forwarder.queuedEntries()
        XCTAssertEqual(queued.map(\.message), ["during"])
        XCTAssertEqual(transport.requestCount, 1, "the cycle stops after a refusal")
    }

    /// 400 is unreachable from a conforming client, so it is a bug signal, not
    /// something to keep re-sending.
    func testMalformedBatchIsDroppedRatherThanRetried() async {
        let transport = StubLogTransport(statuses: [400])
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)
        await forwarder.record(makeEntry(message: "e0"))

        await forwarder.flush()

        let queued = await forwarder.queuedEntries()
        XCTAssertTrue(queued.isEmpty)
        XCTAssertEqual(transport.requestCount, 1)
    }

    /// A flush failure must never become a forwarded entry — that entry would
    /// fail to forward too, with a network error for a clock.
    func testAFailedFlushEnqueuesNothingAboutItself() async {
        let transport = StubLogTransport()
        transport.failure = URLError(.timedOut)
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)
        await forwarder.record(makeEntry(message: "e0"))

        await forwarder.flush()
        await forwarder.flush()

        let queued = await forwarder.queuedEntries()
        XCTAssertEqual(queued.map(\.message), ["e0"])
    }

    // MARK: - Redaction and box map

    /// Last line of defence: a token that reached a message anyway does not
    /// leave the device.
    func testDeviceTokensAreRedactedBeforeSending() async {
        let transport = StubLogTransport()
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)
        await forwarder.record(makeEntry(message: "auth header was Bearer device-token"))

        await forwarder.flush()

        let sent = transport.batches.first?.first?["message"] as? String
        XCTAssertEqual(sent, "net: auth header was Bearer [redacted-token]")
        XCTAssertFalse(sent?.contains("device-token") == true)
    }

    /// Re-pairing keeps the box's UUID and replaces its token, so a queued
    /// message carrying the OLD token would no longer match anything the
    /// send-time pass knows about. Redaction at record time is what covers it.
    func testARotatedTokenCannotUnredactAnAlreadyQueuedEntry() async {
        let transport = StubLogTransport()
        let forwarder = makeForwarder(transport: transport)
        await forwarder.updateBoxes([box], selectedBoxID: box.id)
        await forwarder.record(makeEntry(message: "auth header was Bearer device-token"))

        var rotated = box!
        rotated.authToken = "rotated-token"
        await forwarder.updateBoxes([rotated], selectedBoxID: rotated.id)
        await forwarder.flush()

        let sent = transport.batches.first?.first?["message"] as? String
        XCTAssertEqual(sent, "net: auth header was Bearer [redacted-token]")
        XCTAssertFalse(sent?.contains("device-token") == true)
    }

    /// An unpaired (or re-paired, hence new-UUID) box must not leave an orphan
    /// queue behind that can never be delivered.
    func testUnpairingABoxPurgesItsEntries() async {
        let forwarder = makeForwarder()
        let other = makeBox(authToken: nil)
        await forwarder.record(makeEntry(message: "e0"))
        await forwarder.record(makeEntry(message: "e1", boxID: other.id))

        await forwarder.updateBoxes([other], selectedBoxID: other.id)

        let queued = await forwarder.queuedEntries()
        XCTAssertEqual(queued.map(\.message), ["e1"])
    }

    /// `BoxLog` call sites carry no box, so untargeted lines follow the box the
    /// user is looking at.
    func testUntargetedEntriesGoToTheSelectedBox() async {
        let forwarder = makeForwarder()
        let other = makeBox(authToken: nil)
        await forwarder.updateBoxes([box, other], selectedBoxID: other.id)

        await forwarder.record(level: .warn, category: .composer, message: "draft save failed")

        let queued = await forwarder.queuedEntries()
        XCTAssertEqual(queued.map(\.boxID), [other.id])
    }

    // MARK: - Helpers

    private var storageURL: URL {
        root.appendingPathComponent("queue.json")
    }

    private func makeForwarder(
        transport: any LogTransport = StubLogTransport(),
        sleep: @escaping LogForwarder.Sleep = { _ in try await Task.sleep(nanoseconds: 30_000_000_000) }
    ) -> LogForwarder {
        LogForwarder(storageURL: storageURL, transport: transport, sleep: sleep)
    }

    private func makeBox(authToken: String?) -> PairedBox {
        PairedBox(
            id: UUID(),
            label: "Test",
            baseURL: URL(string: "https://example.test/box")!,
            sessionID: nil,
            authToken: authToken,
            requiresDeviceUnlock: false
        )
    }

    /// One fixture entry as the app would have recorded it. The fixture's
    /// `message` is the raw call-site text; the `category:` prefix the wire
    /// carries is the forwarder's job, so it appears only in `expected`.
    private func makeEntry(from fixture: [String: Any], file: String) throws -> LogEntry {
        let rawLevel = try XCTUnwrap(fixture["level"] as? String, "\(file): entry needs a level")
        let rawCategory = try XCTUnwrap(fixture["category"] as? String, "\(file): entry needs a category")
        let rawAt = try XCTUnwrap(fixture["at"] as? String, "\(file): entry needs an at")
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return LogEntry(
            at: try XCTUnwrap(formatter.date(from: rawAt), "\(file): at must be an ISO-8601 instant"),
            level: try XCTUnwrap(BoxLogLevel(rawValue: rawLevel), "\(file): unknown level \(rawLevel)"),
            category: try XCTUnwrap(BoxLogCategory(rawValue: rawCategory), "\(file): unknown category \(rawCategory)"),
            message: try XCTUnwrap(fixture["message"] as? String, "\(file): entry needs a message"),
            boxID: box.id
        )
    }

    private func makeEntry(
        message: String,
        category: BoxLogCategory = .net,
        boxID: UUID? = nil
    ) -> LogEntry {
        LogEntry(
            level: .error,
            category: category,
            message: message,
            boxID: boxID ?? box.id
        )
    }

    /// Polls an actor-held condition instead of guessing at a sleep duration.
    private func waitUntil(
        _ condition: () async -> Bool,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        for _ in 0..<1000 {
            if await condition() {
                return
            }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTFail("condition never became true", file: file, line: line)
    }
}

/// A rendezvous the test opens when it wants suspended work to proceed. Stands
/// in for both the debounce clock and an in-flight POST, so overlap and
/// coalescing are asserted rather than timed.
private actor Gate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private(set) var arrivals = 0

    func wait() async {
        arrivals += 1
        guard isOpen == false else {
            return
        }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    func open() {
        isOpen = true
        let pending = waiters
        waiters.removeAll()
        pending.forEach { $0.resume() }
    }
}

/// Captures every submitted batch and replays scripted status codes.
private final class StubLogTransport: LogTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var statuses: [Int]
    private var requests: [URLRequest] = []
    private var bodies: [[String: Any]] = []
    private let gate: Gate?

    var failure: URLError?
    var onSend: (() -> Void)?

    init(statuses: [Int] = [], gate: Gate? = nil) {
        self.statuses = statuses
        self.gate = gate
    }

    var requestCount: Int { lock.withLock { requests.count } }
    var lastRequest: URLRequest? { lock.withLock { requests.last } }
    var lastBody: [String: Any]? { lock.withLock { bodies.last } }

    var batches: [[[String: Any]]] {
        lock.withLock {
            bodies.map { ($0["entries"] as? [[String: Any]]) ?? [] }
        }
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let body = request.httpBody.flatMap {
            try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
        }
        let status = lock.withLock { () -> Int in
            requests.append(request)
            if let body {
                bodies.append(body)
            }
            return statuses.isEmpty ? 200 : statuses.removeFirst()
        }
        onSend?()
        await gate?.wait()
        if let failure {
            throw failure
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: nil,
            headerFields: nil
        )!
        return (Data("{}".utf8), response)
    }
}
