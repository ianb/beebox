import XCTest
@testable import CallbackBox

final class CaptureStoreTests: XCTestCase {
    private var rootURL: URL!
    private var boxID: UUID!
    private let sessionID = CaptureSessionID(rawValue: "capture-test")

    override func setUpWithError() throws {
        rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        boxID = UUID()
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: rootURL)
    }

    func testManifestAtomicallyReloadsInFreshStore() async throws {
        let store = CaptureStore(rootURL: rootURL)
        let original = try await store.createManifest(
            boxID: boxID,
            sessionID: sessionID,
            targetSessionID: "chat-1",
            startedAt: "2026-07-17T12:00:00Z"
        )

        let reloaded = try await CaptureStore(rootURL: rootURL).loadManifest(boxID: boxID, sessionID: sessionID)
        XCTAssertEqual(reloaded, original)
        XCTAssertTrue(FileManager.default.fileExists(atPath: manifestURL.path))
        XCTAssertFalse(try directoryContainsAtomicTemporaryFile())
    }

    func testRecordingRowPrecedesPayloadAndClosesToLocal() async throws {
        let store = try await makeStore()
        let item = makeAudioItem(state: .recording)
        let payloadURL = try await store.beginItem(boxID: boxID, sessionID: sessionID, item: item)

        let persistedBeforeBytes = try await requiredManifest(store)
        XCTAssertEqual(persistedBeforeBytes.items.first?.state, .recording)
        try Data("audio".utf8).write(to: payloadURL)
        try await store.markRecordingClosed(boxID: boxID, sessionID: sessionID, itemID: item.id)

        let persisted = try await requiredManifest(store)
        XCTAssertEqual(persisted.items.first?.state, .local)
    }

    func testRelaunchMarksOpenRecordingVisibleButNotRetryable() async throws {
        let store = try await makeStore()
        let item = makeAudioItem(state: .recording)
        let payloadURL = try await store.beginItem(boxID: boxID, sessionID: sessionID, item: item)
        try Data("unfinished audio".utf8).write(to: payloadURL)

        let interrupted = try await store.markInterruptedRecordings(boxID: boxID, sessionID: sessionID)
        let retryCandidates = try await store.retryFailedUploads(boxID: boxID, sessionID: sessionID)

        XCTAssertEqual(interrupted, 1)
        XCTAssertTrue(retryCandidates.isEmpty)
        let manifest = try await requiredManifest(store)
        XCTAssertEqual(
            manifest.items.first?.state,
            .failed(message: CaptureStore.interruptedRecordingMessage)
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: payloadURL.path))
    }

    func testUploadAcknowledgementIsIdempotentAndDeletesPayload() async throws {
        let store = try await makeStore()
        let item = makeFileItem()
        let sourceURL = try sourceFile(contents: Data("payload".utf8))
        try await store.importPayload(from: sourceURL, boxID: boxID, sessionID: sessionID, item: item)
        let metadata = try await store.markUploading(
            boxID: boxID,
            sessionID: sessionID,
            itemID: item.id,
            taskIdentifier: 7
        )
        let payloadURL = sessionDirectory.appendingPathComponent(item.filename)

        let firstAcknowledgement = try await store.acknowledgeUpload(metadata: metadata, taskIdentifier: 7)
        XCTAssertTrue(firstAcknowledgement)
        XCTAssertFalse(FileManager.default.fileExists(atPath: payloadURL.path))
        let secondAcknowledgement = try await store.acknowledgeUpload(metadata: metadata, taskIdentifier: 7)
        XCTAssertTrue(secondAcknowledgement)
        let persisted = try await requiredManifest(store)
        XCTAssertEqual(persisted.items.first?.state, .uploaded)
    }

    func testStaleCompletionCannotAcknowledgeNewUploadGeneration() async throws {
        let store = try await makeStore()
        let item = makeFileItem()
        try await store.importPayload(
            from: sourceFile(contents: Data("payload".utf8)),
            boxID: boxID,
            sessionID: sessionID,
            item: item
        )
        let stale = try await store.markUploading(
            boxID: boxID,
            sessionID: sessionID,
            itemID: item.id,
            taskIdentifier: 1
        )
        try await store.transition(boxID: boxID, sessionID: sessionID, itemID: item.id, to: .local)
        let current = try await store.markUploading(
            boxID: boxID,
            sessionID: sessionID,
            itemID: item.id,
            taskIdentifier: 2
        )

        let staleAcknowledgement = try await store.acknowledgeUpload(metadata: stale, taskIdentifier: 1)
        let currentAcknowledgement = try await store.acknowledgeUpload(metadata: current, taskIdentifier: 2)
        XCTAssertFalse(staleAcknowledgement)
        XCTAssertTrue(currentAcknowledgement)
    }

    func testReconciliationKeepsLiveTaskAndRecoversMissingTask() async throws {
        let store = try await makeStore()
        let liveItem = makeFileItem()
        let missingItem = makeFileItem()
        try await importItem(liveItem, into: store)
        try await importItem(missingItem, into: store)
        let liveMetadata = try await store.markUploading(
            boxID: boxID,
            sessionID: sessionID,
            itemID: liveItem.id,
            taskIdentifier: 11
        )
        _ = try await store.markUploading(
            boxID: boxID,
            sessionID: sessionID,
            itemID: missingItem.id,
            taskIdentifier: 12
        )

        let candidates = try await store.reconcileBackgroundTasks([
            CaptureBackgroundTask(taskIdentifier: 11, metadata: liveMetadata),
        ])
        let manifest = try await requiredManifest(store)

        XCTAssertEqual(candidates, [
            CaptureUploadCandidate(boxID: boxID, sessionID: sessionID, itemID: missingItem.id),
        ])
        XCTAssertEqual(manifest.items.first { $0.id == liveItem.id }?.state, .uploading(taskIdentifier: 11))
        XCTAssertEqual(manifest.items.first { $0.id == missingItem.id }?.state, .local)
    }

    func testRetryableFailuresUseBoundedBackoffThenRemainVisible() async throws {
        let store = try await makeStore()
        let item = makeFileItem()
        try await importItem(item, into: store)
        var resolutions: [CaptureUploadFailureResolution] = []

        for taskIdentifier in 1...4 {
            let metadata = try await store.markUploading(
                boxID: boxID,
                sessionID: sessionID,
                itemID: item.id,
                taskIdentifier: taskIdentifier
            )
            resolutions.append(try await store.recordUploadFailure(
                metadata: metadata,
                taskIdentifier: taskIdentifier,
                failure: .retryable(message: "Offline")
            ))
        }

        XCTAssertEqual(resolutions, [.retry(afterSeconds: 1), .retry(afterSeconds: 2), .retry(afterSeconds: 4), .failed])
        let manifest = try await requiredManifest(store)
        XCTAssertEqual(manifest.items.first?.state, .failed(message: "Offline"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: sessionDirectory.appendingPathComponent(item.filename).path))
    }

    func testTerminalFailureDoesNotRetryAndIgnoresStaleCompletion() async throws {
        let store = try await makeStore()
        let item = makeFileItem()
        try await importItem(item, into: store)
        let metadata = try await store.markUploading(
            boxID: boxID,
            sessionID: sessionID,
            itemID: item.id,
            taskIdentifier: 9
        )

        let resolution = try await store.recordUploadFailure(
            metadata: metadata,
            taskIdentifier: 9,
            failure: .terminal(message: "Session is gone")
        )
        let duplicate = try await store.recordUploadFailure(
            metadata: metadata,
            taskIdentifier: 9,
            failure: .retryable(message: "Late callback")
        )

        XCTAssertEqual(resolution, .failed)
        XCTAssertEqual(duplicate, .ignoredStaleCompletion)
        let manifest = try await requiredManifest(store)
        XCTAssertEqual(manifest.items.first?.state, .failed(message: "Session is gone"))
    }

    func testReconciliationRejectsTaskIdentifierCollisionWithWrongMetadata() async throws {
        let store = try await makeStore()
        let item = makeFileItem()
        try await importItem(item, into: store)
        let metadata = try await store.markUploading(
            boxID: boxID,
            sessionID: sessionID,
            itemID: item.id,
            taskIdentifier: 11
        )
        let wrongMetadata = CaptureBackgroundTaskMetadata(
            boxID: UUID(),
            sessionID: metadata.sessionID,
            itemID: metadata.itemID,
            generation: metadata.generation
        )

        let candidates = try await store.reconcileBackgroundTasks([
            CaptureBackgroundTask(taskIdentifier: 11, metadata: wrongMetadata),
        ])
        XCTAssertEqual(candidates.map(\.itemID), [item.id])
        let manifest = try await requiredManifest(store)
        XCTAssertEqual(manifest.items.first?.state, .local)
    }

    func testFiftyMiBPreflightRejectsOnlyOversizePayload() async throws {
        let store = CaptureStore(rootURL: rootURL)
        let exactURL = try sparseFile(byteCount: CaptureStore.maximumUploadBytes)
        let oversizeURL = try sparseFile(byteCount: CaptureStore.maximumUploadBytes + 1)

        let exactByteCount = try await store.preflightPayload(at: exactURL)
        XCTAssertEqual(exactByteCount, CaptureStore.maximumUploadBytes)
        do {
            _ = try await store.preflightPayload(at: oversizeURL)
            XCTFail("Expected the oversized file to be rejected")
        } catch let error as CaptureFailure {
            XCTAssertEqual(error, .payloadTooLarge(byteCount: CaptureStore.maximumUploadBytes + 1))
        }
    }

    func testPhotoImportRejectsMismatchedExtension() async throws {
        let store = try await makeStore()
        var item = makeFileItem()
        item.kind = .photo
        item.filename = "ios-photo-\(item.id).png"
        item.mimeType = "image/jpeg"

        await XCTAssertThrowsErrorAsync {
            try await store.importPayload(
                from: self.sourceFile(contents: Data("photo".utf8)),
                boxID: self.boxID,
                sessionID: self.sessionID,
                item: item
            )
        }
    }

    func testFollowUpMovesOnlyUnacknowledgedPayloadsAndResetsUploadState() async throws {
        let store = try await makeStore()
        let localItem = makeFileItem()
        let failedItem = makeFileItem()
        let uploadedItem = makeFileItem()
        try await importItem(localItem, into: store)
        try await importItem(failedItem, into: store)
        try await importItem(uploadedItem, into: store)
        try await store.transition(
            boxID: boxID,
            sessionID: sessionID,
            itemID: failedItem.id,
            to: .failed(message: "Session gone")
        )
        let uploadedMetadata = try await store.markUploading(
            boxID: boxID,
            sessionID: sessionID,
            itemID: uploadedItem.id,
            taskIdentifier: 9
        )
        _ = try await store.acknowledgeUpload(metadata: uploadedMetadata, taskIdentifier: 9)
        let followUpID = CaptureSessionID(rawValue: "capture-follow-up")
        _ = try await store.createManifest(
            boxID: boxID,
            sessionID: followUpID,
            targetSessionID: "chat-1",
            startedAt: "2026-07-17T12:05:00Z"
        )

        try await store.moveUnacknowledgedItems(
            boxID: boxID,
            from: sessionID,
            to: followUpID
        )

        let source = try await requiredManifest(store)
        let loadedDestination = try await store.loadManifest(boxID: boxID, sessionID: followUpID)
        let destination = try XCTUnwrap(loadedDestination)
        XCTAssertEqual(source.items.map(\.id), [uploadedItem.id])
        XCTAssertEqual(Set(destination.items.map(\.id)), Set([localItem.id, failedItem.id]))
        XCTAssertTrue(destination.items.allSatisfy { $0.state == .local && $0.uploadGeneration == 0 })
        for item in destination.items {
            let url = rootURL
                .appendingPathComponent(boxID.uuidString.lowercased(), isDirectory: true)
                .appendingPathComponent(followUpID.rawValue, isDirectory: true)
                .appendingPathComponent(item.filename)
            XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        }
    }

    func testFollowUpRefusesToMoveAnActiveUpload() async throws {
        let store = try await makeStore()
        let item = makeFileItem()
        try await importItem(item, into: store)
        _ = try await store.markUploading(
            boxID: boxID,
            sessionID: sessionID,
            itemID: item.id,
            taskIdentifier: 9
        )
        let followUpID = CaptureSessionID(rawValue: "capture-follow-up")
        _ = try await store.createManifest(
            boxID: boxID,
            sessionID: followUpID,
            targetSessionID: "chat-1",
            startedAt: "2026-07-17T12:05:00Z"
        )

        await XCTAssertThrowsErrorAsync {
            try await store.moveUnacknowledgedItems(
                boxID: self.boxID,
                from: self.sessionID,
                to: followUpID
            )
        }

        let source = try await requiredManifest(store)
        let destination = try await store.loadManifest(boxID: boxID, sessionID: followUpID)
        XCTAssertEqual(source.items.map(\.id), [item.id])
        XCTAssertTrue(destination?.items.isEmpty == true)
    }

    func testDeleteCaptureRemovesManifestAndPayloadDirectory() async throws {
        let store = try await makeStore()
        let item = makeFileItem()
        try await importItem(item, into: store)

        try await store.deleteCapture(boxID: boxID, sessionID: sessionID)

        let deleted = try await store.loadManifest(boxID: boxID, sessionID: sessionID)
        XCTAssertNil(deleted)
        XCTAssertFalse(FileManager.default.fileExists(atPath: sessionDirectory.path))
    }

    private var sessionDirectory: URL {
        rootURL
            .appendingPathComponent(boxID.uuidString.lowercased(), isDirectory: true)
            .appendingPathComponent(sessionID.rawValue, isDirectory: true)
    }

    private var manifestURL: URL {
        sessionDirectory.appendingPathComponent("manifest.json")
    }

    private func makeStore() async throws -> CaptureStore {
        let store = CaptureStore(rootURL: rootURL)
        _ = try await store.createManifest(
            boxID: boxID,
            sessionID: sessionID,
            targetSessionID: nil,
            startedAt: "2026-07-17T12:00:00Z"
        )
        return store
    }

    private func requiredManifest(_ store: CaptureStore) async throws -> CaptureManifest {
        let manifest = try await store.loadManifest(boxID: boxID, sessionID: sessionID)
        return try XCTUnwrap(manifest)
    }

    private func importItem(_ item: CaptureItem, into store: CaptureStore) async throws {
        try await store.importPayload(
            from: sourceFile(contents: Data(item.id.uuidString.utf8)),
            boxID: boxID,
            sessionID: sessionID,
            item: item
        )
    }

    private func makeAudioItem(state: CaptureItemState) -> CaptureItem {
        CaptureItem(
            id: UUID(),
            filename: CaptureFilename.audio(id: UUID()),
            kind: .audio,
            capturedAt: "2026-07-17T12:00:00Z",
            source: "microphone",
            mimeType: "audio/mp4",
            originalName: nil,
            audioFormat: .m4aAAC,
            segmentID: UUID().uuidString,
            segmentStartedAt: "2026-07-17T12:00:00Z",
            state: state,
            uploadGeneration: 0
        )
    }

    private func makeFileItem() -> CaptureItem {
        let id = UUID()
        return CaptureItem(
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
    }

    private func sourceFile(contents: Data) throws -> URL {
        let url = rootURL.appendingPathComponent("source-\(UUID().uuidString)")
        try contents.write(to: url)
        return url
    }

    private func sparseFile(byteCount: Int64) throws -> URL {
        let url = rootURL.appendingPathComponent("sparse-\(UUID().uuidString)")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(byteCount))
        try handle.close()
        return url
    }

    private func directoryContainsAtomicTemporaryFile() throws -> Bool {
        try FileManager.default.contentsOfDirectory(atPath: sessionDirectory.path).contains { $0 != "manifest.json" }
    }
}

private func XCTAssertThrowsErrorAsync(
    _ expression: () async throws -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await expression()
        XCTFail("Expected expression to throw", file: file, line: line)
    } catch {
        // Expected.
    }
}
