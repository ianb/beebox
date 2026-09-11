import XCTest
@testable import BeeBox

final class VoiceStagingStoreTests: XCTestCase {
    private var rootURL: URL!
    private let boxID = UUID()

    override func setUpWithError() throws {
        rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: rootURL)
    }

    func testCreateRecordingIsIdempotent() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        let first = try await store.createRecording(
            boxID: boxID, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        let second = try await store.createRecording(
            boxID: boxID, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        XCTAssertEqual(first, second)
        XCTAssertEqual(first.sessionCreation, .pending)
    }

    /// Persistence survives an app kill: a fresh store instance pointed at the
    /// same root sees exactly what a prior instance wrote.
    func testManifestPersistsAcrossStoreInstances() async throws {
        let recordingID = VoiceRecordingID()
        do {
            let store = VoiceStagingStore(rootURL: rootURL)
            _ = try await store.createRecording(
                boxID: boxID, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
            )
            try await store.markSessionCreated(boxID: boxID, recordingID: recordingID)
            _ = try await store.addChunk(
                boxID: boxID, recordingID: recordingID, index: 1, filename: "pcm-000001.raw", byteCount: 480_000
            )
        }
        let resumed = VoiceStagingStore(rootURL: rootURL)
        let manifest = try XCTUnwrapAsync(await resumed.loadManifest(boxID: boxID, recordingID: recordingID))
        XCTAssertEqual(manifest.sessionCreation, .created)
        XCTAssertEqual(manifest.chunks.map(\.filename), ["pcm-000001.raw"])
        XCTAssertEqual(manifest.chunks.first?.state, .local)
    }

    func testAddChunkIsIdempotentByIndex() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: boxID, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        _ = try await store.addChunk(boxID: boxID, recordingID: recordingID, index: 1, filename: "pcm-000001.raw", byteCount: 480_000)
        _ = try await store.addChunk(boxID: boxID, recordingID: recordingID, index: 1, filename: "pcm-000001.raw", byteCount: 480_000)
        let manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: boxID, recordingID: recordingID))
        XCTAssertEqual(manifest.chunks.count, 1)
    }

    func testUploadLifecycleMarksUploadedAndRemovesPayload() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: boxID, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        try await store.markSessionCreated(boxID: boxID, recordingID: recordingID)
        _ = try await store.addChunk(boxID: boxID, recordingID: recordingID, index: 1, filename: "pcm-000001.raw", byteCount: 3)
        let payloadURL = await store.directoryURL(boxID: boxID, recordingID: recordingID).appendingPathComponent("pcm-000001.raw")
        try FileManager.default.createDirectory(at: payloadURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data([1, 2, 3]).write(to: payloadURL)

        let candidate = VoiceStagingUploadCandidate(boxID: boxID, recordingID: recordingID, chunkIndex: 1)
        let payload = try await store.uploadPayload(for: candidate)
        XCTAssertEqual(payload.fileURL, payloadURL)

        let metadata = try await store.markUploading(boxID: boxID, recordingID: recordingID, chunkIndex: 1, taskIdentifier: 9)
        let firstAck = try await store.acknowledgeUpload(metadata: metadata, taskIdentifier: 9)
        XCTAssertTrue(firstAck)
        // Replayed completion for an already-uploaded chunk is also success.
        let secondAck = try await store.acknowledgeUpload(metadata: metadata, taskIdentifier: 9)
        XCTAssertTrue(secondAck)

        let manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: boxID, recordingID: recordingID))
        XCTAssertEqual(manifest.chunks.first?.state, .uploaded)
        XCTAssertFalse(FileManager.default.fileExists(atPath: payloadURL.path))
    }

    func testRecordUploadFailureRetriesWithinBoundAndFailsPastIt() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        let createdAt = "2026-09-01T00:00:00Z"
        _ = try await store.createRecording(boxID: boxID, recordingID: recordingID, targetSessionID: "chat-1", createdAt: createdAt)
        try await store.markSessionCreated(boxID: boxID, recordingID: recordingID)
        _ = try await store.addChunk(boxID: boxID, recordingID: recordingID, index: 1, filename: "pcm-000001.raw", byteCount: 3)
        let metadata = try await store.markUploading(boxID: boxID, recordingID: recordingID, chunkIndex: 1, taskIdentifier: 1)

        let soonAfterCreation = ISO8601DateFormatter().date(from: createdAt)!.addingTimeInterval(60)
        let resolution = try await store.recordUploadFailure(
            metadata: metadata, taskIdentifier: 1, failure: .retryable(message: "offline"), now: soonAfterCreation
        )
        guard case .retry = resolution else {
            return XCTFail("expected a retry within the retry bound")
        }
        var manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: boxID, recordingID: recordingID))
        XCTAssertEqual(manifest.chunks.first?.state, .local)

        // Same generation is gone now (it went back to `.local`); mark
        // uploading again to simulate the retry actually happening, then fail
        // it again from far in the future — past the 7-day bound.
        let metadata2 = try await store.markUploading(boxID: boxID, recordingID: recordingID, chunkIndex: 1, taskIdentifier: 2)
        let wayLater = ISO8601DateFormatter().date(from: createdAt)!.addingTimeInterval(8 * 24 * 60 * 60)
        let resolution2 = try await store.recordUploadFailure(
            metadata: metadata2, taskIdentifier: 2, failure: .retryable(message: "still offline"), now: wayLater
        )
        XCTAssertEqual(resolution2, .failed)
        manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: boxID, recordingID: recordingID))
        XCTAssertEqual(manifest.chunks.first?.state, .failed(message: "still offline"))
    }

    func testRecordUploadFailureIgnoresStaleGeneration() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: boxID, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        try await store.markSessionCreated(boxID: boxID, recordingID: recordingID)
        _ = try await store.addChunk(boxID: boxID, recordingID: recordingID, index: 1, filename: "pcm-000001.raw", byteCount: 3)
        let metadata = try await store.markUploading(boxID: boxID, recordingID: recordingID, chunkIndex: 1, taskIdentifier: 1)
        // A newer attempt has already superseded this one.
        _ = try await store.markUploading(boxID: boxID, recordingID: recordingID, chunkIndex: 1, taskIdentifier: 2)

        let resolution = try await store.recordUploadFailure(
            metadata: metadata, taskIdentifier: 1, failure: .terminal(message: "gone"), now: Date()
        )
        XCTAssertEqual(resolution, .ignoredStaleCompletion)
    }

    func testReconcileBackgroundTasksReschedulesMismatchedUpload() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: boxID, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        try await store.markSessionCreated(boxID: boxID, recordingID: recordingID)
        _ = try await store.addChunk(boxID: boxID, recordingID: recordingID, index: 1, filename: "pcm-000001.raw", byteCount: 3)
        _ = try await store.markUploading(boxID: boxID, recordingID: recordingID, chunkIndex: 1, taskIdentifier: 5)

        // No live task claims taskIdentifier 5 — the process was killed mid-upload.
        let candidates = try await store.reconcileBackgroundTasks([])
        XCTAssertEqual(candidates, [VoiceStagingUploadCandidate(boxID: boxID, recordingID: recordingID, chunkIndex: 1)])
        let manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: boxID, recordingID: recordingID))
        XCTAssertEqual(manifest.chunks.first?.state, .local)
    }

    func testReconcileSkipsRecordingsWhoseSessionIsNotYetCreated() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: boxID, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        _ = try await store.addChunk(boxID: boxID, recordingID: recordingID, index: 1, filename: "pcm-000001.raw", byteCount: 3)
        let candidates = try await store.reconcileBackgroundTasks([])
        XCTAssertTrue(candidates.isEmpty)
    }

    func testFinalizeLifecycleTransitions() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: boxID, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        try await store.markFinalizeRequested(boxID: boxID, recordingID: recordingID, chunkCount: 2, hq: nil)
        var manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: boxID, recordingID: recordingID))
        XCTAssertEqual(manifest.finalize, .pending(chunkCount: 2, hq: nil))

        try await store.markSealed(boxID: boxID, recordingID: recordingID)
        manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: boxID, recordingID: recordingID))
        XCTAssertEqual(manifest.finalize, .sealed)
    }

    func testMarkFinalizeTerminalPersistsMessage() async throws {
        let store = VoiceStagingStore(rootURL: rootURL)
        let recordingID = VoiceRecordingID()
        _ = try await store.createRecording(
            boxID: boxID, recordingID: recordingID, targetSessionID: "chat-1", createdAt: "2026-09-10T00:00:00Z"
        )
        try await store.markFinalizeTerminal(boxID: boxID, recordingID: recordingID, message: "missing chunks")
        let manifest = try XCTUnwrapAsync(await store.loadManifest(boxID: boxID, recordingID: recordingID))
        XCTAssertEqual(manifest.finalize, .terminal(message: "missing chunks"))
    }
}

/// `XCTUnwrap` doesn't accept an `async autoclosure`; this bridges an already
/// `await`ed optional the same way.
func XCTUnwrapAsync<T>(_ value: T?, file: StaticString = #filePath, line: UInt = #line) throws -> T {
    try XCTUnwrap(value, file: file, line: line)
}
