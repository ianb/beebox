import UIKit
import XCTest
@testable import BeeBox

final class CaptureAcquisitionTests: XCTestCase {
    func testOpaqueRotatedImageBecomesUprightJPEGWithMatchingMetadata() throws {
        let source = image(size: CGSize(width: 12, height: 20), opaque: true)
        let cgImage = try XCTUnwrap(source.cgImage)
        let rotated = UIImage(cgImage: cgImage, scale: 1, orientation: .right)

        let normalized = try CaptureImageNormalizer.normalize(image: rotated)
        let decoded = try XCTUnwrap(UIImage(data: normalized.data))

        XCTAssertEqual(normalized.format, .jpeg)
        XCTAssertEqual(normalized.fileExtension, "jpg")
        XCTAssertEqual(normalized.mimeType, "image/jpeg")
        XCTAssertEqual(decoded.imageOrientation, .up)
        XCTAssertEqual(decoded.size, rotated.size)
    }

    func testTransparentImageRemainsTransparentPNG() throws {
        let source = image(size: CGSize(width: 8, height: 8), opaque: false)

        let normalized = try CaptureImageNormalizer.normalize(image: source)
        let decoded = try XCTUnwrap(UIImage(data: normalized.data)?.cgImage)

        XCTAssertEqual(normalized.format, .png)
        XCTAssertEqual(normalized.fileExtension, "png")
        XCTAssertEqual(normalized.mimeType, "image/png")
        XCTAssertTrue([.first, .last, .premultipliedFirst, .premultipliedLast].contains(decoded.alphaInfo))
    }

    func testPhotoAndAudioNamingUseOneStableIdentity() throws {
        let id = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
        let date = Date(timeIntervalSince1970: 0)

        let photo = CaptureAcquisitionItemFactory.photo(
            id: id,
            format: .png,
            source: "camera-user",
            capturedAt: date
        )
        let audio = CaptureAcquisitionItemFactory.audio(id: id, startedAt: date)

        XCTAssertEqual(photo.filename, "ios-photo-11111111-2222-3333-4444-555555555555.png")
        XCTAssertEqual(photo.mimeType, "image/png")
        XCTAssertEqual(photo.source, "camera-user")
        XCTAssertEqual(audio.filename, "ios-audio-11111111-2222-3333-4444-555555555555.m4a")
        XCTAssertEqual(audio.segmentID, id.uuidString.lowercased())
        XCTAssertEqual(audio.audioFormat, .m4aAAC)
        XCTAssertEqual(audio.state, .recording)
        XCTAssertEqual(audio.capturedAt, audio.segmentStartedAt)
        XCTAssertNoThrow(try CaptureFilename.validatePhoto(filename: photo.filename, mimeType: photo.mimeType))
    }

    func testLifecycleClosesInterruptedSegmentAndNeverAutoResumes() {
        let id = UUID()
        var lifecycle = CaptureAudioLifecycle()

        XCTAssertTrue(lifecycle.begin(itemID: id))
        XCTAssertTrue(lifecycle.didStart(itemID: id))
        XCTAssertEqual(lifecycle.requestStop(.interruption), id)
        XCTAssertEqual(lifecycle.state, .stopping(id, .interruption))
        XCTAssertTrue(lifecycle.didClose(itemID: id))
        XCTAssertEqual(lifecycle.state, .idle)

        let nextID = UUID()
        XCTAssertTrue(lifecycle.begin(itemID: nextID))
        XCTAssertNotEqual(nextID, id)
    }

    func testLifecycleRejectsOverlappingStartsAndDuplicateStops() {
        let id = UUID()
        var lifecycle = CaptureAudioLifecycle()

        XCTAssertTrue(lifecycle.begin(itemID: id))
        XCTAssertFalse(lifecycle.begin(itemID: UUID()))
        XCTAssertTrue(lifecycle.didStart(itemID: id))
        XCTAssertNil(lifecycle.requestStop(.background).flatMap { _ in lifecycle.requestStop(.background) })
        XCTAssertEqual(lifecycle.state, .stopping(id, .background))
    }

    func testSoftLimitStopsAtFortyEightMiB() {
        XCTAssertFalse(CaptureAudioRecorder.shouldSoftStop(byteCount: CaptureAudioRecorder.softLimitBytes - 1))
        XCTAssertTrue(CaptureAudioRecorder.shouldSoftStop(byteCount: CaptureAudioRecorder.softLimitBytes))
    }

    func testFileImportPreservesNameMimeAndCopiesBeforeReturning() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = directory.appendingPathComponent("field notes.txt")
        try Data("notes".utf8).write(to: source)
        let sink = FakeAcquisitionSink(copyDirectory: directory.appendingPathComponent("copied", isDirectory: true))

        let results = await CaptureFileImporter.importURLs([source], into: sink)

        let result = try XCTUnwrap(results.first)
        let item = try XCTUnwrap(result.item)
        XCTAssertNil(result.error)
        XCTAssertEqual(item.originalName, "field notes.txt")
        XCTAssertEqual(item.mimeType, "text/plain")
        XCTAssertEqual(item.source, "files")
        let copied = await sink.importedData[item.id]
        XCTAssertEqual(copied, Data("notes".utf8))
    }

    private func image(size: CGSize, opaque: Bool) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = opaque
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            if opaque {
                UIColor.red.setFill()
                context.fill(CGRect(origin: .zero, size: size))
            } else {
                UIColor.clear.setFill()
                context.fill(CGRect(origin: .zero, size: size))
                UIColor.blue.withAlphaComponent(0.5).setFill()
                context.fill(CGRect(x: 1, y: 1, width: size.width - 2, height: size.height - 2))
            }
        }
    }
}

private actor FakeAcquisitionSink: CaptureAcquisitionSink {
    let copyDirectory: URL
    private(set) var importedData: [UUID: Data] = [:]

    init(copyDirectory: URL) {
        self.copyDirectory = copyDirectory
    }

    func importFile(at url: URL, item: CaptureItem) throws {
        try FileManager.default.createDirectory(at: copyDirectory, withIntermediateDirectories: true)
        importedData[item.id] = try Data(contentsOf: url)
    }

    func beginRecording(item: CaptureItem) throws -> URL {
        try FileManager.default.createDirectory(at: copyDirectory, withIntermediateDirectories: true)
        return copyDirectory.appendingPathComponent(item.filename)
    }

    func closeRecording(itemID: UUID) {}

    func failRecording(itemID: UUID, message: String) {}
}

@MainActor
final class CaptureAudioSessionTests: XCTestCase {
    func testStartActivatesTheRecordingRoleAndStopRestoresIdle() async throws {
        let session = RecordingAudioSession()
        let recorder = CaptureAudioRecorder(
            sink: StubAcquisitionSink(),
            factory: StubRecorderFactory(),
            audioSession: session,
            authorizer: AlwaysGrantedAuthorizer()
        )

        await recorder.start()
        XCTAssertEqual(session.activations, 1)
        XCTAssertEqual(session.deactivations, 0)

        await recorder.stop()
        // `deactivate()` is what restores the idle playback configuration, so a
        // missing call here is the Bluetooth/low-volume defect returning.
        XCTAssertEqual(session.deactivations, 1)
        XCTAssertEqual(session.activations, 1)
    }

    func testEveryStopReasonRestoresIdle() async throws {
        for reason in [
            CaptureAudioStopReason.interruption,
            .background,
            .sizeLimit,
            .unexpectedStop,
        ] {
            let session = RecordingAudioSession()
            let recorder = CaptureAudioRecorder(
                sink: StubAcquisitionSink(),
                factory: StubRecorderFactory(),
                audioSession: session,
                authorizer: AlwaysGrantedAuthorizer()
            )

            await recorder.start()
            await recorder.stop(reason: reason)

            XCTAssertEqual(session.deactivations, 1, "\(reason)")
        }
    }

    func testRecorderStoppingItselfClosesTheSegmentAndSurfacesNotice() async throws {
        let recording = StubRecording()
        let recorder = CaptureAudioRecorder(
            sink: StubAcquisitionSink(),
            factory: SuppliedRecorderFactory(recording: recording),
            audioSession: RecordingAudioSession(),
            authorizer: AlwaysGrantedAuthorizer()
        )

        await recorder.start()
        recording.stop()
        try await Task.sleep(for: .milliseconds(650))

        XCTAssertFalse(recorder.isRecording)
        XCTAssertEqual(recorder.notice, "Recording stopped unexpectedly. Start again to continue in a new segment.")
    }

    func testAFailedStartNeverReleasesASessionItDidNotAcquire() async throws {
        let session = RecordingAudioSession()
        let recorder = CaptureAudioRecorder(
            sink: StubAcquisitionSink(),
            factory: StubRecorderFactory(),
            audioSession: session,
            authorizer: DeniedAuthorizer()
        )

        await recorder.start()

        // AVAudioSession is process-global. A recorder that never activated it
        // must not deactivate whatever else is using it.
        XCTAssertEqual(session.activations, 0)
        XCTAssertEqual(session.deactivations, 0)
    }
}

@MainActor
private final class RecordingAudioSession: AudioSessionControlling {
    private(set) var activations = 0
    private(set) var deactivations = 0
    private(set) var idlePreparations = 0

    nonisolated func activateRecording() throws {
        MainActor.assumeIsolated { activations += 1 }
    }

    nonisolated func deactivate() {
        MainActor.assumeIsolated { deactivations += 1 }
    }

    nonisolated func prepareIdle() {
        MainActor.assumeIsolated { idlePreparations += 1 }
    }
}

private struct StubAcquisitionSink: CaptureAcquisitionSink {
    func importFile(at url: URL, item: CaptureItem) async throws {}

    func beginRecording(item: CaptureItem) async throws -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(item.filename)
    }

    func closeRecording(itemID: UUID) async throws {}

    func failRecording(itemID: UUID, message: String) async {}
}

private struct StubRecorderFactory: CaptureAudioRecorderFactory {
    func makeRecorder(url: URL, settings: [String: Any]) throws -> any CaptureAudioRecording {
        StubRecording()
    }
}

private struct SuppliedRecorderFactory: CaptureAudioRecorderFactory {
    var recording: StubRecording

    func makeRecorder(url: URL, settings: [String: Any]) throws -> any CaptureAudioRecording {
        recording
    }
}

private final class StubRecording: CaptureAudioRecording {
    private(set) var isRecording = false

    func record() -> Bool {
        isRecording = true
        return true
    }

    func stop() {
        isRecording = false
    }
}

private struct AlwaysGrantedAuthorizer: CaptureMicrophoneAuthorizing {
    func requestPermission() async -> Bool { true }
}

private struct DeniedAuthorizer: CaptureMicrophoneAuthorizing {
    func requestPermission() async -> Bool { false }
}
