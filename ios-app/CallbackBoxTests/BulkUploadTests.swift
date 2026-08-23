import XCTest
@testable import CallbackBox

/// Covers the native bulk-upload client: request shaping against
/// `callback-box/docs/mobile-contract.md` §5.6, and the coordinator's bounded
/// queue / retry behaviour. The transport is stubbed, so these run anywhere;
/// the memory-and-payload properties they protect can only be *confirmed* on a
/// real device (see `docs/plans/chat-photo-batch-upload.md`).
final class BulkUploadTests: XCTestCase {
    // MARK: - The inline/batch threshold

    /// Mirrors `test/frontend/file-routing.doctest.md`'s photo cases. (The web
    /// rule also batches any set containing a non-image; the native composer's
    /// photo picker only ever hands this images, so there is nothing to mirror.)
    /// The two implementations cannot share code across the language boundary, so
    /// the tests are what catch a drift between them (mobile-contract §8).
    func testThresholdMatchesTheWebRule() {
        XCTAssertEqual(BulkPhotoThreshold.inlineLimit, 3)

        XCTAssertFalse(BulkPhotoThreshold.shouldBatch(existingInline: 0, incoming: 1))
        XCTAssertFalse(BulkPhotoThreshold.shouldBatch(existingInline: 0, incoming: 3))
        XCTAssertTrue(BulkPhotoThreshold.shouldBatch(existingInline: 0, incoming: 4))
        XCTAssertTrue(BulkPhotoThreshold.shouldBatch(existingInline: 0, incoming: 70))
    }

    /// Photos already in the composer count toward the limit, so the inline total
    /// stays bounded however many separate selections a user makes.
    func testThresholdCountsPhotosAlreadyInTheComposer() {
        XCTAssertFalse(BulkPhotoThreshold.shouldBatch(existingInline: 2, incoming: 1))
        XCTAssertTrue(BulkPhotoThreshold.shouldBatch(existingInline: 2, incoming: 2))
        XCTAssertTrue(BulkPhotoThreshold.shouldBatch(existingInline: 3, incoming: 1))
    }

    func testEmptySelectionNeverBatches() {
        XCTAssertFalse(BulkPhotoThreshold.shouldBatch(existingInline: 0, incoming: 0))
        XCTAssertFalse(BulkPhotoThreshold.shouldBatch(existingInline: 3, incoming: 0))
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
        let outcome = await coordinator.run(items: items, targetSessionID: "chat-1", note: { "camera roll" })

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

        let outcome = await coordinator.run(items: [makeItem(id: "a")], targetSessionID: "chat-1", note: { nil })

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

        let outcome = await coordinator.run(items: [makeItem(id: "a")], targetSessionID: "chat-1", note: { nil })

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
            note: { nil }
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
            note: { nil }
        )

        XCTAssertEqual(outcome, .delivered(uploaded: 2, failed: 0))
        XCTAssertEqual(transport.uploadCount, 1, "only the missing item should be re-sent")
    }

    // MARK: - Delivery confirmation

    /// A seal is a HAND-OFF, not a delivery. If the box later fails to deliver,
    /// the coordinator reports `.accepted` — not `.failed` — because the box now
    /// holds the bytes and the note and will surface the failure to the chat
    /// agent itself. Reporting `.failed` here would have this client mount its
    /// own recovery in parallel, and two recovery paths for one batch is how it
    /// gets delivered twice.
    func testFailedDeliveryAfterSealIsAHandOffNotAFailure() async {
        let transport = ScriptedTransport(uploadStatuses: Array(repeating: 200, count: 9))
        transport.postFinalizeStatus = Data(#"""
        {"sessionId":"s1","state":"failed:deliver","registered":[],"received":[]}
        """#.utf8)
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        let outcome = await coordinator.run(items: [makeItem(id: "a")], targetSessionID: "chat-1", note: { "keep me" })

        XCTAssertEqual(outcome, .accepted(uploaded: 1, failed: 0))
    }

    /// A batch that never sealed is a genuine failure: the box does not have it,
    /// so the caller must keep the user's text and let them try again.
    func testUnsealedBatchIsReportedAsFailure() async {
        let transport = ScriptedTransport(uploadStatuses: Array(repeating: 200, count: 9))
        transport.finalizeStatusCode = 503
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        let outcome = await coordinator.run(items: [makeItem(id: "a")], targetSessionID: "chat-1", note: { nil })

        guard case .failed = outcome else {
            return XCTFail("an unsealed batch must report failure, got \(outcome)")
        }
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

        let outcome = await coordinator.run(items: [makeItem(id: "a")], targetSessionID: "chat-1", note: { nil })
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
            note: { nil },
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
            note: { nil },
            importFailures: [BulkUploadAPI.FailedItem(id: nil, name: "photo-001", reason: "unreadable")]
        )

        XCTAssertEqual(outcome, .delivered(uploaded: 0, failed: 1))
        XCTAssertNotNil(transport.finalizeBody, "finalize must still be called")
    }

    /// The introduction is read at FINALIZE, not when the batch starts.
    ///
    /// This is the prod bug (estate, 2026-07-31): the note was captured the
    /// instant the picker closed, so only text typed BEFORE choosing photos could
    /// ever become the batch's introduction. The boxholder picked seven photos,
    /// typed a caption while they uploaded, and the batch shipped with no note at
    /// all — a feature whose premise is "the batch arrives introduced" that was
    /// nearly impossible to introduce.
    func testNoteIsReadAtFinalizeNotAtStart() async {
        let transport = ScriptedTransport(uploadStatuses: Array(repeating: 200, count: 9))
        let coordinator = BulkUploadCoordinator(
            api: BulkUploadAPI(box: makeBox(), transport: transport),
            sleep: { _ in }
        )

        // Stands in for the composer: empty when the batch starts, typed into
        // while the photos upload.
        let composer = ComposerStub()
        let outcome = await coordinator.run(
            items: (0..<3).map { makeItem(id: "p\($0)") },
            targetSessionID: "chat-1",
            note: { await composer.text }
        )
        XCTAssertEqual(outcome, .delivered(uploaded: 3, failed: 0))

        let finalized = transport.finalizeBody
        XCTAssertEqual(
            finalized?["note"] as? String,
            "typed while uploading",
            "the caption written during the upload must be the batch's introduction"
        )
    }

    // MARK: - Fold-in staging

    /// The extension must follow the actual mimetype. Naming HEIC/WebP bytes
    /// `.jpg` produces a client-claimed mimetype that contradicts the bytes — and
    /// the batch card explicitly tells the agent to trust the bytes when they
    /// disagree, so a wrong name becomes a wrong claim that outlives the upload.
    func testStagedExtensionFollowsTheMimeType() {
        XCTAssertEqual(BulkPhotoStaging.fileExtension(for: "image/png"), "png")
        XCTAssertEqual(BulkPhotoStaging.fileExtension(for: "image/heic"), "heic")
        XCTAssertEqual(BulkPhotoStaging.fileExtension(for: "image/HEIF"), "heic")
        XCTAssertEqual(BulkPhotoStaging.fileExtension(for: "image/webp"), "webp")
        XCTAssertEqual(BulkPhotoStaging.fileExtension(for: "image/jpeg"), "jpg")
        XCTAssertEqual(BulkPhotoStaging.fileExtension(for: "application/octet-stream"), "jpg")
    }

    /// Orphaned staged files are swept, so an interrupted batch doesn't leave
    /// copies in Caches forever — a retained batch has no persisted record, so
    /// anything present after a cold start is unreachable.
    func testDiscardOrphansClearsTheStagingRoot() throws {
        let root = BulkPhotoStaging.stagingRoot()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let stray = root.appendingPathComponent("stray-\(UUID().uuidString).jpg")
        try Data("bytes".utf8).write(to: stray)
        XCTAssertTrue(FileManager.default.fileExists(atPath: stray.path))

        BulkPhotoStaging.discardOrphans()

        XCTAssertFalse(FileManager.default.fileExists(atPath: stray.path))
    }

    /// A staged composer image round-trips its bytes, so folding an already-
    /// encoded photo into a batch doesn't corrupt or re-encode it.
    func testStagedComposerImageRoundTripsItsBytes() throws {
        let payload = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        let item = try XCTUnwrap(BulkPhotoStaging.stageComposerImage(
            data: payload,
            mimeType: "image/png",
            index: 0,
            uploadedAt: "2026-07-30T19:12:00.000Z"
        ))
        defer { BulkPhotoStaging.discard([item]) }

        XCTAssertEqual(item.size, payload.count)
        XCTAssertEqual(item.originalName, "pasted-image-001.png")
        XCTAssertEqual(try Data(contentsOf: item.fileURL), payload)
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

/// Stands in for the composer during a batch: it starts empty, and by the time
/// the coordinator asks for the note (at finalize) it holds what the user typed.
private actor ComposerStub {
    private var reads = 0
    var text: String? {
        get async {
            reads += 1
            // Any read at batch-start time would see nothing; the finalize-time
            // read sees the caption.
            return "typed while uploading"
        }
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
    /// Status code served for the finalize call itself (non-2xx = never sealed).
    var finalizeStatusCode = 200

    var uploadCount: Int { lock.withLock { uploads } }
    var finalizeBody: [String: Any]? { lock.withLock { capturedFinalize } }

    init(uploadStatuses: [Int]) {
        statuses = uploadStatuses
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let path = request.url?.path ?? ""
        if path.hasSuffix("/finalize") {
            let parsed = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let code = lock.withLock { () -> Int in capturedFinalize = parsed; return finalizeStatusCode }
            let body = code == 200
                ? Data(#"{"sessionId":"s1","staged":true}"#.utf8)
                : Data(#"{"error":"Chat runtime unavailable"}"#.utf8)
            return (body, HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: nil)!)
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
