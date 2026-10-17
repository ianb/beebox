import BeeBoxShared
import Foundation
import XCTest

/// `beebox/test/mobile-contract/fixtures/redeem/`: request, 200 and 401 shapes.
final class PairingRedeemerTests: XCTestCase {
    private struct RequestFixture: Decodable {
        struct Body: Codable, Equatable {
            var pairingToken: String
            var deviceLabel: String
        }
        var input: Body
        var expected: Body
    }

    private struct ResponseFixture: Decodable {
        struct Expected: Decodable { var token: String }
        var input: [String: String]
        var expected: Expected
    }

    private struct ErrorFixture: Decodable {
        struct Body: Decodable { var error: String }
        var status: Int
        var input: Body
        var expected: Body
    }

    private let baseURL = URL(string: "http://127.0.0.1:3210/main/test1")!

    func testRequestMatchesSharedFixture() async throws {
        let fixture = try MobileContractFixtures.load("redeem", "request", as: RequestFixture.self)
        let transport = FakeTransport(status: 200, body: Data(#"{"token":"t"}"#.utf8))
        let redeemer = PairingRedeemer(transport: transport, userAgent: "BeeBox-Test/1")

        _ = try await redeemer.redeem(
            baseURL: baseURL,
            pairingToken: fixture.input.pairingToken,
            deviceLabel: fixture.input.deviceLabel
        )

        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(transport.requests.count, 1)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:3210/main/test1/api/pairing/redeem")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), "BeeBox-Test/1")
        let body = try JSONDecoder().decode(RequestFixture.Body.self, from: XCTUnwrap(request.httpBody))
        XCTAssertEqual(body, fixture.expected)
    }

    func testSuccessReturnsTokenAndIgnoresOtherFields() async throws {
        let fixture = try MobileContractFixtures.load("redeem", "response-200", as: ResponseFixture.self)
        let body = try JSONEncoder().encode(fixture.input)
        let redeemer = PairingRedeemer(transport: FakeTransport(status: 200, body: body), userAgent: "ua")

        let token = try await redeemer.redeem(baseURL: baseURL, pairingToken: "p", deviceLabel: "d")

        XCTAssertEqual(token, fixture.expected.token)
    }

    func testRejectionCarriesStatusAndServerMessage() async throws {
        let fixture = try MobileContractFixtures.load("redeem", "error-401", as: ErrorFixture.self)
        let body = try JSONEncoder().encode(["error": fixture.input.error])
        let redeemer = PairingRedeemer(transport: FakeTransport(status: fixture.status, body: body), userAgent: "ua")

        await assertRedeemFails(redeemer, with: .rejected(status: 401, message: fixture.expected.error))
    }

    func testRejectionWithoutJSONBodyHasNoMessage() async {
        let redeemer = PairingRedeemer(transport: FakeTransport(status: 503, body: Data("Box is closed".utf8)), userAgent: "ua")

        await assertRedeemFails(redeemer, with: .rejected(status: 503, message: nil))
    }

    func testSuccessWithoutTokenIsMalformed() async {
        for body in [#"{"boxSlug":"test1"}"#, #"{"token":""}"#, "not json"] {
            let redeemer = PairingRedeemer(transport: FakeTransport(status: 200, body: Data(body.utf8)), userAgent: "ua")
            await assertRedeemFails(redeemer, with: .malformedResponse)
        }
    }

    func testTransportFailureKeepsTheURLErrorCode() async {
        let redeemer = PairingRedeemer(transport: FakeTransport(error: URLError(.cannotConnectToHost)), userAgent: "ua")

        await assertRedeemFails(redeemer, with: .transport(.cannotConnectToHost))
    }

    private func assertRedeemFails(
        _ redeemer: PairingRedeemer,
        with expected: PairingError,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            let token = try await redeemer.redeem(baseURL: baseURL, pairingToken: "p", deviceLabel: "d")
            XCTFail("expected \(expected), got token \(token)", file: file, line: line)
        } catch {
            XCTAssertEqual(error, expected, file: file, line: line)
        }
    }
}

/// Answers every request with one canned response, and records the requests.
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [URLRequest] = []
    private let outcome: Result<(Int, Data), URLError>

    init(status: Int, body: Data) {
        outcome = .success((status, body))
    }

    init(error: URLError) {
        outcome = .failure(error)
    }

    var requests: [URLRequest] {
        lock.withLock { recorded }
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        lock.withLock { recorded.append(request) }
        let (status, body) = try outcome.get()
        let url = try XCTUnwrap(request.url)
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil))
        return (body, response)
    }
}
