import Foundation

/// A parsed `beebox://pair` link: `beebox/docs/mobile-contract.md` §1.1.
///
/// The link carries a secret (a single-use pairing ticket, or in DEBUG builds a
/// device token), so callers never log or store it.
public struct PairingLink: Equatable, Sendable {
    public let baseURL: URL
    public let label: String
    public let pairingToken: String?
    public let sessionID: String?
    /// A device token carried in the link itself. Set only when the caller
    /// allows it (DEBUG builds); release builds always redeem a ticket.
    public let directAuthToken: String?

    public static let defaultLabel = "Bee Box"

    /// Returns nil when `url` is not a pairing link or has no usable base URL.
    public static func parse(_ url: URL, allowDirectAuthToken: Bool) -> PairingLink? {
        guard url.scheme == "beebox", url.host == "pair" else {
            return nil
        }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        // The box builds the link with URLSearchParams, which writes a space as
        // `+` (form encoding); URLComponents alone would keep the `+`.
        let items = (components.percentEncodedQueryItems ?? []).map { item in
            URLQueryItem(
                name: item.name,
                value: item.value.flatMap { $0.replacingOccurrences(of: "+", with: "%20").removingPercentEncoding }
            )
        }
        guard let baseURLString = items.value(named: "baseURL") ?? items.value(named: "url") else {
            return nil
        }
        guard let baseURL = URL(string: baseURLString), baseURL.scheme != nil, baseURL.host != nil else {
            return nil
        }
        return PairingLink(
            baseURL: baseURL,
            label: items.value(named: "label") ?? defaultLabel,
            pairingToken: items.value(named: "pairingToken") ?? items.value(named: "token"),
            sessionID: items.value(named: "session"),
            directAuthToken: allowDirectAuthToken ? items.value(named: "authToken") : nil
        )
    }
}

private extension Array where Element == URLQueryItem {
    func value(named name: String) -> String? {
        first { $0.name == name }?.value
    }
}
