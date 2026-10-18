import BeeBoxShared
import Foundation
import XCTest

/// Answers every request with one canned response and counts requests.
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private let status: Int
    private let body: Data

    init(status: Int, body: String) {
        self.status = status
        self.body = Data(body.utf8)
    }

    var requestCount: Int { lock.withLock { count } }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        lock.withLock { count += 1 }
        let url = try XCTUnwrap(request.url)
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil))
        return (body, response)
    }
}

final class FakeCredentials: PairedBoxCredentialStoreProtocol, @unchecked Sendable {
    var tokens: [UUID: String] = [:]
    var failWrites = false
    var failDeletes = false

    struct Failure: Error {}

    func readToken(for boxID: UUID) -> String? { tokens[boxID] }

    func writeToken(_ token: String, for boxID: UUID) throws {
        if failWrites { throw Failure() }
        tokens[boxID] = token
    }

    func deleteToken(for boxID: UUID) throws {
        if failDeletes { throw Failure() }
        tokens[boxID] = nil
    }

    func purgeOrphanTokens(knownBoxIDs: Set<UUID>) -> Int { 0 }
}

func scratchFile(_ name: String) -> URL {
    FileManager.default.temporaryDirectory
        .appendingPathComponent("beebox-mac-tests-\(UUID().uuidString)")
        .appendingPathComponent(name)
}

func pairingLink(
    _ base: String = "https://workshop.example.ts.net/workshop",
    label: String = "Workshop",
    ticket: String? = "ticket-1"
) -> PairingLink {
    var components = URLComponents(string: "beebox://pair")!
    var items = [URLQueryItem(name: "baseURL", value: base), URLQueryItem(name: "label", value: label)]
    if let ticket { items.append(URLQueryItem(name: "pairingToken", value: ticket)) }
    components.queryItems = items
    return PairingLink.parse(components.url!, allowDirectAuthToken: false)!
}
