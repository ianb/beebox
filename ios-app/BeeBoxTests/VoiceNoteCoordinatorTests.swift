import XCTest
import AVFoundation
@testable import BeeBox

@MainActor
final class VoiceNoteCoordinatorTests: XCTestCase {
    func testRecoveryManifestRetainsOriginalDestinationAndIdentity() throws {
        let id = UUID()
        let boxID = UUID()
        let draft = VoiceNoteCoordinator.Draft(id: id, boxID: boxID, boxLabel: "Original", startedAt: Date(timeIntervalSince1970: 100), interrupted: true)
        let restored = try JSONDecoder().decode(VoiceNoteCoordinator.Draft.self, from: JSONEncoder().encode(draft))
        XCTAssertEqual(restored.id, id)
        XCTAssertEqual(restored.boxID, boxID)
        XCTAssertEqual(restored.boxLabel, "Original")
        XCTAssertTrue(restored.interrupted)
    }
    func testProcessRestartRetainsDraftWithoutStartingMicrophone() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let id = UUID()
        let boxID = UUID()
        let draft = VoiceNoteCoordinator.Draft(id: id, boxID: boxID, boxLabel: "A", startedAt: Date(), interrupted: false, segmentCount: 3)
        try JSONEncoder().encode(draft).write(to: directory.appendingPathComponent("draft.json"))
        let coordinator = VoiceNoteCoordinator(directoryURL: directory)
        XCTAssertEqual(coordinator.phase, .interrupted)
        XCTAssertFalse(coordinator.isRecording)
        XCTAssertEqual(coordinator.draft?.id, id)
        XCTAssertEqual(coordinator.draft?.boxID, boxID)
        XCTAssertEqual(coordinator.draft?.segmentCount, 3)
        XCTAssertEqual(coordinator.draft?.interrupted, true)
    }

    func testNoDraftCannotClaimSaved() async {
        let coordinator = VoiceNoteCoordinator(directoryURL: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        do {
            _ = try await coordinator.stopAndSave()
            XCTFail("No draft must not claim saved")
        } catch {
            XCTAssertEqual(coordinator.phase, .idle)
            XCTAssertNil(coordinator.draft)
        }
    }

    func testRecordingStopsAtEarlierDurationOrAdvertisedByteCap() {
        XCTAssertFalse(VoiceNoteLimits.reached(elapsed: 599, bytes: 1_000, byteLimit: 1_000_000))
        XCTAssertTrue(VoiceNoteLimits.reached(elapsed: 600, bytes: 1_000, byteLimit: 1_000_000))
        XCTAssertTrue(VoiceNoteLimits.reached(elapsed: 10, bytes: 1_000_000 - 65_536, byteLimit: 1_000_000))
        XCTAssertTrue(VoiceNoteLimits.reached(elapsed: 0, bytes: 0, byteLimit: 1_000))
    }

    private func recoveredFixture() throws -> (VoiceNoteCoordinator, QuickCaptureStore, PairedBox, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let directory = root.appendingPathComponent("voice")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let box = PairedBox(id: UUID(), label: "Original Box", baseURL: URL(string: "https://fixture.invalid/box")!, sessionID: nil, authToken: "synthetic", requiresDeviceUnlock: false)
        let draft = VoiceNoteCoordinator.Draft(id: UUID(), boxID: box.id, boxLabel: box.label, startedAt: Date(), interrupted: false)
        try JSONEncoder().encode(draft).write(to: directory.appendingPathComponent("draft.json"))
        try Data([1, 2, 3]).write(to: directory.appendingPathComponent("segment-0.m4a"))
        let captureStore = QuickCaptureStore(rootURL: root.appendingPathComponent("accepted"))
        let uploads = QuickCaptureUploadCoordinator(store: captureStore, cancelTransfersHandler: { _ in })
        let coordinator = VoiceNoteCoordinator(directoryURL: directory, captureStore: captureStore, uploadCoordinator: uploads, scheduleHandler: { _, _ in })
        return (coordinator, captureStore, box, root)
    }

    func testRemovedOriginalBlocksAutomaticAndExplicitSaveWithoutAcceptingCapture() async throws {
        let (coordinator, captureStore, box, root) = try recoveredFixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let originalID = coordinator.draft!.id
        coordinator.updatePairedBoxes([box])
        coordinator.updatePairedBoxes([])
        for boxes in [Optional<[PairedBox]>.none, Optional<[PairedBox]>.some([])] {
            do {
                _ = try await coordinator.stopAndSave(boxes: boxes)
                XCTFail("Removed original must not be accepted or transferred")
            } catch CaptureDestinationStore.DestinationError.removed {
                // Both automatic and explicit target resolution must refuse removal.
            } catch {
                XCTFail("Unexpected save error: \(error)")
            }
        }
        XCTAssertEqual(coordinator.phase, .interrupted)
        XCTAssertEqual(coordinator.draft?.id, originalID)
        XCTAssertEqual(coordinator.draft?.boxID, box.id)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("voice/segment-0.m4a").path))
        XCTAssertNil(try captureStore.record(originalID))
    }

    func testInterruptedDraftStartExplainsPendingOriginalWithoutActivatingMicrophone() async throws {
        let (coordinator, _, box, root) = try recoveredFixture()
        defer { try? FileManager.default.removeItem(at: root) }
        do {
            try await coordinator.start(box: box)
            XCTFail("Interrupted draft must be handled before another recording")
        } catch VoiceNoteCoordinator.Failure.interruptedPending(let label) {
            XCTAssertEqual(label, "Original Box")
            XCTAssertTrue(VoiceNoteCoordinator.Failure.interruptedPending(label).localizedDescription.contains("save or discard"))
        }
        XCTAssertFalse(coordinator.isRecording)
    }

    func testNewProtectionPreservesOriginalBoxAndInterruptedDraftPolicy() throws {
        let (coordinator, _, box, root) = try recoveredFixture()
        defer { try? FileManager.default.removeItem(at: root) }
        var protected = box
        protected.requiresDeviceUnlock = true
        coordinator.updatePairedBoxes([protected])
        XCTAssertEqual(coordinator.draft?.boxID, box.id)
        XCTAssertEqual(coordinator.draft?.requiresDeviceUnlock, true)
        XCTAssertEqual(coordinator.phase, .interrupted)
    }

    private func writeSilentAAC(at url: URL) throws {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4_410)!
        buffer.frameLength = 4_410
        buffer.floatChannelData![0].initialize(repeating: 0, count: 4_410)
        let file = try AVAudioFile(forWriting: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 96_000], commonFormat: .pcmFormatFloat32, interleaved: false)
        try file.write(from: buffer)
    }

    private func seedIncompleteCapture(coordinator: VoiceNoteCoordinator, store: QuickCaptureStore, box: PairedBox, attempts: Int) throws {
        let draft = coordinator.draft!
        let directory = store.directory(for: draft.id)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var record = QuickCaptureRecord(id: draft.id, boxID: box.id, boxLabel: box.label, requiresDeviceUnlock: false,
            declaration: QuickCaptureDeclaration(capturedAt: ISO8601DateFormatter().string(from: draft.startedAt), source: .voiceRecording, material: .file(kind: "audio", id: draft.id, mimeType: "audio/mp4", fileName: "voice-note.m4a")), createdAt: Date())
        record.status.state = "interrupted-draft"
        record.status.attempts = attempts
        try JSONEncoder().encode(record).write(to: directory.appendingPathComponent("manifest.json"))
        try JSONEncoder().encode(record.status).write(to: directory.appendingPathComponent("status.json"))
    }

    func testExportMissingSegmentsPreservesDraftAndAcceptsNothing() async throws {
        let (coordinator, store, _, root) = try recoveredFixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let id = coordinator.draft!.id
        try FileManager.default.removeItem(at: root.appendingPathComponent("voice/segment-0.m4a"))
        do {
            _ = try await coordinator.exportInterruptedAudio()
            XCTFail("Missing audio cannot be exported")
        } catch VoiceNoteCoordinator.Failure.storageUnavailable {
            // Missing completed segments leave no playable duration.
        } catch {
            XCTFail("Unexpected export error: \(error)")
        }
        XCTAssertEqual(coordinator.draft?.id, id)
        XCTAssertEqual(coordinator.phase, .interrupted)
        XCTAssertNil(try store.record(id))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("voice/draft.json").path))
    }

    func testExportPlayableAudioPreservesOriginalWithoutAcceptance() async throws {
        let (coordinator, store, _, root) = try recoveredFixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let id = coordinator.draft!.id
        try FileManager.default.removeItem(at: root.appendingPathComponent("voice/segment-0.m4a"))
        try writeSilentAAC(at: root.appendingPathComponent("voice/segment-0.m4a"))
        let exported = try await coordinator.exportInterruptedAudio()
        let duration = try await AVURLAsset(url: exported).load(.duration)
        XCTAssertGreaterThan(duration.seconds, 0)
        XCTAssertEqual(coordinator.draft?.id, id)
        XCTAssertEqual(coordinator.phase, .interrupted)
        XCTAssertNil(try store.record(id))
    }

    func testNeverUploadedIncompleteCaptureRepairsFromRetainedAudio() async throws {
        let (coordinator, store, box, root) = try recoveredFixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let id = coordinator.draft!.id
        try writeSilentAAC(at: root.appendingPathComponent("voice/recording.m4a"))
        try seedIncompleteCapture(coordinator: coordinator, store: store, box: box, attempts: 0)
        let label = try await coordinator.stopAndSave(boxes: [box])
        XCTAssertEqual(label, box.label)
        let accepted = try XCTUnwrap(store.record(id))
        XCTAssertNotEqual(accepted.status.state, "interrupted-draft")
        XCTAssertGreaterThan(accepted.declaration.material?.byteLength ?? 0, 0)
        try accepted.declaration.validate()
        XCTAssertNil(coordinator.draft)
    }

    func testAttemptedIncompleteCaptureCannotClaimSavedAndRetainsGoodAudio() async throws {
        let (coordinator, store, box, root) = try recoveredFixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let id = coordinator.draft!.id
        let originalAudio = root.appendingPathComponent("voice/recording.m4a")
        try writeSilentAAC(at: originalAudio)
        try seedIncompleteCapture(coordinator: coordinator, store: store, box: box, attempts: 1)
        do {
            _ = try await coordinator.stopAndSave(boxes: [box])
            XCTFail("Incomplete attempted capture must not be reused")
        } catch QuickCaptureStore.StoreError.conflict {
            // Previously attempted draft identity cannot be reused for a new save.
        } catch {
            XCTFail("Unexpected save error: \(error)")
        }
        XCTAssertEqual(coordinator.draft?.id, id)
        XCTAssertTrue(FileManager.default.fileExists(atPath: originalAudio.path))
        XCTAssertEqual(try store.record(id)?.status.state, "interrupted-draft")
        XCTAssertEqual(try store.record(id)?.status.attempts, 1)
    }

    func testUnreadableManifestBlocksOverwriteThenRecoversAfterManifestBecomesReadable() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let directory = root.appendingPathComponent("voice")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let originalBytes = Data([9, 8, 7])
        let manifest = directory.appendingPathComponent("draft.json")
        let audio = directory.appendingPathComponent("segment-0.m4a")
        try Data("Unreadable manifest".utf8).write(to: manifest)
        try originalBytes.write(to: audio)
        let store = QuickCaptureStore(rootURL: root.appendingPathComponent("captures"))
        let uploads = QuickCaptureUploadCoordinator(store: store, cancelTransfersHandler: { _ in })
        let coordinator = VoiceNoteCoordinator(directoryURL: directory, captureStore: store, uploadCoordinator: uploads)
        let publicBox = PairedBox(id: UUID(), label: "Public Box", baseURL: URL(string: "https://fixture.invalid/public")!, sessionID: nil, authToken: "synthetic", requiresDeviceUnlock: false)
        XCTAssertEqual(coordinator.phase, .failed)
        do { try await coordinator.start(box: publicBox); XCTFail("Unreadable retained bytes must not be replaced") }
        catch VoiceNoteCoordinator.Failure.retainedUnavailable {}
        XCTAssertEqual(try Data(contentsOf: audio), originalBytes)
        XCTAssertEqual(try Data(contentsOf: manifest), Data("Unreadable manifest".utf8))
        do { _ = try await coordinator.stopAndSave(); XCTFail("Unreadable retained draft is not an empty recording slot") }
        catch VoiceNoteCoordinator.Failure.retainedUnavailable {}
        let original = VoiceNoteCoordinator.Draft(id: UUID(), boxID: UUID(), boxLabel: "Original Private Box", startedAt: Date(), interrupted: false, requiresDeviceUnlock: true)
        try JSONEncoder().encode(original).write(to: manifest)
        do { _ = try await coordinator.stopAndSave(); XCTFail("Newly recovered private draft requires an adapter policy recheck") }
        catch VoiceNoteCoordinator.Failure.interruptedPending(let label) { XCTAssertEqual(label, original.boxLabel) }
        XCTAssertNil(try store.record(original.id))
        coordinator.updatePairedBoxes([publicBox])
        XCTAssertEqual(coordinator.draft?.id, original.id)
        XCTAssertEqual(coordinator.draft?.boxID, original.boxID)
        XCTAssertEqual(coordinator.draft?.requiresDeviceUnlock, true)
        XCTAssertEqual(coordinator.phase, .interrupted)
        XCTAssertEqual(try Data(contentsOf: audio), originalBytes)
    }

    func testFailuresDescribeRefusalWithoutClaimingSaved() {
        for error in [VoiceNoteCoordinator.Failure.microphoneDenied, .liveActivitiesDisabled, .recordingFailed, .activeElsewhere] {
            XCTAssertNotNil(error.errorDescription)
            XCTAssertFalse(error.errorDescription!.contains("Saved"))
        }
    }
}
