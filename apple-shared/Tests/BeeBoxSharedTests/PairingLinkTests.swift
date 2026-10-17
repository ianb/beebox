import BeeBoxShared
import Foundation
import XCTest

/// `beebox/test/mobile-contract/fixtures/pairing-url/`: the same cases the
/// TypeScript link generator is held to.
final class PairingLinkTests: XCTestCase {
    private struct Fixture: Decodable {
        var input: String
        var debugOnly: Bool?
        var expected: Expected
    }

    private struct Expected: Decodable {
        var accepted: Bool
        var baseURL: String?
        var label: String?
        var pairingToken: String?
        var session: String?
        var authToken: String?
    }

    func testSharedFixtures() throws {
        let fixtures = try MobileContractFixtures.load("pairing-url", as: Fixture.self)
        XCTAssertFalse(fixtures.isEmpty, "no pairing-url fixtures found under \(MobileContractFixtures.root.path)")
        for named in fixtures {
            let fixture = named.fixture
            let url = try XCTUnwrap(URL(string: fixture.input), named.name)
            let link = PairingLink.parse(url, allowDirectAuthToken: true)
            guard fixture.expected.accepted else {
                XCTAssertNil(link, named.name)
                continue
            }
            let parsed = try XCTUnwrap(link, named.name)
            XCTAssertEqual(parsed.baseURL.absoluteString, fixture.expected.baseURL, named.name)
            XCTAssertEqual(parsed.label, fixture.expected.label, named.name)
            XCTAssertEqual(parsed.pairingToken, fixture.expected.pairingToken, named.name)
            XCTAssertEqual(parsed.sessionID, fixture.expected.session, named.name)
            XCTAssertEqual(parsed.directAuthToken, fixture.expected.authToken, named.name)
        }
    }

    func testDebugOnlyAuthTokenIsDroppedWhenNotAllowed() throws {
        let fixture = try MobileContractFixtures.load("pairing-url", "authtoken-debug-only", as: Fixture.self)
        XCTAssertEqual(fixture.debugOnly, true)
        let url = try XCTUnwrap(URL(string: fixture.input))
        let parsed = try XCTUnwrap(PairingLink.parse(url, allowDirectAuthToken: false))
        XCTAssertNil(parsed.directAuthToken)
        XCTAssertEqual(parsed.baseURL.absoluteString, fixture.expected.baseURL)
    }

    func testOtherSchemesAndHostsAreNotPairingLinks() throws {
        let base = "baseURL=https%3A%2F%2Fbox.example.com&pairingToken=t"
        for text in ["https://pair?\(base)", "beebox://capture?\(base)", "beebox:pair?\(base)"] {
            let url = try XCTUnwrap(URL(string: text))
            XCTAssertNil(PairingLink.parse(url, allowDirectAuthToken: true), text)
        }
    }
}
