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

/// A command the web posts on `callbackboxComposerCommand`.
///
/// Two envelope versions, both decoded here:
///
/// - **V1** — `{version:1, id, kind:"add-selection", selection}`. The selection
///   sits at the top level and is required. It is still what installed web
///   bundles send for a selection, and this app must keep reading it.
/// - **V2** — `{version:2, id, kind, payload?}`. `kind` discriminates the
///   payload, so a command that carries no payload is expressible at all —
///   which V1 is not, because it decodes `selection` unconditionally. The
///   answer to a V2 command rides ``NativeComposerCommandResult`` rather than
///   the acknowledgement, which has no room for one.
///
/// The `id` is required and non-empty in both, and that is load-bearing: an
/// *older* build that cannot decode a V2 envelope still reads the `id` off the
/// raw payload and answers with a rejection acknowledgement (see
/// `ChatWebView.receiveComposerCommand`), so a version skew is visible to the
/// web rather than silent.
///
/// Contract: `callback-box/docs/mobile-contract.md` §4.7 (V1) and §4.8 (V2).
struct NativeComposerCommand: Codable, Equatable, Identifiable {
    /// Every command kind, in the wire spelling. Adding a case here forces the
    /// `Payload` decode switch below — and every consumer's switch — to handle
    /// it, which is where `point-at-control` lands.
    enum Kind: String, Codable {
        case addSelection = "add-selection"
        case scanControls = "scan-controls"
    }

    struct Selection: Codable, Equatable {
        var ref: String
        var text: String
        var position: String
    }

    /// The command's kind and its payload as one value, so a kind can never be
    /// paired with the wrong payload or with none.
    enum Payload: Equatable {
        case addSelection(Selection)
        case scanControls
    }

    enum DecodeError: Error, Equatable {
        case unsupportedVersion(Int)
        case emptyID
        /// A V1 envelope carrying a kind V1 cannot express.
        case unsupportedKindForVersion(Kind, Int)
    }

    var version: Int
    var id: String
    var payload: Payload

    var kind: Kind {
        switch payload {
        case .addSelection:
            .addSelection
        case .scanControls:
            .scanControls
        }
    }

    /// V1 selection command — the shape the web still sends for a selection.
    init(id: String, selection: Selection) {
        version = 1
        self.id = id
        payload = .addSelection(selection)
    }

    init(id: String, version: Int, payload: Payload) {
        self.id = id
        self.version = version
        self.payload = payload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        guard version == 1 || version == 2 else {
            throw DecodeError.unsupportedVersion(version)
        }
        id = try container.decode(String.self, forKey: .id)
        guard !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodeError.emptyID
        }
        let kind = try container.decode(Kind.self, forKey: .kind)
        if version == 1 {
            guard kind == .addSelection else {
                throw DecodeError.unsupportedKindForVersion(kind, version)
            }
            payload = .addSelection(try container.decode(Selection.self, forKey: .selection))
            return
        }
        switch kind {
        case .addSelection:
            payload = .addSelection(try container.decode(Selection.self, forKey: .payload))
        case .scanControls:
            payload = .scanControls
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        switch payload {
        case .addSelection(let selection):
            try container.encode(selection, forKey: version == 1 ? .selection : .payload)
        case .scanControls:
            break
        }
    }

    private enum CodingKeys: String, CodingKey {
        case version
        case id
        case kind
        case selection
        case payload
    }
}

/// One native control the registry reported, as it crosses to the web.
///
/// The `id` is the shared `cb-` address from Track 4's table: the same string
/// names the same control on the web and here, and it is also this view's
/// `accessibilityIdentifier` (both set by one `.controlAnchor` call, so they
/// cannot drift). `label` and `does` are read live, so a control whose meaning
/// changes with its state reports what it means *now* — the mic is "Start
/// dictation" or the stop button is "Stop continuous dictation" depending on
/// which one the composer is currently rendering.
struct NativeControlEntry: Codable, Equatable, Identifiable, Sendable {
    /// The ARIA role vocabulary, so native and DOM entries read alike in the dump.
    enum Role: String, Codable, Sendable {
        case button
        case textbox
    }

    var id: String
    var role: Role
    var label: String
    /// Author-written "what it does". Encoded only when present — the web treats
    /// an absent key and an explicit null identically.
    var does: String?
    /// The native surface this control belongs to; the dump groups by it.
    var container: String
    var disabled: Bool
}

/// What a V2 command produced, posted to the web on its own channel.
///
/// Separate from ``NativeComposerCommandAcknowledgement`` on purpose: the
/// acknowledgement says whether native *took* the command, and this says what
/// the command *answered*. Keeping them apart is what makes a refusal carrying
/// a reason and a successful **empty** inventory two different things rather
/// than one ambiguous one.
struct NativeComposerCommandResult: Codable, Equatable, Identifiable {
    enum DecodeError: Error, Equatable {
        case unsupportedVersion(Int)
        case emptyID
        case missingControls
        case missingRefusalReason
    }

    var version = 2
    var id: String
    var kind: NativeComposerCommand.Kind
    var ok: Bool
    var controls: [NativeControlEntry]?
    var reason: String?

    private init(id: String, kind: NativeComposerCommand.Kind, ok: Bool, controls: [NativeControlEntry]?, reason: String?) {
        self.id = id
        self.kind = kind
        self.ok = ok
        self.controls = controls
        self.reason = reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        guard version == 2 else {
            throw DecodeError.unsupportedVersion(version)
        }
        id = try container.decode(String.self, forKey: .id)
        guard !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodeError.emptyID
        }
        kind = try container.decode(NativeComposerCommand.Kind.self, forKey: .kind)
        ok = try container.decode(Bool.self, forKey: .ok)
        controls = try container.decodeIfPresent([NativeControlEntry].self, forKey: .controls)
        reason = try container.decodeIfPresent(String.self, forKey: .reason)
        if ok, controls == nil {
            throw DecodeError.missingControls
        }
        if !ok, reason?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            throw DecodeError.missingRefusalReason
        }
    }

    /// The answer to `scan-controls`. An empty array is a real answer.
    static func controls(id: String, _ controls: [NativeControlEntry]) -> NativeComposerCommandResult {
        NativeComposerCommandResult(id: id, kind: .scanControls, ok: true, controls: controls, reason: nil)
    }

    static func refused(
        id: String,
        kind: NativeComposerCommand.Kind,
        reason: String
    ) -> NativeComposerCommandResult {
        NativeComposerCommandResult(id: id, kind: kind, ok: false, controls: nil, reason: reason)
    }

    private enum CodingKeys: String, CodingKey {
        case version
        case id
        case kind
        case ok
        case controls
        case reason
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
