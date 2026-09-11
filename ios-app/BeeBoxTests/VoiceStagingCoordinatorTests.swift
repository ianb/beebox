import XCTest
@testable import BeeBox

final class VoiceStagingCoordinatorTests: XCTestCase {
    private var rootURL: URL!
    private var box: PairedBox!

    override func setUpWithError() throws {
        rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        box = PairedBox(
            id: UUID(),
            label: "Test box",
            baseURL: URL(string: "https://example.test/box-test")!,
            sessionID: "chat-1",
            authToken: "mobile-token",
            requiresDeviceUnlock: false
        )
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: rootURL)
        MockVoiceStagingURLProtocol.response = nil
    }

    func testUsesADistinctBackgroundIdentifierFromCapture() {
        XCTAssertEqual(
            VoiceStagingBackgroundSession.configuration().identifier,
            "app.beebox.ios.voice-staging-upload-v1"
        )
        XCTAssertNotEqual(VoiceStagingBackgroundSession.identifier, CaptureBackgroundSession.identifier)
    }

    func testBeginRecordingPersistsAndCreatesTheSessionInOrder() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let transport = StubTransport(statusCode: 200, body: Data(#"{"sessionId":"r","startedAt":"now"}"#.utf8))
        let coordinator = makeCoordinator(store: store, recorder: EventRecorder(), lifecycleTransport: transport)
        let recordingID = coordinator.beginRecording(boxID: box.id, targetSessionID: "chat-1")

        try await pollUntil {
            (try? await store.loadManifest(boxID: self.box.id, recordingID: recordingID))?.sessionCreation == .created
        }

        XCTAssertEqual(transport.lastRequest?.httpMethod, "POST")
        XCTAssertEqual(transport.lastRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer mobile-token")
    }

    func testChunkProducedUploadsOnlyOnceSessionIsCreated() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: box.id, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        // Session not yet created: chunkProduced must register the chunk but not upload it.
        MockVoiceStagingURLProtocol.response = .success(statusCode: 200, body: Data("{}".utf8))
        let coordinator = makeCoordinator(store: store, recorder: EventRecorder())
        let chunk = try await writeChunkFile(store: store, boxID: box.id, recordingID: recordingID, index: 1)
        coordinator.chunkProduced(boxID: box.id, recordingID: recordingID, chunk: chunk)
        try await pollUntil {
            (try? await store.loadManifest(boxID: self.box.id, recordingID: recordingID))?.chunks.isEmpty == false
        }
        var manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: box.id, recordingID: recordingID))
        XCTAssertEqual(manifest.chunks.first?.state, .local, "must not upload before the session is created")

        try await store.markSessionCreated(boxID: box.id, recordingID: recordingID)
        MockVoiceStagingURLProtocol.response = .success(statusCode: 200, body: Data("{}".utf8))
        let chunk2 = try await writeChunkFile(store: store, boxID: box.id, recordingID: recordingID, index: 2)
        coordinator.chunkProduced(boxID: box.id, recordingID: recordingID, chunk: chunk2)

        try await pollUntil {
            (try? await store.loadManifest(boxID: self.box.id, recordingID: recordingID))?
                .chunks.first(where: { $0.index == 2 })?.state == .uploaded
        }
        manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: box.id, recordingID: recordingID))
        XCTAssertEqual(manifest.chunks.first(where: { $0.index == 2 })?.state, .uploaded)
    }

    func testChunkUploadRetryableFailureReschedulesAndRetains() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: box.id, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        try await store.markSessionCreated(boxID: box.id, recordingID: recordingID)
        let chunk = try await writeChunkFile(store: store, boxID: box.id, recordingID: recordingID, index: 1)
        let candidate = VoiceStagingUploadCandidate(boxID: box.id, recordingID: recordingID, chunkIndex: 1)
        let metadata = try await store.markUploading(boxID: box.id, recordingID: recordingID, chunkIndex: 1, taskIdentifier: 7)
        let recorder = EventRecorder()
        let coordinator = VoiceStagingCoordinator(
            box: box,
            store: store,
            configuration: testConfiguration,
            sleep: { _ in throw CancellationError() },
            eventHandler: { recorder.record($0) }
        )

        await coordinator.handleCompletion(
            taskIdentifier: 7,
            metadata: metadata,
            response: nil,
            data: Data(),
            error: URLError(.notConnectedToInternet),
            bytesSent: 0
        )

        XCTAssertEqual(recorder.events.count, 1)
        guard case .chunkRetryScheduled(let recordedCandidate, _) = recorder.events.first else {
            return XCTFail("expected a retry-scheduled event")
        }
        XCTAssertEqual(recordedCandidate, candidate)
        let manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: box.id, recordingID: recordingID))
        XCTAssertEqual(manifest.chunks.first?.state, .local)
        XCTAssertTrue(FileManager.default.fileExists(atPath: chunk.url.path))
    }

    func testFinalizeSealsOnSuccess() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: box.id, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        let transport = StubTransport(statusCode: 200, body: Data(#"{"sessionId":"r","staged":true}"#.utf8))
        let coordinator = makeCoordinator(store: store, recorder: EventRecorder(), lifecycleTransport: transport)

        let outcome = await coordinator.finalize(boxID: box.id, recordingID: recordingID, chunkCount: 1, hq: nil)

        XCTAssertEqual(outcome, .sealed)
        let manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: box.id, recordingID: recordingID))
        XCTAssertEqual(manifest.finalize, .sealed)
    }

    /// A 409 `missing-chunks` finalize response — a gap the client can't fix
    /// by retrying the same call — must be terminal, not retried.
    func testFinalizeMissingChunksIsTerminal() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: box.id, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        let transport = StubTransport(
            statusCode: 409,
            body: Data(#"{"error":"Recording is missing chunks; it cannot be sealed","code":"missing-chunks"}"#.utf8)
        )
        let coordinator = makeCoordinator(store: store, recorder: EventRecorder(), lifecycleTransport: transport)

        let outcome = await coordinator.finalize(boxID: box.id, recordingID: recordingID, chunkCount: 3, hq: nil)

        guard case .terminal(let message) = outcome else {
            return XCTFail("expected a terminal outcome")
        }
        XCTAssertTrue(message.contains("missing chunks"))
        let manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: box.id, recordingID: recordingID))
        guard case .terminal = manifest.finalize else {
            return XCTFail("expected the manifest to record a terminal finalize state")
        }
    }

    func testFinalizeIsIdempotentOnRepeatSuccess() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: box.id, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        let transport = StubTransport(statusCode: 200, body: Data(#"{"sessionId":"r","staged":true}"#.utf8))
        let coordinator = makeCoordinator(store: store, recorder: EventRecorder(), lifecycleTransport: transport)

        let first = await coordinator.finalize(boxID: box.id, recordingID: recordingID, chunkCount: 1, hq: nil)
        let second = await coordinator.finalize(boxID: box.id, recordingID: recordingID, chunkCount: 1, hq: nil)

        XCTAssertEqual(first, .sealed)
        XCTAssertEqual(second, .sealed)
    }

    // MARK: - Helpers

    private var testConfiguration: URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockVoiceStagingURLProtocol.self]
        return configuration
    }

    private func makeCoordinator(
        store: VoiceStagingStore,
        recorder: EventRecorder,
        lifecycleTransport: any CaptureTransport = StubTransport()
    ) -> VoiceStagingCoordinator {
        VoiceStagingCoordinator(
            box: box,
            store: store,
            configuration: testConfiguration,
            lifecycleTransport: lifecycleTransport,
            eventHandler: { recorder.record($0) }
        )
    }

    /// Writes the chunk's payload to disk AND registers it in the manifest —
    /// the two steps `VoicePCMChunkWriter`'s `onChunk` callback and
    /// `VoiceStagingCoordinator.chunkProduced` normally do together.
    private func writeChunkFile(
        store: VoiceStagingStore,
        boxID: UUID,
        recordingID: VoiceRecordingID,
        index: Int
    ) async throws -> VoicePCMChunk {
        let filename = VoicePCMChunkWriter.chunkFilename(index)
        let bytes = Data(repeating: UInt8(index), count: 8)
        let dir = await store.directoryURL(boxID: boxID, recordingID: recordingID)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(filename)
        try bytes.write(to: url)
        _ = try await store.addChunk(
            boxID: boxID, recordingID: recordingID, index: index, filename: filename, byteCount: bytes.count
        )
        return VoicePCMChunk(index: index, url: url, byteCount: bytes.count)
    }

    private func pollUntil(
        timeout: TimeInterval = 2,
        _ condition: @escaping () async -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while await condition() == false {
            if Date() > deadline {
                XCTFail("condition did not become true before the timeout")
                return
            }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
    }
}

private final class EventRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private let observer: @Sendable (VoiceStagingEvent) -> Void
    private var recordedEvents: [VoiceStagingEvent] = []

    init(observer: @escaping @Sendable (VoiceStagingEvent) -> Void = { _ in }) {
        self.observer = observer
    }

    var events: [VoiceStagingEvent] {
        lock.withLock { recordedEvents }
    }

    func record(_ event: VoiceStagingEvent) {
        lock.withLock {
            recordedEvents.append(event)
        }
        observer(event)
    }
}

/// Stubs the two small JSON lifecycle calls (create, finalize) the way
/// `CaptureAPITests`' `StubCaptureTransport` does for capture — a fake
/// `CaptureTransport` rather than a real network round trip through
/// `URLProtocol`. Chunk uploads are separate (they run as background
/// `URLSessionTask`s against `MockVoiceStagingURLProtocol` below).
private final class StubTransport: CaptureTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var statusCode: Int
    private var body: Data
    private var storedLastRequest: URLRequest?

    var lastRequest: URLRequest? {
        lock.withLock { storedLastRequest }
    }

    init(statusCode: Int = 200, body: Data = Data("{}".utf8)) {
        self.statusCode = statusCode
        self.body = body
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let (statusCode, body) = lock.withLock {
            storedLastRequest = request
            return (self.statusCode, self.body)
        }
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "https://example.test")!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        return (body, response)
    }
}

private final class MockVoiceStagingURLProtocol: URLProtocol, @unchecked Sendable {
    enum Response {
        case success(statusCode: Int, body: Data)
    }

    private static let lock = NSLock()
    private static var storedResponse: Response?
    private static var storedRequest: URLRequest?

    static var response: Response? {
        get { lock.withLock { storedResponse } }
        set { lock.withLock { storedResponse = newValue } }
    }

    static var lastRequest: URLRequest? {
        lock.withLock { storedRequest }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        let response = Self.lock.withLock {
            Self.storedRequest = request
            return Self.storedResponse
        }
        guard case .success(let statusCode, let body) = response else {
            return
        }
        let http = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
