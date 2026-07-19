import XCTest
@testable import CallbackBox

final class CaptureModelsTests: XCTestCase {
    func testItemStateCodableRoundTripsAssociatedValues() throws {
        let states: [CaptureItemState] = [
            .recording,
            .local,
            .uploading(taskIdentifier: 42),
            .uploaded,
            .failed(message: "No longer open"),
        ]

        for state in states {
            let data = try JSONEncoder().encode(state)
            XCTAssertEqual(try JSONDecoder().decode(CaptureItemState.self, from: data), state)
        }
    }

    func testItemStateTransitionTableIsExhaustive() {
        let states: [CaptureItemState] = [
            .recording,
            .local,
            .uploading(taskIdentifier: 1),
            .uploaded,
            .failed(message: "failed"),
        ]
        let allowed = Set([
            "recording-local", "recording-failed",
            "local-uploading", "local-failed",
            "uploading-local", "uploading-uploaded", "uploading-failed",
            "uploaded-uploaded", "failed-local",
        ])

        for from in states {
            for to in states {
                XCTAssertEqual(from.canTransition(to: to), allowed.contains("\(name(from))-\(name(to))"))
            }
        }
    }

    func testPhotoFilenamesAndMimeTypesStayInSync() throws {
        let id = UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!
        let jpeg = CaptureFilename.photo(id: id, format: .jpeg)
        let png = CaptureFilename.photo(id: id, format: .png)

        XCTAssertEqual(jpeg, "ios-photo-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg")
        XCTAssertEqual(png, "ios-photo-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png")
        XCTAssertNoThrow(try CaptureFilename.validatePhoto(filename: jpeg, mimeType: "image/jpeg"))
        XCTAssertNoThrow(try CaptureFilename.validatePhoto(filename: png, mimeType: "image/png"))
        XCTAssertThrowsError(try CaptureFilename.validatePhoto(filename: png, mimeType: "image/jpeg"))
        XCTAssertThrowsError(try CaptureFilename.validatePhoto(filename: "photo.heic", mimeType: "image/heic"))
    }

    func testImportedFilenameIsSafeAndKeepsUsefulLeafName() {
        let id = UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!
        XCTAssertEqual(
            CaptureFilename.file(id: id, originalName: "../My trip / receipt #1.pdf"),
            "ios-file-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-receipt--1.pdf"
        )
    }

    func testBackgroundMetadataRoundTripsThroughTaskDescription() {
        let metadata = CaptureBackgroundTaskMetadata(
            boxID: UUID(),
            sessionID: CaptureSessionID(rawValue: "staging-1"),
            itemID: UUID(),
            generation: 3
        )

        XCTAssertEqual(CaptureBackgroundTaskMetadata(taskDescription: metadata.taskDescription), metadata)
        XCTAssertNil(CaptureBackgroundTaskMetadata(taskDescription: "not metadata"))
    }

    private func name(_ state: CaptureItemState) -> String {
        switch state {
        case .recording:
            "recording"
        case .local:
            "local"
        case .uploading:
            "uploading"
        case .uploaded:
            "uploaded"
        case .failed:
            "failed"
        }
    }
}
