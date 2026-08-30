import XCTest
@testable import BeeBox

final class ShareExtensionAPITests: XCTestCase {
    func testDestinationEnvelopeMatchesSharedFixture() throws {
        let fixture = MobileContractFixtures.root.appendingPathComponent("share-destinations.json")
        let decoded = try ShareExtensionAPI.decodeDestinationsEnvelope(Data(contentsOf: fixture))

        XCTAssertEqual(decoded.chats.map(\.sessionId), ["session-reading"])
        XCTAssertEqual(decoded.saves.map(\.destination.kind), ["inbox", "landmark"])
        XCTAssertNil(decoded.saves.first?.destination.dir)
        XCTAssertEqual(decoded.saves.last?.destination.dir, "store/reading")
    }
}
