import BeeBoxMacCore
import BeeBoxShared
import Foundation
import XCTest

@MainActor
final class PairingSheetModelTests: XCTestCase {
    private let link = "beebox://pair?baseURL=https%3A%2F%2Fworkshop.example.ts.net%2Fworkshop&label=Workshop&pairingToken=t1"

    func testThePasteboardFillsTheFieldOnlyWithAPairingLink() {
        let model = PairingSheetModel { _ in .duplicate }

        model.fill(fromPasteboard: "a grocery list")
        XCTAssertEqual(model.text, "")
        XCTAssertEqual(model.state, .empty)

        model.fill(fromPasteboard: "  \(link)\n")
        XCTAssertEqual(model.text, link)
        XCTAssertEqual(model.state, .ready(.init(label: "Workshop", host: "workshop.example.ts.net", encrypted: true)))
        XCTAssertTrue(model.canAdd)
    }

    func testTypedTextThatIsNotALinkSaysSo() {
        let model = PairingSheetModel { _ in .duplicate }
        model.text = "https://workshop.example.ts.net"
        XCTAssertEqual(model.state, .notALink)
        XCTAssertFalse(model.canAdd)
    }

    func testPublicPlainHTTPIsRefusedBeforeAdd() {
        let model = PairingSheetModel { _ in XCTFail("must not pair"); return .duplicate }
        model.text = "beebox://pair?baseURL=http%3A%2F%2F203.0.113.9%2Fbox&pairingToken=t"
        XCTAssertEqual(model.state, .refused(.init(label: "Bee Box", host: "203.0.113.9", encrypted: false)))
        XCTAssertFalse(model.canAdd)
    }

    func testLocalPlainHTTPPreviewsAsNotEncrypted() {
        let model = PairingSheetModel { _ in .duplicate }
        model.text = "beebox://pair?baseURL=http%3A%2F%2F192.168.1.20%3A3280%2Fbox&pairingToken=t"
        XCTAssertEqual(model.state, .ready(.init(label: "Bee Box", host: "192.168.1.20:3280", encrypted: false)))
    }

    func testAddReportsThePairedBox() async {
        let model = PairingSheetModel { link in
            .paired(PairedBox(id: UUID(), label: link.label, baseURL: link.baseURL, hostedLocally: false))
        }
        model.text = link
        await model.add()
        XCTAssertEqual(model.state, .paired(label: "Workshop"))
    }

    func testAFailureStaysInTheSheetAndCanBeRetried() async {
        let model = PairingSheetModel { _ in .failed(.rejected(status: 401, message: "Pairing code is invalid or expired.")) }
        model.text = link
        await model.add()
        guard case .failed(_, let message) = model.state else { return XCTFail("\(model.state)") }
        XCTAssertEqual(message, "Pairing code is invalid or expired. Make a new link on the box and try again.")
        XCTAssertTrue(model.canAdd)
    }

    func testTransportFailureNamesTheCause() {
        XCTAssertEqual(
            PairingSheetModel.message(for: .transport(.cannotConnectToHost)),
            "Could not reach the box (connection refused). Check that it is running and that this Mac can reach it."
        )
    }
}
