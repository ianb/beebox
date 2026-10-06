import Foundation

/// The server's view of one quick chat message (contract §5.11). It carries
/// no probabilities; the record keeps those for calibration.
struct QuickChatView: Codable, Equatable, Identifiable, Sendable {
    enum State: String, Codable, Sendable {
        case needsChoice = "needs-choice"
        case sending
        case sent
        case discarded
    }

    enum Reason: String, Codable, Sendable {
        case uncertain
        case routingUnavailable = "routing-unavailable"
        case destinationGone = "destination-gone"
    }

    struct Destination: Codable, Equatable, Sendable {
        var label: String
        var sessionId: String?
    }

    struct Choice: Codable, Equatable, Identifiable, Sendable {
        var candidateId: String
        var label: String
        var detail: String?

        var id: String { candidateId }
    }

    var id: UUID
    var message: String
    var createdAt: String
    var state: State
    /// `sending` and `sent`.
    var destination: Destination?
    /// `sent`, when the chat was busy.
    var queued: Bool?
    /// `needs-choice`.
    var reason: Reason?
    /// `sending`, after a failed attempt.
    var lastError: String?
    /// `needs-choice`, at most four.
    var choices: [Choice]?
    /// `sending` past the six-day delivery limit: only Open chat and Discard.
    var expired: Bool?
}

struct QuickChatRecentChat: Codable, Equatable, Identifiable, Sendable {
    struct Landmark: Codable, Equatable, Sendable {
        var dir: String
        var label: String
        var symbol: String?
    }

    var sessionId: String
    var label: String
    var lastActivity: String
    /// Nil only for the last chat when no landmark resolves for its directory.
    var landmark: Landmark?

    var id: String { sessionId }
}

/// One of the box's `nav.card` entries. `to` is box-relative with a leading
/// slash, such as `/questions`.
struct QuickChatShortcut: Codable, Equatable, Sendable {
    var label: String
    var to: String
}

/// The `quickChat.home` answer: what the box screen shows.
struct QuickChatHome: Codable, Equatable, Sendable {
    var open: [QuickChatView]
    var recentlySent: [QuickChatView]
    var recentChats: [QuickChatRecentChat]
    var shortcuts: [QuickChatShortcut]
}
