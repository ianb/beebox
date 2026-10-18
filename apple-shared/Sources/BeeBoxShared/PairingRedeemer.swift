import Foundation

/// Why a pairing ticket could not be redeemed.
public enum PairingError: Error, Equatable, Sendable {
    /// The box answered with a non-2xx status. `message` is the box's `error`
    /// text when it sent one ("Pairing code is invalid or expired." for a 401).
    case rejected(status: Int, message: String?)
    /// The request never got an HTTP answer.
    case transport(URLError.Code)
    /// A 2xx answer without a usable `token`.
    case malformedResponse
}

/// Redeems a pairing ticket for a device token: `POST <baseURL>/api/pairing/redeem`,
/// `beebox/docs/mobile-contract.md` §1.3.
public struct PairingRedeemer: Sendable {
    private let transport: any HTTPTransport
    private let userAgent: String

    public init(transport: any HTTPTransport, userAgent: String) {
        self.transport = transport
        self.userAgent = userAgent
    }

    /// Returns the device token.
    public func redeem(baseURL: URL, pairingToken: String, deviceLabel: String) async throws(PairingError) -> String {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/pairing/redeem"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        do {
            request.httpBody = try JSONEncoder().encode(RedeemRequest(pairingToken: pairingToken, deviceLabel: deviceLabel))
        } catch {
            preconditionFailure("encoding two strings cannot fail: \(error)")
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
        guard let http = response as? HTTPURLResponse else {
            throw .malformedResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(RedeemErrorBody.self, from: data))?.error
            throw .rejected(status: http.statusCode, message: message)
        }
        guard let body = try? JSONDecoder().decode(RedeemResponse.self, from: data), !body.token.isEmpty else {
            throw .malformedResponse
        }
        return body.token
    }
}

struct RedeemRequest: Codable, Equatable {
    var pairingToken: String
    var deviceLabel: String
}

private struct RedeemResponse: Decodable {
    var token: String
}

private struct RedeemErrorBody: Decodable {
    var error: String
}
