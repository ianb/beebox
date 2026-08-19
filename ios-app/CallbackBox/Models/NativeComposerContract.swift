import Foundation

struct NativeEmissionFile: Codable, Equatable, Identifiable {
    var id: Int
    var path: String
    var originalName: String
    var size: Int
    var mimetype: String
}

struct NativeEmissionSelection: Codable, Equatable, Identifiable {
    var id: Int
    var ref: String
    var text: String
    var position: String
    var anchor: String?
    var spokenWords: Int?
}

struct NativeEmissionV2: Codable, Equatable {
    enum Origin: String, Codable, Sendable {
        case typed
        case voice
    }

    enum DecodeError: Error, Equatable {
        case unsupportedVersion(Int)
    }

    var version = 2
    var id: String
    var origin: Origin
    var text: String
    var diarized: Bool
    var images: [ChatImageAttachment]
    var files: [NativeEmissionFile]
    var selections: [NativeEmissionSelection]

    init(emission: NativeChatEmission) {
        id = emission.id.uuidString
        origin = emission.origin
        text = emission.text
        diarized = emission.diarized
        images = emission.images
        files = emission.files
        selections = emission.selections
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        guard version == 2 else {
            throw DecodeError.unsupportedVersion(version)
        }
        id = try container.decode(String.self, forKey: .id)
        origin = try container.decode(Origin.self, forKey: .origin)
        text = try container.decode(String.self, forKey: .text)
        diarized = try container.decode(Bool.self, forKey: .diarized)
        images = try container.decode([ChatImageAttachment].self, forKey: .images)
        files = try container.decode([NativeEmissionFile].self, forKey: .files)
        selections = try container.decode([NativeEmissionSelection].self, forKey: .selections)
    }
}

struct NativeComposerCommand: Codable, Equatable, Identifiable {
    enum Kind: String, Codable {
        case addSelection = "add-selection"
    }

    struct Selection: Codable, Equatable {
        var ref: String
        var text: String
        var position: String
    }

    enum DecodeError: Error, Equatable {
        case unsupportedVersion(Int)
        case emptyID
    }

    var version: Int
    var id: String
    var kind: Kind
    var selection: Selection

    init(id: String, selection: Selection) {
        version = 1
        self.id = id
        kind = .addSelection
        self.selection = selection
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        guard version == 1 else {
            throw DecodeError.unsupportedVersion(version)
        }
        id = try container.decode(String.self, forKey: .id)
        guard !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodeError.emptyID
        }
        kind = try container.decode(Kind.self, forKey: .kind)
        selection = try container.decode(Selection.self, forKey: .selection)
    }
}

struct NativeComposerCommandAcknowledgement: Codable, Equatable, Identifiable {
    enum DecodeError: Error, Equatable {
        case unsupportedVersion(Int)
        case emptyID
        case missingRejectionReason
    }

    var version = 1
    var id: String
    var accepted: Bool
    var reason: String?

    private init(id: String, accepted: Bool, reason: String?) {
        self.id = id
        self.accepted = accepted
        self.reason = reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        guard version == 1 else {
            throw DecodeError.unsupportedVersion(version)
        }
        id = try container.decode(String.self, forKey: .id)
        guard !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodeError.emptyID
        }
        accepted = try container.decode(Bool.self, forKey: .accepted)
        reason = try container.decodeIfPresent(String.self, forKey: .reason)
        if !accepted, reason?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            throw DecodeError.missingRejectionReason
        }
    }

    static func accepted(id: String) -> NativeComposerCommandAcknowledgement {
        NativeComposerCommandAcknowledgement(id: id, accepted: true, reason: nil)
    }

    static func rejected(id: String, reason: String) -> NativeComposerCommandAcknowledgement {
        NativeComposerCommandAcknowledgement(id: id, accepted: false, reason: reason)
    }
}

/// A box agent's request for the original recording of one voice message,
/// relayed to the shell by the web layer (contract §4.8). Native answers the
/// box directly over HTTP; nothing goes back across the bridge.
///
/// Both ids are required and non-blank: `requestId` is the answer's URL
/// segment, and `messageId` must be echoed on the answer or the server's
/// echo-and-verify check discards it. `sessionId` is the relaying tab's own
/// chat session, echoed back unchanged — nil before the tab has one.
struct NativeLastAudioRequest: Codable, Equatable {
    enum DecodeError: Error, Equatable {
        case unsupportedVersion(Int)
        case emptyRequestID
        case emptyMessageID
    }

    var version = 1
    var requestID: String
    var messageID: String
    var sessionID: String?

    private enum CodingKeys: String, CodingKey {
        case version
        case requestID = "requestId"
        case messageID = "messageId"
        case sessionID = "sessionId"
    }

    init(requestID: String, messageID: String, sessionID: String?) {
        self.requestID = requestID
        self.messageID = messageID
        self.sessionID = sessionID
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        guard version == 1 else {
            throw DecodeError.unsupportedVersion(version)
        }
        requestID = try container.decode(String.self, forKey: .requestID)
        guard !requestID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodeError.emptyRequestID
        }
        messageID = try container.decode(String.self, forKey: .messageID)
        guard !messageID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodeError.emptyMessageID
        }
        sessionID = try container.decodeIfPresent(String.self, forKey: .sessionID)
    }
}
