import Foundation

struct CaptureSessionID: Codable, Equatable, Hashable, RawRepresentable, Sendable {
    var rawValue: String

    init(rawValue: String) {
        self.rawValue = rawValue
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        rawValue = try container.decode(String.self)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

struct CaptureCounts: Codable, Equatable, Sendable {
    var photos: Int
    var files: Int
    var audioSegments: Int
}

struct ResumableCapture: Codable, Equatable, Identifiable, Sendable {
    var id: CaptureSessionID
    var counts: CaptureCounts
    var startedAt: String
}

enum CaptureRecovery: Equatable, Sendable {
    case sessionGone(CaptureSessionID)
    case alreadySealed(CaptureSessionID)
}

enum CaptureFailure: Error, Equatable, Sendable {
    case invalidManifest(String)
    case invalidTransition(from: CaptureItemState, to: CaptureItemState)
    case payloadMissing(String)
    case payloadTooLarge(byteCount: Int64)
    case unsupportedPhoto(String)
}

enum CapturePhase: Equatable, Sendable {
    case bootstrapping
    case choosingResume([ResumableCapture])
    case active(CaptureSessionID)
    case sealing(CaptureSessionID)
    case recovery(CaptureRecovery)
    case failed(CaptureFailure)
}

enum CaptureKind: String, Codable, Equatable, Sendable {
    case audio
    case photo
    case file
}

enum CaptureAudioFormat: String, Codable, Equatable, Sendable {
    case webmOpus = "webm-opus"
    case m4aAAC = "m4a-aac"
}

enum CapturePhotoFormat: String, Codable, Equatable, Sendable {
    case jpeg
    case png

    var fileExtension: String {
        switch self {
        case .jpeg:
            "jpg"
        case .png:
            "png"
        }
    }

    var mimeType: String {
        switch self {
        case .jpeg:
            "image/jpeg"
        case .png:
            "image/png"
        }
    }
}

enum CaptureItemState: Codable, Equatable, Sendable {
    case recording
    case local
    case uploading(taskIdentifier: Int)
    case uploaded
    case failed(message: String)

    private enum CodingKeys: String, CodingKey {
        case state
        case taskIdentifier
        case message
    }

    private enum StateName: String, Codable {
        case recording
        case local
        case uploading
        case uploaded
        case failed
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(StateName.self, forKey: .state) {
        case .recording:
            self = .recording
        case .local:
            self = .local
        case .uploading:
            self = .uploading(taskIdentifier: try values.decode(Int.self, forKey: .taskIdentifier))
        case .uploaded:
            self = .uploaded
        case .failed:
            self = .failed(message: try values.decode(String.self, forKey: .message))
        }
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .recording:
            try values.encode(StateName.recording, forKey: .state)
        case .local:
            try values.encode(StateName.local, forKey: .state)
        case .uploading(let taskIdentifier):
            try values.encode(StateName.uploading, forKey: .state)
            try values.encode(taskIdentifier, forKey: .taskIdentifier)
        case .uploaded:
            try values.encode(StateName.uploaded, forKey: .state)
        case .failed(let message):
            try values.encode(StateName.failed, forKey: .state)
            try values.encode(message, forKey: .message)
        }
    }

    func canTransition(to next: CaptureItemState) -> Bool {
        switch (self, next) {
        case (.recording, .local), (.recording, .failed):
            true
        case (.local, .uploading), (.local, .failed):
            true
        case (.uploading, .local), (.uploading, .uploaded), (.uploading, .failed):
            true
        case (.failed, .local):
            true
        case (.uploaded, .uploaded):
            true
        default:
            false
        }
    }
}

enum CaptureUploadFailure: Equatable, Sendable {
    case retryable(message: String)
    case terminal(message: String)
}

enum CaptureUploadFailureResolution: Equatable, Sendable {
    case retry(afterSeconds: Int)
    case failed
    case ignoredStaleCompletion
}

struct CaptureItem: Codable, Equatable, Identifiable, Sendable {
    var id: UUID
    var filename: String
    var kind: CaptureKind
    var capturedAt: String
    var source: String
    var mimeType: String
    var originalName: String?
    var audioFormat: CaptureAudioFormat?
    var segmentID: String?
    var segmentStartedAt: String?
    var state: CaptureItemState
    var uploadGeneration: Int
}

struct CaptureManifest: Codable, Equatable, Sendable {
    static let currentVersion = 1

    var version: Int
    var boxID: UUID
    var sessionID: CaptureSessionID
    var targetSessionID: String?
    var startedAt: String
    var items: [CaptureItem]

    init(boxID: UUID, sessionID: CaptureSessionID, targetSessionID: String?, startedAt: String) {
        version = Self.currentVersion
        self.boxID = boxID
        self.sessionID = sessionID
        self.targetSessionID = targetSessionID
        self.startedAt = startedAt
        items = []
    }
}

enum CaptureFilename {
    static func photo(id: UUID, format: CapturePhotoFormat) -> String {
        "ios-photo-\(id.uuidString.lowercased()).\(format.fileExtension)"
    }

    static func audio(id: UUID) -> String {
        "ios-audio-\(id.uuidString.lowercased()).m4a"
    }

    static func file(id: UUID, originalName: String) -> String {
        let cleanName = sanitizedOriginalName(originalName)
        return "ios-file-\(id.uuidString.lowercased())-\(cleanName)"
    }

    static func validatePhoto(filename: String, mimeType: String) throws {
        let lowercased = filename.lowercased()
        let validJPEG = lowercased.hasSuffix(".jpg") && mimeType == CapturePhotoFormat.jpeg.mimeType
        let validPNG = lowercased.hasSuffix(".png") && mimeType == CapturePhotoFormat.png.mimeType
        let uuidStart = lowercased.index(lowercased.startIndex, offsetBy: "ios-photo-".count, limitedBy: lowercased.endIndex)
        let uuidEnd = lowercased.index(lowercased.endIndex, offsetBy: -4, limitedBy: lowercased.startIndex)
        let hasNativeUUID: Bool
        if let uuidStart, let uuidEnd, uuidStart <= uuidEnd, lowercased.hasPrefix("ios-photo-") {
            hasNativeUUID = UUID(uuidString: String(lowercased[uuidStart..<uuidEnd])) != nil
        } else {
            hasNativeUUID = false
        }
        guard (validJPEG || validPNG), lowercased.hasPrefix("ios-photo-"), hasNativeUUID else {
            throw CaptureFailure.unsupportedPhoto(
                "Photos must use an ios-photo-<uuid> JPEG or PNG filename matching their MIME type."
            )
        }
    }

    private static func sanitizedOriginalName(_ originalName: String) -> String {
        let leafName = (originalName as NSString).lastPathComponent
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-_"))
        let scalars = leafName.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "-" }
        let result = String(scalars).trimmingCharacters(in: CharacterSet(charactersIn: ".-"))
        return result.isEmpty ? "attachment" : String(result.prefix(96))
    }
}
