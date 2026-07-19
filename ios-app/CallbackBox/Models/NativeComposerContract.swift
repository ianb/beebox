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
    enum Origin: String, Codable {
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
    }

    var version: Int
    var id: String
    var kind: Kind
    var selection: Selection

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        guard version == 1 else {
            throw DecodeError.unsupportedVersion(version)
        }
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(Kind.self, forKey: .kind)
        selection = try container.decode(Selection.self, forKey: .selection)
    }
}
