import XCTest
@testable import CallbackBox

/// Covers the native bulk-upload client: request shaping against
/// `callback-box/docs/mobile-contract.md` §5.6, and the coordinator's bounded
/// queue / retry behaviour. The transport is stubbed, so these run anywhere;
/// the memory-and-payload properties they protect can only be *confirmed* on a
/// real device (see `docs/plans/chat-photo-batch-upload.md`).
final class BulkUploadTests: XCTestCase {
    // MARK: - The inline/batch threshold

    /// Mirrors `test/frontend/photo-batch-threshold.doctest.md` case for case.
    /// The two implementations cannot share code across the language boundary, so
    /// the tests are what catch a drift between them (mobile-contract §8).
    func testThresholdMatchesTheWebRule() {
        XCTAssertEqual(BulkPhotoThreshold.inlineLimit, 4)

        XCTAssertFalse(BulkPhotoThreshold.shouldBatch(existingInline: 0, incoming: 1))
        XCTAssertFalse(BulkPhotoThreshold.shouldBatch(existingInline: 0, incoming: 4))
        XCTAssertTrue(BulkPhotoThreshold.shouldBatch(existingInline: 0, incoming: 5))
        XCTAssertTrue(BulkPhotoThreshold.shouldBatch(existingInline: 0, incoming: 70))
    }

    /// Photos already in the composer count toward the limit, so the inline total
    /// stays bounded however many separate selections a user makes.
    func testThresholdCountsPhotosAlreadyInTheComposer() {
        XCTAssertFalse(BulkPhotoThreshold.shouldBatch(existingInline: 3, incoming: 1))
        XCTAssertTrue(BulkPhotoThreshold.shouldBatch(existingInline: 3, incoming: 2))
        XCTAssertTrue(BulkPhotoThreshold.shouldBatch(existingInline: 4, incoming: 1))
    }

    func testEmptySelectionNeverBatches() {
        XCTAssertFalse(BulkPhotoThreshold.shouldBatch(existingInline: 0, incoming: 0))
        XCTAssertFalse(BulkPhotoThreshold.shouldBatch(existingInline: 4, incoming: 0))
    }

    // MARK: - Request shaping

    func testCreateSessionRequestCarriesTargetAndRegistry() throws {
        let request = try makeAPI().createSessionRequest(
            targetSessionID: "chat-1",
            items: [BulkUploadAPI.Item(id: "a", name: "IMG_0001.jpg", size: 42, mimetype: "image/jpeg")]
        )

        XCTAssertEqual(request.url?.path, "/box/api/bulk/sessions")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        let body = try XCTUnwrap(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        XCTAssertEqual(body["targetSessionId"] as? String, "chat-1")
        let items = try XCTUnwrap(body["items"] as? [[String: Any]])
        XCTAssertEqual(items.first?["id"] as? String, "a")
        XCTAssertEqual(items.first?["name"] as? String, "IMG_0001.jpg")
    }

    /// The item body must be raw bytes with the `X-Upload-*` headers — a
    /// multipart body here would defeat the streaming-from-file property the
    /// whole batch depends on.
    func testUploadRequestIsRawOctetStreamWithUploadHeaders() {
        let request = makeAPI().uploadRequest(sessionID: "s1", item: makeItem(id: "a"))

        XCTAssertEqual(request.url?.path, "/box/api/bulk/sessions/s1/items/a/upload")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Upload-Filename"), "staged-a.jpg")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Upload-Original-Name"), "IMG_a.jpg")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Upload-Mime-Type"), "image/jpeg")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Upload-Uploaded-At"), "2026-07-30T19:12:00.000Z")
        // The bytes ride from the file, never as an in-memory body.
        XCTAssertNil(request.httpBody)
    }

    func testFinalizeCarriesTheBatchIntroduction() throws {
        let request = try makeAPI().finalizeRequest(
            sessionID: "s1",
            failedItems: [BulkUploadAPI.FailedItem(id: "b", name: "IMG_0002.jpg", reason: "network error")],
            note: "Receipts from the Tokyo trip"
        )

        XCTAssertEqual(request.url?.path, "/box/api/bulk/sessions/s1/finalize")
        let body = try XCTUnwrap(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        XCTAssertEqual(body["note"] as? String, "Receipts from the Tokyo trip")
        let failed = try XCTUnwrap(body["failedItems"] as? [[String: Any]])
        XCTAssertEqual(failed.first?["reason"] as? String, "network error")
    }

    /// An empty composer must produce a batch indistinguishable from one that
    /// never carried an introduction — matching the server's own normalization.
    func testBlankNoteIsOmittedEntirely() throws {
        for note in [nil, "", "   \n\t "] as [String?] {
            let request = try makeAPI().finalizeRequest(sessionID: "s1", failedItems: [], note: note)
            let body = try XCTUnwrap(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
            XCTAssertNil(body["note"], "note \(String(describing: note)) should be omitted")
        }
    }

    // MARK: - Response classification

    /// The upload route answers 409 for three different situations. Only
    /// back-pressure may be retried; a sealed batch or unregistered item is
    /// terminal and retrying would loop forever.
    func testConcurrencyBackPressureIsRetryableButSealedIsTerminal() throws {
        let url = URL(string: "https://example.test/box/api/bulk/sessions/s1/items/a/upload")!
        let conflict = HTTPURLResponse(url: url, statusCode: 409, httpVersion: nil, headerFields: nil)!

        let busy = BulkUploadAPI.classifyUploadResponse(
            conflict,
            data: Data(#"{"error":"Too many concurrent uploads for this batch; retry shortly"}"#.utf8)
        )
        guard case .retryable = busy else { return XCTFail("back-pressure should be retryable, got \(busy)") }

        let sealed = BulkUploadAPI.classifyUploadResponse(
            conflict,
            data: Data(#"{"error":"Session is sealed; uploads are only accepted while it is open"}"#.utf8)
        )
        guard case .rejected = sealed else { return XCTFail("a sealed batch should be terminal, got \(sealed)") }
    }

    // MARK: - The bounded queue

    /// The ceiling is the point: the box 409s above 8 concurrent streams per
    /// batch, and an iOS webview kills a fan-out of dozens. 70 photos must never
    /// produce more than `maxConcurrent` in-flight uploads.
    func testNeverExceedsMaxConcurrentAcrossALargeBatch() async {
        let transport = ConcurrencyProbeTransport()
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        let items = (0..<70).map { makeItem(id: "p\($0)") }
        let outcome = await coordinator.run(items: items, targetSessionID: "chat-1", note: "camera roll")

        XCTAssertEqual(outcome, .delivered(uploaded: 70, failed: 0))
        XCTAssertEqual(transport.uploadCount, 70, "every photo must be uploaded, none dropped")
        XCTAssertLessThanOrEqual(
            transport.peakConcurrent,
            BulkUploadCoordinator.maxConcurrent,
            "peak in-flight uploads exceeded the bound"
        )
    }

    /// A transient failure is retried; the batch does not lose the photo.
    func testRetriesATransientFailureAndStillDelivers() async {
        let transport = ScriptedTransport(uploadStatuses: [500, 200])
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        let outcome = await coordinator.run(items: [makeItem(id: "a")], targetSessionID: "chat-1", note: nil)

        XCTAssertEqual(outcome, .delivered(uploaded: 1, failed: 0))
        XCTAssertEqual(transport.uploadCount, 2, "the failed attempt should have been retried once")
    }

    /// An item that never lands is *named* at finalize rather than silently
    /// missing — the batch arrives honest about what it is short.
    func testExhaustedItemIsReportedAsFailedNotDropped() async {
        let transport = ScriptedTransport(uploadStatuses: [500, 500, 500])
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        let outcome = await coordinator.run(items: [makeItem(id: "a")], targetSessionID: "chat-1", note: nil)

        XCTAssertEqual(outcome, .delivered(uploaded: 0, failed: 1))
        XCTAssertEqual(transport.uploadCount, BulkUploadCoordinator.maxAttempts)
        let finalized = try? XCTUnwrap(transport.finalizeBody)
        XCTAssertEqual((finalized?["failedItems"] as? [[String: Any]])?.count, 1)
    }

    /// Even a wholly-failed batch is delivered, so the chat says what happened.
    /// Showing nothing is the bug this replaces.
    func testWhollyFailedBatchStillFinalizes() async {
        let transport = ScriptedTransport(uploadStatuses: Array(repeating: 500, count: 99))
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        let outcome = await coordinator.run(
            items: [makeItem(id: "a"), makeItem(id: "b")],
            targetSessionID: "chat-1",
            note: nil
        )

        XCTAssertEqual(outcome, .delivered(uploaded: 0, failed: 2))
        XCTAssertNotNil(transport.finalizeBody, "finalize must still be called")
    }

    /// A relaunched uploader asks what the box already holds and sends only the
    /// rest, so an interrupted batch neither loses photos nor duplicates them.
    func testResumeSkipsWhatTheBoxAlreadyHas() async {
        let transport = ScriptedTransport(uploadStatuses: Array(repeating: 200, count: 99))
        transport.statusResponse = Data(#"""
        {"sessionId":"s1","state":"open","targetSessionId":"chat-1",
         "registered":[{"id":"a","name":"a.jpg"},{"id":"b","name":"b.jpg"}],
         "received":[{"itemId":"a","name":"a.jpg","size":4}]}
        """#.utf8)
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        let outcome = await coordinator.resume(
            items: [makeItem(id: "a"), makeItem(id: "b")],
            sessionID: "s1",
            targetSessionID: "chat-1",
            note: nil
        )

        XCTAssertEqual(outcome, .delivered(uploaded: 2, failed: 0))
        XCTAssertEqual(transport.uploadCount, 1, "only the missing item should be re-sent")
    }

    // MARK: - Delivery confirmation

    /// A seal is not a delivery. If the box later fails to prepare/deliver, the
    /// coordinator must report failure so the caller keeps the photos and the
    /// composer text — reporting success there is the original bug in a new
    /// place.
    func testFailedDeliveryAfterSealIsReportedAsFailure() async {
        let transport = ScriptedTransport(uploadStatuses: Array(repeating: 200, count: 9))
        transport.postFinalizeStatus = Data(#"""
        {"sessionId":"s1","state":"failed:deliver","registered":[],"received":[]}
        """#.utf8)
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        let outcome = await coordinator.run(items: [makeItem(id: "a")], targetSessionID: "chat-1", note: "keep me")

        guard case .failed(let message) = outcome else {
            return XCTFail("a batch the box could not deliver must not report success, got \(outcome)")
        }
        XCTAssertTrue(message.contains("kept"), "the message should tell the user nothing was lost: \(message)")
    }

    /// Staging is torn down only after a delivered batch, so a 404 on the poll
    /// means delivered, not lost.
    func testMissingSessionAfterSealCountsAsDelivered() async {
        let transport = ScriptedTransport(uploadStatuses: Array(repeating: 200, count: 9))
        transport.postFinalizeStatusCode = 404
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        let outcome = await coordinator.run(items: [makeItem(id: "a")], targetSessionID: "chat-1", note: nil)
        XCTAssertEqual(outcome, .delivered(uploaded: 1, failed: 0))
    }

    /// A photo that failed to IMPORT never reaches the uploader, so without
    /// explicit reporting the batch card would simply not mention it — the user
    /// would be told "N uploaded" with no sign the missing one ever existed.
    func testImportFailuresAreReportedToTheBox() async {
        let transport = ScriptedTransport(uploadStatuses: Array(repeating: 200, count: 9))
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        let outcome = await coordinator.run(
            items: [makeItem(id: "a")],
            targetSessionID: "chat-1",
            note: nil,
            importFailures: [BulkUploadAPI.FailedItem(id: nil, name: "photo-002", reason: "iCloud fetch failed")]
        )

        XCTAssertEqual(outcome, .delivered(uploaded: 1, failed: 1))
        let finalized = transport.finalizeBody
        let failed = finalized?["failedItems"] as? [[String: Any]]
        XCTAssertEqual(failed?.count, 1)
        XCTAssertEqual(failed?.first?["name"] as? String, "photo-002")
    }

    /// A selection where every photo fails to import still tells the box, rather
    /// than silently doing nothing.
    func testWhollyFailedImportStillReportsToTheBox() async {
        let transport = ScriptedTransport(uploadStatuses: [])
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        let outcome = await coordinator.run(
            items: [],
            targetSessionID: "chat-1",
            note: nil,
            importFailures: [BulkUploadAPI.FailedItem(id: nil, name: "photo-001", reason: "unreadable")]
        )

        XCTAssertEqual(outcome, .delivered(uploaded: 0, failed: 1))
        XCTAssertNotNil(transport.finalizeBody, "finalize must still be called")
    }

    // MARK: - Helpers

    private func makeAPI() -> BulkUploadAPI {
        BulkUploadAPI(box: makeBox(), transport: ScriptedTransport(uploadStatuses: []))
    }

    private func makeBox() -> PairedBox {
        PairedBox(
            id: UUID(),
            label: "Test",
            baseURL: URL(string: "https://example.test/box")!,
            sessionID: nil,
            authToken: "secret",
            requiresDeviceUnlock: false
        )
    }

    private func makeItem(id: String) -> PreparedBulkItem {
        PreparedBulkItem(
            id: id,
            fileURL: URL(fileURLWithPath: "/dev/null"),
            stagedFilename: "staged-\(id).jpg",
            originalName: "IMG_\(id).jpg",
            mimeType: "image/jpeg",
            uploadedAt: "2026-07-30T19:12:00.000Z",
            size: 4
        )
    }
}

/// Records how many uploads are in flight simultaneously, so the bound can be
/// asserted rather than assumed.
private final class ConcurrencyProbeTransport: CaptureTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var inFlight = 0
    private var peak = 0
    private var uploads = 0

    var peakConcurrent: Int { lock.withLock { peak } }
    var uploadCount: Int { lock.withLock { uploads } }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        (Self.body(for: request), Self.ok(request))
    }

    func upload(_ request: URLRequest, fromFile fileURL: URL) async throws -> (Data, URLResponse) {
        lock.withLock {
            inFlight += 1
            uploads += 1
            peak = max(peak, inFlight)
        }
        // Yield so overlapping uploads actually interleave; without this the
        // workers could serialize and the peak would read as 1 regardless.
        await Task.yield()
        try? await Task.sleep(nanoseconds: 1_000_000)
        lock.withLock { inFlight -= 1 }
        return (Data(#"{"success":true}"#.utf8), Self.ok(request))
    }

    private static func ok(_ request: URLRequest) -> HTTPURLResponse {
        HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    }

    private static func body(for request: URLRequest) -> Data {
        if request.url?.lastPathComponent == "sessions" {
            return Data(#"{"sessionId":"s1","startedAt":"t","capabilities":{"acceptedUploadEncodings":["raw-body-v1"]}}"#.utf8)
        }
        // The delivery poll: report the batch as delivered so the coordinator
        // finishes rather than waiting out its timeout.
        if request.httpMethod == "GET" {
            return Data(#"{"sessionId":"s1","state":"delivered","registered":[],"received":[]}"#.utf8)
        }
        return Data(#"{"sessionId":"s1","staged":true}"#.utf8)
    }
}

/// Replays a scripted list of upload status codes and captures the finalize body.
private final class ScriptedTransport: CaptureTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var statuses: [Int]
    private var uploads = 0
    private var capturedFinalize: [String: Any]?

    var statusResponse: Data?
    /// Status body served for the delivery poll (after finalize).
    var postFinalizeStatus: Data?
    /// Status code served for the delivery poll (404 = staging already torn down).
    var postFinalizeStatusCode = 200

    var uploadCount: Int { lock.withLock { uploads } }
    var finalizeBody: [String: Any]? { lock.withLock { capturedFinalize } }

    init(uploadStatuses: [Int]) {
        statuses = uploadStatuses
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let path = request.url?.path ?? ""
        if path.hasSuffix("/finalize") {
            let parsed = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            lock.withLock { capturedFinalize = parsed }
            return (Data(#"{"sessionId":"s1","staged":true}"#.utf8), ok(request))
        }
        if request.httpMethod == "GET" {
            let (body, code) = lock.withLock { () -> (Data, Int) in
                // Before finalize this is a resume/status read; after it, the
                // delivery poll.
                if capturedFinalize == nil, let scripted = statusResponse {
                    return (scripted, 200)
                }
                let delivered = Data(#"{"sessionId":"s1","state":"delivered","registered":[],"received":[]}"#.utf8)
                return (postFinalizeStatus ?? delivered, postFinalizeStatusCode)
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: nil)!
            return (body, response)
        }
        if path.hasSuffix("/sessions") {
            return (
                Data(#"{"sessionId":"s1","startedAt":"t","capabilities":{"acceptedUploadEncodings":["raw-body-v1"]}}"#.utf8),
                ok(request)
            )
        }
        return (Data(#"{"registered":1}"#.utf8), ok(request))
    }

    func upload(_ request: URLRequest, fromFile fileURL: URL) async throws -> (Data, URLResponse) {
        let status = lock.withLock { () -> Int in
            uploads += 1
            return statuses.isEmpty ? 200 : statuses.removeFirst()
        }
        let body = status == 200
            ? Data(#"{"success":true}"#.utf8)
            : Data(#"{"error":"upstream exploded"}"#.utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        return (body, response)
    }

    private func ok(_ request: URLRequest) -> HTTPURLResponse {
        HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    }
}
