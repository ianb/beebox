import XCTest
@testable import CallbackBox

final class CaptureUploadCoordinatorTests: XCTestCase {
    private var rootURL: URL!
    private var box: PairedBox!
    private let sessionID = CaptureSessionID(rawValue: "capture-upload-test")

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
        MockCaptureUploadURLProtocol.response = .success(statusCode: 200, body: Data("{}".utf8))
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: rootURL)
        MockCaptureUploadURLProtocol.response = nil
    }

    func testUsesStableBackgroundIdentifierAndForwardsCompletion() {
        XCTAssertEqual(
            CaptureBackgroundSession.configuration().identifier,
            "app.callbackbox.ios.capture-upload-v1"
        )
        let broker = CaptureBackgroundEvents()
        let completed = expectation(description: "background completion")
        broker.accept(identifier: CaptureBackgroundSession.identifier) {
            completed.fulfill()
        }
        broker.finish(identifier: CaptureBackgroundSession.identifier)
        wait(for: [completed], timeout: 1)
    }

    func testFileUploadAcknowledgesAndDeletesPayload() async throws {
        let (store, candidate, payloadURL) = try await makeLocalCandidate()
        let uploaded = expectation(description: "uploaded")
        let recorder = EventRecorder { event in
            if event == .uploaded(candidate) {
                uploaded.fulfill()
            }
        }
        let coordinator = makeCoordinator(store: store, recorder: recorder)

        try await coordinator.schedule(candidate)
        await fulfillment(of: [uploaded], timeout: 2)

        let loadedManifest = try await store.loadManifest(boxID: box.id, sessionID: sessionID)
        let manifest = try XCTUnwrap(loadedManifest)
        XCTAssertEqual(manifest.items.first?.state, .uploaded)
        XCTAssertFalse(FileManager.default.fileExists(atPath: payloadURL.path))
        XCTAssertEqual(MockCaptureUploadURLProtocol.lastRequest?.httpMethod, "POST")
        XCTAssertEqual(MockCaptureUploadURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer mobile-token")
    }

    func testSessionGoneSurfacesRecoveryAndRetainsPayload() async throws {
        let (store, candidate, payloadURL) = try await makeLocalCandidate()
        let metadata = try await store.markUploading(
            boxID: box.id,
            sessionID: sessionID,
            itemID: candidate.itemID,
            taskIdentifier: 42
        )
        let recorder = EventRecorder()
        let coordinator = makeCoordinator(store: store, recorder: recorder)
        let response = HTTPURLResponse(
            url: box.apiURL,
            statusCode: 404,
            httpVersion: nil,
            headerFields: nil
        )!

        await coordinator.handleCompletion(
            taskIdentifier: 42,
            metadata: metadata,
            response: response,
            data: Data(#"{"error":"Capture session is gone"}"#.utf8),
            error: nil,
            bytesSent: 0
        )

        XCTAssertEqual(recorder.events, [
            .failed(candidate, message: "Capture session is gone"),
            .recovery(.sessionGone(sessionID)),
        ])
        let loadedManifest = try await store.loadManifest(boxID: box.id, sessionID: sessionID)
        let manifest = try XCTUnwrap(loadedManifest)
        XCTAssertEqual(manifest.items.first?.state, .failed(message: "Capture session is gone"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: payloadURL.path))
    }

    func testAlreadySealedSurfacesRecoveryAndRetainsPayload() async throws {
        let (store, candidate, payloadURL) = try await makeLocalCandidate()
        let metadata = try await store.markUploading(
            boxID: box.id,
            sessionID: sessionID,
            itemID: candidate.itemID,
            taskIdentifier: 43
        )
        let recorder = EventRecorder()
        let coordinator = makeCoordinator(store: store, recorder: recorder)
        let response = HTTPURLResponse(
            url: box.apiURL,
            statusCode: 409,
            httpVersion: nil,
            headerFields: nil
        )!

        await coordinator.handleCompletion(
            taskIdentifier: 43,
            metadata: metadata,
            response: response,
            data: Data(#"{"error":"Capture session is already sealed"}"#.utf8),
            error: nil,
            bytesSent: 0
        )

        XCTAssertEqual(recorder.events, [
            .failed(candidate, message: "Capture session is already sealed"),
            .recovery(.alreadySealed(sessionID)),
        ])
        let loadedManifest = try await store.loadManifest(boxID: box.id, sessionID: sessionID)
        let manifest = try XCTUnwrap(loadedManifest)
        XCTAssertEqual(manifest.items.first?.state, .failed(message: "Capture session is already sealed"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: payloadURL.path))
    }

    func testRetryIsPersistedAndScheduledWithoutDroppingPayload() async throws {
        let (store, candidate, payloadURL) = try await makeLocalCandidate()
        let metadata = try await store.markUploading(
            boxID: box.id,
            sessionID: sessionID,
            itemID: candidate.itemID,
            taskIdentifier: 7
        )
        let recorder = EventRecorder()
        let coordinator = CaptureUploadCoordinator(
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

        XCTAssertEqual(recorder.events, [.retryScheduled(candidate, afterSeconds: 1)])
        let loadedManifest = try await store.loadManifest(boxID: box.id, sessionID: sessionID)
        let manifest = try XCTUnwrap(loadedManifest)
        XCTAssertEqual(manifest.items.first?.state, .local)
        XCTAssertTrue(FileManager.default.fileExists(atPath: payloadURL.path))
    }

    func testStartupReconcilesLocalCandidateAndUploadsIt() async throws {
        let (store, candidate, _) = try await makeLocalCandidate()
        let uploaded = expectation(description: "reconciled upload")
        let recorder = EventRecorder { event in
            if event == .uploaded(candidate) {
                uploaded.fulfill()
            }
        }
        let coordinator = makeCoordinator(store: store, recorder: recorder)

        try await coordinator.start()
        await fulfillment(of: [uploaded], timeout: 2)

        let loadedManifest = try await store.loadManifest(boxID: box.id, sessionID: sessionID)
        let manifest = try XCTUnwrap(loadedManifest)
        XCTAssertEqual(manifest.items.first?.state, .uploaded)
    }

    func testCancelSessionReturnsLiveUploadToLocalState() async throws {
        let (store, candidate, payloadURL) = try await makeLocalCandidate()
        MockCaptureUploadURLProtocol.response = .waitForCancellation
        let coordinator = makeCoordinator(store: store, recorder: EventRecorder())
        try await coordinator.schedule(candidate)

        await coordinator.cancel(boxID: box.id, sessionID: sessionID)

        let loadedManifest = try await store.loadManifest(boxID: box.id, sessionID: sessionID)
        let manifest = try XCTUnwrap(loadedManifest)
        XCTAssertEqual(manifest.items.first?.state, .local)
        XCTAssertTrue(FileManager.default.fileExists(atPath: payloadURL.path))
    }

    private var testConfiguration: URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockCaptureUploadURLProtocol.self]
        return configuration
    }

    private func makeCoordinator(store: CaptureStore, recorder: EventRecorder) -> CaptureUploadCoordinator {
        CaptureUploadCoordinator(
            box: box,
            store: store,
            configuration: testConfiguration,
            eventHandler: { recorder.record($0) }
        )
    }

    private func makeLocalCandidate() async throws -> (CaptureStore, CaptureUploadCandidate, URL) {
        let store = CaptureStore(rootURL: rootURL)
        _ = try await store.createManifest(
            boxID: box.id,
            sessionID: sessionID,
            targetSessionID: box.sessionID,
            startedAt: "2026-07-17T12:00:00Z"
        )
        let id = UUID()
        let item = CaptureItem(
            id: id,
            filename: CaptureFilename.file(id: id, originalName: "notes.txt"),
            kind: .file,
            capturedAt: "2026-07-17T12:00:00Z",
            source: "files",
            mimeType: "text/plain",
            originalName: "notes.txt",
            audioFormat: nil,
            segmentID: nil,
            segmentStartedAt: nil,
            state: .local,
            uploadGeneration: 0
        )
        let sourceURL = rootURL.appendingPathComponent("source.txt")
        try Data("payload".utf8).write(to: sourceURL)
        try await store.importPayload(from: sourceURL, boxID: box.id, sessionID: sessionID, item: item)
        let payloadURL = rootURL
            .appendingPathComponent(box.id.uuidString.lowercased(), isDirectory: true)
            .appendingPathComponent(sessionID.rawValue, isDirectory: true)
            .appendingPathComponent(item.filename)
        return (
            store,
            CaptureUploadCandidate(boxID: box.id, sessionID: sessionID, itemID: item.id),
            payloadURL
        )
    }
}

private final class EventRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private let observer: @Sendable (CaptureUploadEvent) -> Void
    private var recordedEvents: [CaptureUploadEvent] = []

    init(observer: @escaping @Sendable (CaptureUploadEvent) -> Void = { _ in }) {
        self.observer = observer
    }

    var events: [CaptureUploadEvent] {
        lock.withLock { recordedEvents }
    }

    func record(_ event: CaptureUploadEvent) {
        lock.withLock {
            recordedEvents.append(event)
        }
        observer(event)
    }
}

private final class MockCaptureUploadURLProtocol: URLProtocol, @unchecked Sendable {
    enum Response {
        case success(statusCode: Int, body: Data)
        case waitForCancellation
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
