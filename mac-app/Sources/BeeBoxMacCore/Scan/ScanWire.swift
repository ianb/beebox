import BeeBoxShared
import Foundation

// WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
//
// The client half of the contract: request shapes, headers, the status
// vocabulary and the response parse. Ports `wire-client.ts`.

/// Per-hash state from `POST /api/scan/check`.
enum CheckState: String {
    case unknown, pending, imported, rejected
}

struct CheckResult: Equatable {
    var state: CheckState
    var reason: String?
}

struct CheckResponse {
    var states: [String: CheckResult]
    /// Absent from a box predating the field, or unreadable: "no opinion".
    var contractVersion: Int?
}

/// The resolved outcome of one PUT.
enum PutResult: Equatable {
    case accepted
    case duplicate
    case rejected(reason: String)
    case hashMismatch
    case tooLarge
    case serverError(reason: String)
    case rateLimited(retryAfterSeconds: Double)
}

/// What stops a sweep: the request got no usable answer, or the box refused
/// the credential.
enum WireFailure: Error, Equatable {
    case transport(URLError.Code)
    case credentialRefused
    /// 503 on the check route.
    case unavailable
    case rateLimited(retryAfterSeconds: Double)
    /// A status or body outside the contract. The Node client throws
    /// `ProtocolError`, which abandons the run.
    case protocolViolation(String)
}

struct ScanWire: Sendable {
    /// Per-hash entries accepted by one check call. The server caps this at 500.
    // WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
    static let checkBatchLimit = 500
    static let defaultRetryAfterSeconds = 5.0

    let transport: any HTTPTransport
    let baseURL: URL
    let token: String
    let clientBuild: String

    // WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
    func check(_ hashes: [String]) async throws(WireFailure) -> CheckResponse {
        var request = makeRequest(path: "api/scan/check", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["hashes": hashes])
        let (data, response) = try await send(request)
        switch response.statusCode {
        case 200: break
        case 401: throw .credentialRefused
        case 503: throw .unavailable
        case 429: throw .rateLimited(retryAfterSeconds: Self.parseRetryAfter(response.value(forHTTPHeaderField: "retry-after")))
        default: throw .protocolViolation("check returned HTTP \(response.statusCode)")
        }
        guard let body = Self.jsonObject(data), let rawStates = body["states"] as? [String: Any] else {
            throw .protocolViolation("check response missing a states object")
        }
        var states: [String: CheckResult] = [:]
        for (hash, value) in rawStates {
            guard let entry = value as? [String: Any],
                  let name = entry["state"] as? String,
                  let state = CheckState(rawValue: name)
            else {
                throw .protocolViolation("check response entry has an unrecognized state")
            }
            states[hash] = CheckResult(state: state, reason: entry["reason"] as? String)
        }
        return CheckResponse(states: states, contractVersion: Self.parseContractVersion(body["contractVersion"]))
    }

    // WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
    /// `X-Scan-Profile` is not sent: the Node client never sends it either.
    func put(hash: String, filename: String, body: Data) async throws(WireFailure) -> PutResult {
        var request = makeRequest(path: "api/scan/files/\(hash)", method: "PUT")
        request.setValue("application/octet-stream", forHTTPHeaderField: "content-type")
        request.setValue(String(body.count), forHTTPHeaderField: "content-length")
        request.setValue(filename, forHTTPHeaderField: "x-upload-filename")
        request.httpBody = body
        let (data, response) = try await send(request)
        switch response.statusCode {
        case 200:
            switch Self.jsonObject(data)?["status"] as? String {
            case "accepted": return .accepted
            case "duplicate": return .duplicate
            default: throw .protocolViolation("unexpected 200 body on PUT")
            }
        case 422:
            let object = Self.jsonObject(data)
            if object?["status"] as? String == "rejected", let reason = object?["reason"] as? String {
                return .rejected(reason: reason)
            }
            if object?["status"] as? String == "hash-mismatch" { return .hashMismatch }
            throw .protocolViolation("unexpected 422 body on PUT")
        case 413:
            return .tooLarge
        case 429:
            return .rateLimited(retryAfterSeconds: Self.parseRetryAfter(response.value(forHTTPHeaderField: "retry-after")))
        case 503:
            let object = Self.jsonObject(data)
            if object?["status"] as? String == "server-error", let reason = object?["reason"] as? String {
                return .serverError(reason: reason)
            }
            return .serverError(reason: "server temporarily unable to validate this file")
        case 401:
            throw .credentialRefused
        default:
            throw .protocolViolation("unexpected HTTP status \(response.statusCode)")
        }
    }

    // WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
    /// Who this client is, on every request. `x-scan-client-built-at` is left
    /// out on purpose so the box's freshness check applies the contract test
    /// only. Never an `x-bbx-` name: the hub strips that namespace.
    private func makeRequest(path: String, method: String) -> URLRequest {
        var request = URLRequest(url: routeURL(path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        request.setValue(String(scanContractVersion), forHTTPHeaderField: "x-scan-contract")
        request.setValue(clientBuild, forHTTPHeaderField: "x-scan-client-build")
        return request
    }

    private func routeURL(_ path: String) -> URL {
        var base = baseURL.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        return URL(string: "\(base)/\(path)") ?? baseURL.appendingPathComponent(path)
    }

    private func send(_ request: URLRequest) async throws(WireFailure) -> (Data, HTTPURLResponse) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch let error as URLError {
            throw .transport(error.code)
        } catch {
            throw .transport(.unknown)
        }
        guard let http = response as? HTTPURLResponse else {
            throw .protocolViolation("response was not HTTP")
        }
        return (data, http)
    }

    private static func jsonObject(_ data: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// A non-integer, negative or non-number value is "absent": a diagnostic
    /// field must never stop a sweep.
    static func parseContractVersion(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double >= 0, double == double.rounded(), double < Double(Int.max) else { return nil }
        return Int(double)
    }

    /// Seconds, defaulting to 5 when the header is absent, unparseable or
    /// negative, like `parseRetryAfter` in `wire-client.ts`.
    static func parseRetryAfter(_ header: String?) -> Double {
        guard let header else { return defaultRetryAfterSeconds }
        let trimmed = header.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return 0 }
        guard let seconds = Double(trimmed), seconds.isFinite, seconds >= 0 else { return defaultRetryAfterSeconds }
        return seconds
    }
}
