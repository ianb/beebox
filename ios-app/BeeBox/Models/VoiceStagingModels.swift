import Foundation

/// Client-generated recording id for a voice-staging session
/// (`docs/plans/resilient-voice-recording.md`, Track 6). UUID v4, lowercase —
/// matches the server's `VoiceSessionIdSchema`
/// (`beebox/src/webapp/routes/capture-create.ts`) and doubles as both the
/// capture session id and the recording's one audio segment id
/// (`X-Capture-Segment-Id`).
struct VoiceRecordingID: Codable, Equatable, Hashable, RawRepresentable, Sendable {
    var rawValue: String

    init(rawValue: String) {
        self.rawValue = rawValue
    }

    init() {
        rawValue = UUID().uuidString.lowercased()
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

enum VoiceStagingChunkState: Equatable, Sendable {
    case local
    case uploading(taskIdentifier: Int)
    case uploaded
    case failed(message: String)
}

extension VoiceStagingChunkState: Codable {
    private enum CodingKeys: String, CodingKey {
        case state
        case taskIdentifier
        case message
    }

    private enum StateName: String, Codable {
        case local, uploading, uploaded, failed
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(StateName.self, forKey: .state) {
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
}

struct VoiceStagingChunk: Codable, Equatable, Sendable {
    var index: Int
    var filename: String
    var byteCount: Int
    var state: VoiceStagingChunkState
    var uploadGeneration: Int
}

/// Server-lifecycle state of the session-create call itself, independent of
/// chunk upload progress: a chunk file can be produced and even queued while
/// this is still `.pending` — the coordinator only starts uploading once it
/// becomes `.created`.
enum VoiceStagingSessionCreation: Equatable, Sendable {
    case pending
    case created
    case failed(message: String)
}

extension VoiceStagingSessionCreation: Codable {
    private enum CodingKeys: String, CodingKey {
        case state
        case message
    }

    private enum StateName: String, Codable {
        case pending, created, failed
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(StateName.self, forKey: .state) {
        case .pending:
            self = .pending
        case .created:
            self = .created
        case .failed:
            self = .failed(message: try values.decode(String.self, forKey: .message))
        }
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .pending:
            try values.encode(StateName.pending, forKey: .state)
        case .created:
            try values.encode(StateName.created, forKey: .state)
        case .failed(let message):
            try values.encode(StateName.failed, forKey: .state)
            try values.encode(message, forKey: .message)
        }
    }
}

/// The HQ handoff a finalize call requests, mirroring
/// `capture-finalize-voice.ts`'s `hq` body field. `nil` (absent from the wire
/// body) means "seal without requesting HQ" — the only shape Track 6a ever
/// sends; Track 6b supplies a real payload once the web emission shape lands.
struct VoiceHqFinalizePayload: Codable, Equatable, Sendable {
    var emissionID: String
    var sessionID: String
}

enum VoiceStagingFinalizeState: Equatable, Sendable {
    case notRequested
    case pending(chunkCount: Int, hq: VoiceHqFinalizePayload?)
    case sealed
    case terminal(message: String)
}

extension VoiceStagingFinalizeState: Codable {
    private enum CodingKeys: String, CodingKey {
        case state
        case chunkCount
        case hq
        case message
    }

    private enum StateName: String, Codable {
        case notRequested, pending, sealed, terminal
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(StateName.self, forKey: .state) {
        case .notRequested:
            self = .notRequested
        case .pending:
            self = .pending(
                chunkCount: try values.decode(Int.self, forKey: .chunkCount),
                hq: try values.decodeIfPresent(VoiceHqFinalizePayload.self, forKey: .hq)
            )
        case .sealed:
            self = .sealed
        case .terminal:
            self = .terminal(message: try values.decode(String.self, forKey: .message))
        }
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .notRequested:
            try values.encode(StateName.notRequested, forKey: .state)
        case .pending(let chunkCount, let hq):
            try values.encode(StateName.pending, forKey: .state)
            try values.encode(chunkCount, forKey: .chunkCount)
            try values.encodeIfPresent(hq, forKey: .hq)
        case .sealed:
            try values.encode(StateName.sealed, forKey: .state)
        case .terminal(let message):
            try values.encode(StateName.terminal, forKey: .state)
            try values.encode(message, forKey: .message)
        }
    }
}

struct VoiceStagingManifest: Codable, Equatable, Sendable {
    static let currentVersion = 1

    var version: Int
    var boxID: UUID
    var recordingID: VoiceRecordingID
    var targetSessionID: String
    var createdAt: String
    var sessionCreation: VoiceStagingSessionCreation
    var chunks: [VoiceStagingChunk]
    var finalize: VoiceStagingFinalizeState

    init(boxID: UUID, recordingID: VoiceRecordingID, targetSessionID: String, createdAt: String) {
        version = Self.currentVersion
        self.boxID = boxID
        self.recordingID = recordingID
        self.targetSessionID = targetSessionID
        self.createdAt = createdAt
        sessionCreation = .pending
        chunks = []
        finalize = .notRequested
    }
}

enum VoiceStagingFailure: Error, Equatable, Sendable {
    case invalidManifest(String)
    case payloadMissing(String)
}

enum VoiceStagingUploadFailure: Equatable, Sendable {
    case retryable(message: String)
    case terminal(message: String)
}

enum VoiceStagingUploadResolution: Equatable, Sendable {
    case retry(afterSeconds: Int)
    case failed
    case ignoredStaleCompletion
}

/// What a `finalize(recordingID:hq:)` call settles to, surfaced to the
/// composer. `.terminal` covers both a 4xx rejection (including the
/// `missing-chunks` gap check) and a retry budget that ran out — the message
/// is what the composer shows; the distinction between "gap" and "expired"
/// doesn't change what the user can do about it (re-record).
enum VoiceStagingFinalizeOutcome: Equatable, Sendable {
    case sealed
    case terminal(message: String)
}

/// Shared timing constants for the "back off, then go terminal" retry policy
/// (`docs/plans/resilient-voice-recording.md`, Track 6 — "Failure modes").
/// Full-jitter exponential capped at `maxBackoffSeconds`, bounded by
/// `retryBound` measured from the recording's own creation time.
enum VoiceStagingRetryPolicy {
    static let retryBound: TimeInterval = 7 * 24 * 60 * 60
    static let maxBackoffSeconds = 30

    static func backoffSeconds(attempt: Int) -> Int {
        let cap = min(maxBackoffSeconds, 1 << min(max(attempt, 0), 5))
        return Int.random(in: 0...max(1, cap))
    }

    static func isWithinRetryBound(createdAt: String, now: Date) -> Bool {
        guard let created = ISO8601DateFormatter().date(from: createdAt) else {
            return true
        }
        return now.timeIntervalSince(created) < retryBound
    }
}
