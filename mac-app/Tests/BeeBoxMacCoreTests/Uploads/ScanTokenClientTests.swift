import BeeBoxMacCore
import BeeBoxShared
import Foundation
import XCTest

final class ScanTokenClientTests: XCTestCase {
    private let base = URL(string: "https://workshop.example.ts.net/workshop")!

    func testMintPostsTheNameWithTheDeviceTokenAndReturnsThePlaintext() async throws {
        let transport = RecordingTransport(status: 200, body: #"{"result":{"data":{"name":"mac-x","token":"scan-secret","createdAt":"2026-10-17T00:00:00Z"}}}"#)
        let client = ScanTokenClient(transport: transport, userAgent: "ua")

        let token = try await client.mint(baseURL: base, deviceToken: "device", name: "mac-x")

        XCTAssertEqual(token, "scan-secret")
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.url?.absoluteString, "https://workshop.example.ts.net/workshop/api/trpc/scanTokens.create")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer device")
        XCTAssertEqual(try JSONDecoder().decode([String: String].self, from: XCTUnwrap(request.httpBody)), ["name": "mac-x"])
    }

    func testStatusesMapToProblems() async {
        let cases: [(Int, String, ScanTokenError)] = [
            (401, "{}", .deviceRefused),
            (403, #"{"error":{"message":"A scan uploader records who set it up, so it needs a signed-in person."}}"#, .pairedByNobody),
            (409, #"{"error":{"message":"taken"}}"#, .rejected(status: 409, message: "taken")),
            (200, #"{"result":{"data":{}}}"#, .malformedResponse),
        ]
        for (status, body, expected) in cases {
            let client = ScanTokenClient(transport: RecordingTransport(status: status, body: body), userAgent: "ua")
            do {
                _ = try await client.mint(baseURL: base, deviceToken: "d", name: "n")
                XCTFail("\(status) should fail")
            } catch {
                XCTAssertEqual(error, expected, "\(status)")
            }
        }
    }

    func testRevokingAMissingTokenIsSuccess() async throws {
        let client = ScanTokenClient(transport: RecordingTransport(status: 404, body: #"{"error":{"message":"No active scan token with that name"}}"#), userAgent: "ua")
        try await client.revoke(baseURL: base, deviceToken: "d", name: "n")
    }

    func testTokenNamesFitTheBoxPatternAndDifferPerMint() throws {
        let now = Date(timeIntervalSince1970: 1_792_195_200) // 2026-10-17
        let name = ScanTokenClient.newTokenName(host: "Priya’s MacBook Pro (4)", now: now, random: "3f2a9c")
        XCTAssertEqual(name, "mac-priya-s-macbook-pro-4-20261017-3f2a")
        let pattern = try Regex("^[0-9A-Za-z][\\w.-]{0,63}$")
        XCTAssertNotNil(name.wholeMatch(of: pattern))
        let long = ScanTokenClient.newTokenName(host: String(repeating: "x", count: 200), now: now, random: "abcd")
        XCTAssertNotNil(long.wholeMatch(of: pattern), long)
        XCTAssertNotEqual(name, ScanTokenClient.newTokenName(host: "Priya’s MacBook Pro (4)", now: now, random: "77aa"))
    }
}

/// Answers every request the same way and keeps the requests.
final class RecordingTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [URLRequest] = []
    private let status: Int
    private let body: Data

    init(status: Int, body: String) {
        self.status = status
        self.body = Data(body.utf8)
    }

    var requests: [URLRequest] { lock.withLock { recorded } }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        lock.withLock { recorded.append(request) }
        let url = try XCTUnwrap(request.url)
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil))
        return (body, response)
    }
}
