import XCTest
@testable import BeeBox

final class ShareExtensionAPITests: XCTestCase {
    func testChatSendBodyIdentifiesNativeChannel() throws {
        let data = try ShareExtensionAPI.encodeChatSendBody(message: "hello", messageId: "message-1", session: "session-1")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(body["channel"] as? String, "ios-native")
        XCTAssertEqual(body["exactSession"] as? Bool, true)
    }

    func testDestinationEnvelopeMatchesSharedFixture() throws {
        let fixture = MobileContractFixtures.root.appendingPathComponent("share-destinations.json")
        let decoded = try ShareExtensionAPI.decodeDestinationsEnvelope(Data(contentsOf: fixture))

        XCTAssertEqual(decoded.chats.map(\.sessionId), ["session-reading"])
        XCTAssertEqual(decoded.saves.map(\.destination.kind), ["inbox", "landmark"])
        XCTAssertNil(decoded.saves.first?.destination.dir)
        XCTAssertEqual(decoded.saves.last?.destination.dir, "_content/reading")
    }
}
