import BeeBoxShared
import Combine
import Foundation

/// The pairing sheet on Preferences → Boxes: the pasted link, what it would
/// add, and how the attempt went. Nothing is redeemed until `add()`.
@MainActor
public final class PairingSheetModel: ObservableObject {
    /// What the sheet would add, shown before Add.
    public struct Preview: Equatable, Sendable {
        public let label: String
        public let host: String
        public let encrypted: Bool

        public init(label: String, host: String, encrypted: Bool) {
            self.label = label
            self.host = host
            self.encrypted = encrypted
        }
    }

    public enum State: Equatable, Sendable {
        case empty
        case notALink
        /// Plain http to an address outside the local network.
        case refused(Preview)
        case ready(Preview)
        case pairing(Preview)
        case failed(Preview, message: String)
        case paired(label: String)
    }

    public static let helpText = "On your box, open Settings, choose Copy Link (Mac) under Companion Apps, then paste the link here."

    @Published public var text = "" {
        didSet { if text != oldValue { reparse() } }
    }
    @Published public private(set) var state: State = .empty
    /// A pairing link found on the clipboard, offered rather than pasted: the
    /// person chooses to use it.
    @Published public private(set) var clipboardOffer: Preview?
    private var offeredText: String?

    private var link: PairingLink?
    private let pair: (PairingLink) async -> PairResult

    public init(pair: @escaping (PairingLink) async -> PairResult) {
        self.pair = pair
    }

    /// Offers the clipboard's pairing link, if it holds one. Unrelated
    /// clipboard text is never shown.
    public func offer(fromPasteboard string: String?) {
        guard let string, let link = Self.parse(string) else {
            clipboardOffer = nil
            offeredText = nil
            return
        }
        offeredText = string.trimmingCharacters(in: .whitespacesAndNewlines)
        clipboardOffer = Self.preview(link)
    }

    /// Puts the offered clipboard link in the field.
    public func useClipboardOffer() {
        guard let offeredText else { return }
        text = offeredText
        clipboardOffer = nil
    }

    public var canAdd: Bool {
        if case .ready = state { return true }
        if case .failed = state { return true }
        return false
    }

    public func add() async {
        guard canAdd, let link else { return }
        let preview = Self.preview(link)
        state = .pairing(preview)
        let result = await pair(link)
        // The person may have pasted another link while this one was redeeming.
        guard self.link == link else { return }
        switch result {
        case .paired(let box):
            state = .paired(label: box.label)
        case .duplicate:
            state = .failed(preview, message: "This link is already being used. Wait a moment, or make a new link on the box.")
        case .refusedTransport:
            state = .refused(preview)
        case .noTicket:
            state = .failed(preview, message: "This link has no pairing code. \(Self.helpText)")
        case .failed(let error):
            state = .failed(preview, message: Self.message(for: error))
        case .storeFailed:
            state = .failed(preview, message: "The box paired, but this Mac could not save the credential in the Keychain. Make a new link on the box and try again.")
        }
    }

    public static func message(for error: PairingError) -> String {
        switch error {
        case .rejected(status: 401, let serverMessage):
            return (serverMessage ?? "This link has expired or was already used.") + " Make a new link on the box and try again."
        case .rejected(let status, let serverMessage):
            return "The box refused pairing (HTTP \(status))." + (serverMessage.map { " \($0)" } ?? "")
        case .transport(let code):
            return "Could not reach the box (\(Self.describe(code))). Check that it is running and that this Mac can reach it."
        case .malformedResponse:
            return "The box answered, but not with a pairing. It may be running an older version."
        }
    }

    private func reparse() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            link = nil
            state = .empty
            return
        }
        guard let parsed = Self.parse(trimmed) else {
            link = nil
            state = .notALink
            return
        }
        link = parsed
        let preview = Self.preview(parsed)
        state = PairingTransport(baseURL: parsed.baseURL).allowsRedeem ? .ready(preview) : .refused(preview)
    }

    private static func parse(_ text: String) -> PairingLink? {
        URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines))
            .flatMap { PairingLink.parse($0, allowDirectAuthToken: false) }
    }

    private static func preview(_ link: PairingLink) -> Preview {
        let host = link.baseURL.host() ?? link.baseURL.absoluteString
        return Preview(
            label: link.label,
            host: link.baseURL.port.map { "\(host):\($0)" } ?? host,
            encrypted: PairingTransport(baseURL: link.baseURL) == .encrypted
        )
    }

    private static func describe(_ code: URLError.Code) -> String {
        switch code {
        case .cannotFindHost: "host not found"
        case .cannotConnectToHost: "connection refused"
        case .timedOut: "timed out"
        case .notConnectedToInternet: "offline"
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate:
            "secure connection failed"
        case .appTransportSecurityRequiresSecureConnection: "blocked: not encrypted"
        default: "error \(code.rawValue)"
        }
    }
}
