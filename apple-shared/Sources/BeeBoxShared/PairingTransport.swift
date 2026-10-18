import Foundation

/// How a pairing link's base URL would carry the ticket and, later, the device
/// token. App Transport Security's `NSAllowsLocalNetworking` permits plain http
/// to any IP address, so this check, not ATS, is the boundary.
public enum PairingTransport: Equatable, Sendable {
    case encrypted
    /// Plain http to loopback, a `.local` name, or a private or link-local
    /// address: the network a person's own Mac and box share.
    case localPlainHTTP
    /// Plain http to anything else. Refused before redeem.
    case refusedPlainHTTP
    /// Neither http nor https.
    case unsupportedScheme

    public init(baseURL: URL) {
        switch baseURL.scheme?.lowercased() {
        case "https":
            self = .encrypted
        case "http":
            self = Self.isLocal(host: baseURL.host() ?? "") ? .localPlainHTTP : .refusedPlainHTTP
        default:
            self = .unsupportedScheme
        }
    }

    public var allowsRedeem: Bool {
        self == .encrypted || self == .localPlainHTTP
    }

    static func isLocal(host rawHost: String) -> Bool {
        let host = rawHost.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if host == "localhost" || host.hasSuffix(".local") {
            return true
        }
        if let octets = ipv4Octets(host) {
            switch (octets[0], octets[1]) {
            case (127, _), (10, _), (192, 168), (169, 254): return true
            case (172, 16...31): return true
            case (100, 64...127): return true // Tailscale's CGNAT range
            default: return false
            }
        }
        if host.contains(":") {
            return host == "::1" || host.hasPrefix("fc") || host.hasPrefix("fd") || isLinkLocalIPv6(host)
        }
        return false
    }

    private static func ipv4Octets(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        let octets = parts.compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy((0...255).contains) else { return nil }
        return octets
    }

    /// fe80::/10: the first group is fe80 through febf.
    private static func isLinkLocalIPv6(_ host: String) -> Bool {
        guard let first = host.split(separator: ":").first, first.count == 4,
              let value = Int(first, radix: 16) else { return false }
        return (0xfe80...0xfebf).contains(value)
    }
}
