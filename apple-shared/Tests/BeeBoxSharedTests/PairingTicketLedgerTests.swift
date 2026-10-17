import BeeBoxShared
import XCTest

final class PairingTicketLedgerTests: XCTestCase {
    func testATicketInFlightCannotBeginAgain() {
        var ledger = PairingTicketLedger()
        XCTAssertTrue(ledger.begin("t"))
        XCTAssertFalse(ledger.begin("t"))
        XCTAssertTrue(ledger.begin("other"))
    }

    func testAStoredTicketStaysDone() {
        var ledger = PairingTicketLedger()
        _ = ledger.begin("t")
        ledger.finish("t", stored: true)
        XCTAssertFalse(ledger.begin("t"))
    }

    func testAFailedTicketCanBeginAgain() {
        var ledger = PairingTicketLedger()
        _ = ledger.begin("t")
        ledger.finish("t", stored: false)
        XCTAssertTrue(ledger.begin("t"))
    }
}
