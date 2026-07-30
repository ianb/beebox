import XCTest
@testable import CallbackBox

/// Covers the Done-gating logic on the native capture surface.
///
/// The bug these guard against, seen in the field: 12 full-resolution photos
/// uploading over a weak uplink. Done polled for a fixed 30 seconds, gave up,
/// and told the user "Uploads are still finishing. Try Done again in a moment."
/// On the slow link that caused the wait, that moment never came, so Done was
/// unpressable for as long as the user cared to keep trying.
final class NativeCaptureFinishTests: XCTestCase {
    func testPendingCountsLocallyStagedItems() {
        // A `.local` item is staged but not yet handed to a background upload
        // task. It used to increment nothing, so it was invisible to Done.
        var counts = NativeCaptureSurfaceCounts()
        counts.queued = 3

        XCTAssertEqual(counts.pending, 3)
        XCTAssertTrue(counts.needsFinishPrompt)
    }

    func testPendingSumsQueuedAndUploading() {
        var counts = NativeCaptureSurfaceCounts()
        counts.queued = 2
        counts.uploading = 1
        counts.uploaded = 4

        XCTAssertEqual(counts.pending, 3)
    }

    func testQueuedOnlyStateStillPromptsBeforeSealing() {
        // The regression case: nothing actively uploading, nothing failed, but
        // work outstanding. The old check (`failed > 0 || uploading > 0`) was
        // false here, so Done skipped the prompt and entered the unescapable
        // wait instead of offering the user a choice.
        var counts = NativeCaptureSurfaceCounts()
        counts.photos = 5
        counts.queued = 5
        counts.uploading = 0
        counts.failed = 0

        XCTAssertTrue(counts.needsFinishPrompt)
    }

    func testFailuresPromptEvenWithNothingPending() {
        var counts = NativeCaptureSurfaceCounts()
        counts.photos = 2
        counts.uploaded = 1
        counts.failed = 1

        XCTAssertEqual(counts.pending, 0)
        XCTAssertTrue(counts.needsFinishPrompt)
    }

    func testFullyUploadedCaptureSealsWithoutPrompting() {
        var counts = NativeCaptureSurfaceCounts()
        counts.photos = 3
        counts.uploaded = 3

        XCTAssertEqual(counts.pending, 0)
        XCTAssertFalse(counts.needsFinishPrompt)
    }

    func testEmptyCaptureDoesNotPrompt() {
        XCTAssertFalse(NativeCaptureSurfaceCounts().needsFinishPrompt)
    }

    func testPendingItemCountTreatsSettledStatesAsDone() throws {
        // `finish()` waits on exactly this count, so a settled state must never
        // read as pending — a `.failed` item counted as pending would make the
        // wait never end.
        let manifest = manifest(items: [
            item(state: .uploaded),
            item(state: .failed(message: "gave up")),
        ])

        XCTAssertEqual(manifest.pendingItemCount, 0)
    }

    func testPendingItemCountCountsUnsettledStates() throws {
        let manifest = manifest(items: [
            item(state: .local),
            item(state: .uploading(taskIdentifier: 7)),
            item(state: .recording),
            item(state: .uploaded),
        ])

        XCTAssertEqual(manifest.pendingItemCount, 3)
    }

    private func manifest(items: [CaptureItem]) -> CaptureManifest {
        var manifest = CaptureManifest(
            boxID: UUID(),
            sessionID: CaptureSessionID(rawValue: "s1"),
            targetSessionID: nil,
            startedAt: "2026-07-29T12:00:00Z"
        )
        manifest.items = items
        return manifest
    }

    private func item(state: CaptureItemState) -> CaptureItem {
        CaptureItem(
            id: UUID(),
            filename: "photo-001.jpg",
            kind: .photo,
            capturedAt: "2026-07-29T12:00:00Z",
            source: "camera-environment",
            mimeType: "image/jpeg",
            originalName: "photo-001.jpg",
            audioFormat: nil,
            segmentID: nil,
            segmentStartedAt: nil,
            state: state,
            uploadGeneration: 0
        )
    }
}
