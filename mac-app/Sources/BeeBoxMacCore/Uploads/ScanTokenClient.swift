import BeeBoxShared
import Foundation

public enum ScanTokenError: Error, Equatable, Sendable {
    /// 403: the box has no person recorded for this device (a pairing older
    /// than that record), and a scan token must belong to someone.
    case pairedByNobody
    /// 401: the box no longer accepts this Mac's device token.
    case deviceRefused
    case rejected(status: Int, message: String?)
    case transport(URLError.Code)
    case malformedResponse
}

/// Mints and revokes this Mac's scan token on a box, over its device token
/// (`scanTokens.create` / `scanTokens.revoke`; a paired device acts as the
/// person who paired it, and anyone with access to the box may mint one).
public struct ScanTokenClient: Sendable {
    private let transport: any HTTPTransport
    private let userAgent: String

    public init(transport: any HTTPTransport, userAgent: String) {
        self.transport = transport
        self.userAgent = userAgent
    }

    /// A fresh name for each mint. The box never lets a name be reused, even
    /// after a revoke, so a fixed name would fail on the second mint.
    public static func newTokenName(host: String, now: Date, random: String) -> String {
        let cleanHost = host
            .lowercased()
            .replacingOccurrences(of: "[^a-z0-9.-]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-."))
        let day = now.formatted(.iso8601.year().month().day().dateSeparator(.omitted))
        let hostPart = String((cleanHost.isEmpty ? "mac" : cleanHost).prefix(40))
        return "mac-\(hostPart)-\(day)-\(random.prefix(4))"
    }

    /// Returns the plaintext token, which the box shows only this once.
    public func mint(baseURL: URL, deviceToken: String, name: String) async throws(ScanTokenError) -> String {
        let data = try await call(baseURL: baseURL, deviceToken: deviceToken, procedure: "scanTokens.create", input: ["name": name])
        guard let envelope = try? JSONDecoder().decode(Envelope<Minted>.self, from: data),
              !envelope.result.data.token.isEmpty else {
            throw .malformedResponse
        }
        return envelope.result.data.token
    }

    /// A token the box no longer has (404) counts as revoked.
    public func revoke(baseURL: URL, deviceToken: String, name: String) async throws(ScanTokenError) {
        do {
            _ = try await call(baseURL: baseURL, deviceToken: deviceToken, procedure: "scanTokens.revoke", input: ["name": name])
        } catch .rejected(status: 404, _) {
            return
        }
    }

    private func call(baseURL: URL, deviceToken: String, procedure: String, input: [String: String]) async throws(ScanTokenError) -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/trpc/\(procedure)"))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
        do {
            request.httpBody = try JSONEncoder().encode(input)
        } catch {
            preconditionFailure("encoding a string dictionary cannot fail: \(error)")
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch let error as URLError {
            throw .transport(error.code)
        } catch {
            throw .transport(.unknown)
        }
        guard let http = response as? HTTPURLResponse else { throw .malformedResponse }
        switch http.statusCode {
        case 200..<300:
            return data
        case 401:
            throw .deviceRefused
        case 403:
            throw .pairedByNobody
        default:
            let message = (try? JSONDecoder().decode(ErrorEnvelope.self, from: data))?.error.message
            throw .rejected(status: http.statusCode, message: message)
        }
    }

    private struct Envelope<Value: Decodable>: Decodable {
        struct Result: Decodable { var data: Value }
        var result: Result
    }

    private struct Minted: Decodable {
        var token: String
    }

    private struct ErrorEnvelope: Decodable {
        struct Body: Decodable { var message: String }
        var error: Body
    }
}
