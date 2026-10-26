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

    /// A page sent from the Clerk; `message` is then the person's note and may be empty.
    struct Page: Codable, Equatable, Sendable {
        var title: String
        var url: String
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
    /// Present on a page sent from the Clerk: the row shows its title, linked.
    var page: Page?
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
    /// Set only by the hub, answering from a sleeping box's snapshot
    /// (contract §5.11): the box's own last answer, as of `savedAt`.
    struct Asleep: Codable, Equatable, Sendable {
        var savedAt: String

        var savedDate: Date? {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: savedAt) {
                return date
            }
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: savedAt)
        }
    }

    var open: [QuickChatView]
    var recentlySent: [QuickChatView]
    var recentChats: [QuickChatRecentChat]
    var shortcuts: [QuickChatShortcut]
    var asleep: Asleep?
}
