import XCTest
@testable import BeeBox

final class CaptureDestinationTests: XCTestCase {
    private var defaults: UserDefaults!
    override func setUp() { defaults = UserDefaults(suiteName: "CaptureDestinationTests.\(UUID().uuidString)") }
    private func box(_ label: String, protected: Bool = false) -> PairedBox {
        PairedBox(id: UUID(), label: label, baseURL: URL(string: "https://example.com/\(label)")!, sessionID: nil,
                  authToken: "synthetic", requiresDeviceUnlock: protected)
    }
    func testOneBoxInitializesDefaultAndMultipleRequiresChoice() throws {
        let store = CaptureDestinationStore(defaults: defaults)
        let a = box("a"), b = box("b")
        XCTAssertThrowsError(try store.resolve(boxes: [a,b]))
        XCTAssertEqual(try store.resolve(boxes: [a]), a)
        XCTAssertEqual(store.defaultBoxID, a.id)
        XCTAssertEqual(try store.resolve(boxes: [b,a]), a)
    }
    func testMissingDefaultAndPinNeverFallBack() throws {
        let store = CaptureDestinationStore(defaults: defaults)
        let a = box("a"), b = box("b")
        store.defaultBoxID = a.id
        XCTAssertThrowsError(try store.resolve(boxes: [b]))
        XCTAssertEqual(try store.resolve(boxes: [a,b], pinnedBoxID: b.id), b)
        XCTAssertThrowsError(try store.resolve(boxes: [a,b], pinnedBoxID: UUID()))
        XCTAssertEqual(store.defaultBoxID, a.id)
    }
    func testSiriRefusesProtectedButExplicitAuthenticatedFlowCanResolve() throws {
        let store = CaptureDestinationStore(defaults: defaults)
        let a = box("a", protected: true)
        XCTAssertThrowsError(try store.resolve(boxes: [a]))
        XCTAssertEqual(try store.resolve(boxes: [a], allowsProtected: true), a)
    }
    func testSnapshotRewriteCannotEraseDefault() {
        let store = CaptureDestinationStore(defaults: defaults)
        let a = box("a")
        store.defaultBoxID = a.id
        SharedSelectedBoxStore(defaults: defaults).persist(boxes: [], selectedBoxID: nil)
        XCTAssertEqual(store.defaultBoxID, a.id)
    }
}
