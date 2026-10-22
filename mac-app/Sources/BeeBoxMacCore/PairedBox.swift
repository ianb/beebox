import Foundation

/// A box this Mac is paired with. Its device token lives in the Keychain under
/// `id`, never in this record.
///
/// The iOS app has its own `PairedBox` with phone-only fields (session, device
/// lock); the two share the wire contract and the credential store, not the
/// record.
public struct PairedBox: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var label: String
    public var baseURL: URL
    /// The box this app runs in its VM, rather than one reached over the network.
    public var hostedLocally: Bool

    public init(id: UUID, label: String, baseURL: URL, hostedLocally: Bool) {
        self.id = id
        self.label = label
        self.baseURL = baseURL
        self.hostedLocally = hostedLocally
    }

    /// Whether `url` names this box. The runtime reports `…/box/` and the box's
    /// pairing link says `…/box`; both are the same box.
    public func isSameBox(as url: URL) -> Bool {
        Self.key(baseURL) == Self.key(url)
    }

    private static func key(_ url: URL) -> String {
        var text = url.absoluteString.lowercased()
        while text.hasSuffix("/") { text.removeLast() }
        return text
    }

    /// The host and port a person recognizes, for lists and previews.
    public var displayHost: String {
        let host = baseURL.host() ?? baseURL.absoluteString
        return baseURL.port.map { "\(host):\($0)" } ?? host
    }
}
