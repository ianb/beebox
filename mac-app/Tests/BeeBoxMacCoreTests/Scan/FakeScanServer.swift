import BeeBoxShared
import Foundation

/// A fake implementation of the server half of the scan-upload wire contract
/// (docs/scan-upload-contract.md), mirroring `scan-uploader/test/cli/fake-scan-server.ts`.
/// It answers in-process, so tests need no network and no ports.
final class FakeScanServer: HTTPTransport, @unchecked Sendable {
    enum CheckState: Sendable {
        case unknown, pending, imported
        case rejected(reason: String)
    }

    enum PutOutcome: Sendable {
        case accepted
        case duplicate
        case rejected(reason: String)
        case hashMismatch
        case tooLarge
        /// The `Retry-After` header value, or nil to omit the header.
        case rateLimited(retryAfter: String?)
        case serverError(reason: String?)
        case unauthorized
        /// Any status the client has no case for, with a `message` body.
        case other(status: Int, message: String)
    }

    struct Identity: Equatable {
        var contract: String?
        var build: String?
        var builtAt: String?
        var profile: String?
    }

    struct CheckRequest {
        var url: URL
        var hashes: [String]
        var authorization: String?
        var identity: Identity
    }

    struct PutRequest {
        var url: URL
        var pathHash: String
        var filename: String
        var authorization: String?
        var contentType: String?
        var contentLength: String?
        var body: Data
        var identity: Identity
    }

    /// The state for each requested hash. Called while the check is answered,
    /// which is after the client hashed and before it disposes: a test can
    /// mutate a file from inside it to simulate the scanner racing the client.
    var checkState: @Sendable (String) -> CheckState = { _ in .unknown }
    var putOutcome: @Sendable (PutRequest) -> PutOutcome = { _ in .accepted }
    /// nil omits `contractVersion` from the response, like a box predating the field.
    var contractVersion: @Sendable () -> Any? = { nil }
    /// `false` answers the check with 401.
    var checkAuthorization: @Sendable (String?) -> Bool = { _ in true }
    /// Short-circuits the check with an arbitrary status and JSON body.
    var checkFailure: @Sendable () -> (status: Int, body: [String: Any])? = { nil }
    /// Fails every request at the transport level, like a box that is down.
    var transportError: URLError.Code?

    private let lock = NSLock()
    private var checks: [CheckRequest] = []
    private var puts: [PutRequest] = []

    var checkRequests: [CheckRequest] { lock.withLock { checks } }
    var putRequests: [PutRequest] { lock.withLock { puts } }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        if let transportError { throw URLError(transportError) }
        let url = try requestURL(request)
        let path = url.path
        if request.httpMethod == "POST", path.hasSuffix("/api/scan/check") {
            return try handleCheck(request, url: url)
        }
        if request.httpMethod == "PUT", let range = path.range(of: "/api/scan/files/") {
            return try handlePut(request, url: url, hash: String(path[range.upperBound...]))
        }
        return try respond(url, status: 404, body: Data())
    }

    private func handleCheck(_ request: URLRequest, url: URL) throws -> (Data, URLResponse) {
        guard checkAuthorization(request.value(forHTTPHeaderField: "authorization")) else {
            return try respond(url, status: 401, json: ["error": "unauthorized"])
        }
        if let failure = checkFailure() {
            return try respond(url, status: failure.status, json: failure.body)
        }
        let object = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
        let hashes = (object?["hashes"] as? [String]) ?? []
        lock.withLock {
            checks.append(CheckRequest(
                url: url,
                hashes: hashes,
                authorization: request.value(forHTTPHeaderField: "authorization"),
                identity: identity(of: request)
            ))
        }
        var states: [String: Any] = [:]
        for hash in hashes {
            switch checkState(hash) {
            case .unknown: states[hash] = ["state": "unknown"]
            case .pending: states[hash] = ["state": "pending"]
            case .imported: states[hash] = ["state": "imported"]
            case let .rejected(reason): states[hash] = ["state": "rejected", "reason": reason]
            }
        }
        var payload: [String: Any] = ["states": states]
        if let version = contractVersion() { payload["contractVersion"] = version }
        return try respond(url, status: 200, json: payload)
    }

    private func handlePut(_ request: URLRequest, url: URL, hash: String) throws -> (Data, URLResponse) {
        let record = PutRequest(
            url: url,
            pathHash: hash,
            filename: request.value(forHTTPHeaderField: "x-upload-filename") ?? "",
            authorization: request.value(forHTTPHeaderField: "authorization"),
            contentType: request.value(forHTTPHeaderField: "content-type"),
            contentLength: request.value(forHTTPHeaderField: "content-length"),
            body: request.httpBody ?? Data(),
            identity: identity(of: request)
        )
        lock.withLock { puts.append(record) }
        switch putOutcome(record) {
        case .accepted: return try respond(url, status: 200, json: ["status": "accepted"])
        case .duplicate: return try respond(url, status: 200, json: ["status": "duplicate"])
        case let .rejected(reason): return try respond(url, status: 422, json: ["status": "rejected", "reason": reason])
        case .hashMismatch: return try respond(url, status: 422, json: ["status": "hash-mismatch"])
        case .tooLarge: return try respond(url, status: 413, body: Data())
        case let .rateLimited(retryAfter):
            return try respond(url, status: 429, body: Data(), headers: retryAfter.map { ["Retry-After": $0] } ?? [:])
        case let .serverError(reason):
            var body: [String: Any] = ["status": "server-error"]
            if let reason { body["reason"] = reason }
            return try respond(url, status: 503, json: body)
        case .unauthorized: return try respond(url, status: 401, json: ["error": "unauthorized"])
        case let .other(status, message): return try respond(url, status: status, json: ["message": message])
        }
    }

    private func identity(of request: URLRequest) -> Identity {
        Identity(
            contract: request.value(forHTTPHeaderField: "x-scan-contract"),
            build: request.value(forHTTPHeaderField: "x-scan-client-build"),
            builtAt: request.value(forHTTPHeaderField: "x-scan-client-built-at"),
            profile: request.value(forHTTPHeaderField: "x-scan-profile")
        )
    }

    private func respond(_ url: URL, status: Int, json: [String: Any]) throws -> (Data, URLResponse) {
        try respond(url, status: status, body: JSONSerialization.data(withJSONObject: json))
    }

    private func respond(_ url: URL, status: Int, body: Data, headers: [String: String] = [:]) throws -> (Data, URLResponse) {
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            throw URLError(.badServerResponse)
        }
        return (body, response)
    }

    private func requestURL(_ request: URLRequest) throws -> URL {
        guard let url = request.url else { throw URLError(.badURL) }
        return url
    }
}
