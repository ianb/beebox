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
    var hqText: Bool?
    var hqService: String?
    var images: [ChatImageAttachment]
    var files: [NativeEmissionFile]
    var selections: [NativeEmissionSelection]

    init(emission: NativeChatEmission) {
        id = emission.id.uuidString
        origin = emission.origin
        text = emission.text
        diarized = emission.diarized
        hqText = emission.hqText
        hqService = emission.hqService
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
        hqText = try container.decodeIfPresent(Bool.self, forKey: .hqText)
        hqService = try container.decodeIfPresent(String.self, forKey: .hqService)
        images = try container.decode([ChatImageAttachment].self, forKey: .images)
        files = try container.decode([NativeEmissionFile].self, forKey: .files)
        selections = try container.decode([NativeEmissionSelection].self, forKey: .selections)
    }
}

/// A command the web posts on `beeboxComposerCommand`.
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
/// Contract: `beebox/docs/mobile-contract.md` §4.7 (V1) and §4.8 (V2).
struct NativeComposerCommand: Codable, Equatable, Identifiable {
    /// Every command kind, in the wire spelling. Adding a case here forces the
    /// `Payload` decode switch below — and every consumer's switch — to handle
    /// it, which is where `point-at-control` lands.
    enum Kind: String, Codable {
        case addSelection = "add-selection"
        case scanControls = "scan-controls"
        case pointAtControl = "point-at-control"
    }

    /// Which native control to act on, and how.
    ///
    /// The `id` here is the control's shared `bbx-` address, not the command id —
    /// the envelope carries that separately. `action` is a closed enum decoded
    /// strictly: the web degrades an unrecognised `action=` in a `control:` href
    /// to `point` before it ever builds a command, so a fourth value arriving
    /// here means a bundle skew, and acting on the interface on a guess is
    /// exactly what this feature must not do.
    struct PointTarget: Codable, Equatable {
        var id: String
        var action: NativeControlEntry.Action
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
        case pointAtControl(PointTarget)
    }

    enum DecodeError: Error, Equatable {
        case unsupportedVersion(Int)
        case emptyID
        /// A V1 envelope carrying a kind V1 cannot express.
        case unsupportedKindForVersion(Kind, Int)
        /// A `point-at-control` naming no control.
        case emptyControlID
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
        case .pointAtControl:
            .pointAtControl
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
        case .pointAtControl:
            let target = try container.decode(PointTarget.self, forKey: .payload)
            guard !target.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw DecodeError.emptyControlID
            }
            payload = .pointAtControl(target)
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
        case .pointAtControl(let target):
            try container.encode(target, forKey: .payload)
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
/// The `id` is the shared `bbx-` address from Track 4's table: the same string
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

    /// What a `control:` pointer may ask this shell to do with a control. The
    /// same three names the web uses, so one vocabulary spans both surfaces.
    enum Action: String, Codable, Sendable, CaseIterable {
        case point
        case focus
        case reveal
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
    /// What this control can actually be asked to do here.
    ///
    /// Derived from the anchor's handlers rather than declared, so the list
    /// cannot claim a `focus` the view has no way to perform: `.controlAnchor`
    /// adds `focus`/`reveal` exactly when it was given something to run for
    /// them. Every registered control can be pointed at, because the registry
    /// holds a frame for each.
    var actions: [Action] = [.point]

    init(
        id: String,
        role: Role,
        label: String,
        does: String? = nil,
        container: String,
        disabled: Bool,
        actions: [Action] = [.point]
    ) {
        self.id = id
        self.role = role
        self.label = label
        self.does = does
        self.container = container
        self.disabled = disabled
        self.actions = actions
    }

    /// `actions` is decoded leniently — absent means **none**, not "point".
    ///
    /// Nothing decodes an entry in production (native is the producer of this
    /// shape), so this exists to keep the golden fixtures decodable on both
    /// sides, including the one recording what a build older than
    /// `point-at-control` puts on the wire. Absent must not become `[.point]`
    /// there: such a build can list a control and cannot act on one, and the
    /// dump has to print it without a link rather than promise a pointer that
    /// would break on click.
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        role = try values.decode(Role.self, forKey: .role)
        label = try values.decode(String.self, forKey: .label)
        does = try values.decodeIfPresent(String.self, forKey: .does)
        container = try values.decode(String.self, forKey: .container)
        disabled = try values.decode(Bool.self, forKey: .disabled)
        actions = try values.decodeIfPresent([Action].self, forKey: .actions) ?? []
    }
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
        // Only `scan-controls` has an answer to carry; a successful
        // `point-at-control` is the fact that it happened and nothing more.
        if ok, kind == .scanControls, controls == nil {
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

    /// The answer to `point-at-control`: the ring is drawn, and there is nothing
    /// to return but that.
    static func pointed(id: String) -> NativeComposerCommandResult {
        NativeComposerCommandResult(id: id, kind: .pointAtControl, ok: true, controls: nil, reason: nil)
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

/// The native composer's barge-in, sent to the page when the user presses
/// record while the box is speaking (contract §4.9). The page owns the speech;
/// only it can stop it. There is no acknowledgement channel — the speech
/// playback state the page already posts (§4.5) reports the stop, and native
/// does not wait for it before opening the microphone.
struct NativeSpeechCommand: Codable, Equatable {
    enum Action: String, Codable {
        case stop
    }

    var version = 1
    var action: Action

    static let stop = NativeSpeechCommand(action: .stop)
}

/// Routing metadata is independent of the card visible in the webview.
struct NativeConversationTarget: Codable, Equatable, Sendable {
    enum Kind: String, Codable, Sendable { case session, start }
    enum Engine: String, Codable, Sendable { case claude, codex }
    var kind: Kind
    var sessionId: String?
    var clientConversationId: String?
    var contextDir: String
    var engine: Engine?
    var model: String?
    var seedFeatures: [String: String]?

    var logicalID: String { sessionId ?? clientConversationId ?? "" }
    var isValid: Bool {
        switch kind {
        case .session: return sessionId?.isEmpty == false && sessionId != "new"
        case .start: return clientConversationId?.isEmpty == false && engine != nil
        }
    }
}

struct NativeAttentionSnapshot: Codable, Equatable, Sendable {
    enum Surface: String, Codable, Sendable { case card, browse, dashboard, landmarks, chat, other }
    enum Transcript: String, Codable, Sendable { case visible, hidden }
    var surface: Surface
    var focusedRef: String?
    var transcript: Transcript
}

struct NativeSendBinding: Codable, Equatable, Sendable {
    var boxSlug: String
    var target: NativeConversationTarget
    var attention: NativeAttentionSnapshot
}

struct NativeConversationSelection: Codable, Equatable, Sendable {
    enum Kind: String, Codable, Sendable { case ready, resolving, unavailable }
    var kind: Kind
    var target: NativeConversationTarget?
    var label: String?
    var requestId: String?
    var contextDir: String?
    var reason: String?
}

struct NativeComposerBinding: Codable, Equatable, Sendable {
    enum Kind: String, Codable, Sendable { case selection, assigned }
    var version: Int
    var kind: Kind
    var boxSlug: String
    var revision: Int?
    var selection: NativeConversationSelection?
    var attention: NativeAttentionSnapshot?
    var clientConversationId: String?
    var sessionId: String?
    var contextDir: String?

    var isValid: Bool {
        guard version == 1, !boxSlug.isEmpty else { return false }
        switch kind {
        case .assigned:
            return clientConversationId?.isEmpty == false && sessionId?.isEmpty == false
                && sessionId != "new" && contextDir != nil
        case .selection:
            guard let revision, revision >= 0, let selection, let attention else { return false }
            if let ref = attention.focusedRef {
                guard !ref.contains(":"), !ref.hasPrefix("//"),
                      !ref.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                      attention.surface != .other else { return false }
            }
            switch selection.kind {
            case .ready: return selection.target?.isValid == true && selection.label?.isEmpty == false
            case .resolving: return selection.requestId?.isEmpty == false && selection.contextDir != nil
            case .unavailable: return selection.reason?.isEmpty == false && selection.contextDir != nil
            }
        }
    }

    var sendBinding: NativeSendBinding? {
        guard kind == .selection, isValid, selection?.kind == .ready,
              let target = selection?.target, let attention else { return nil }
        return NativeSendBinding(boxSlug: boxSlug, target: target, attention: attention)
    }
}

struct NativeEmissionV3: Encodable {
    var emission: NativeChatEmission
    func encode(to encoder: Encoder) throws {
        try NativeEmissionV2(emission: emission).encode(to: encoder)
        var values = encoder.container(keyedBy: Keys.self)
        try values.encode(3, forKey: .version)
        try values.encode(emission.binding, forKey: .binding)
        try values.encode(emission.bindingRevision, forKey: .bindingRevision)
    }
    private enum Keys: String, CodingKey { case version, binding, bindingRevision }
}

struct NativeConversationStartup: Codable, Equatable, Sendable {
    enum State: String, Codable, Sendable { case prepared, attempted, accepted, assigned }
    var clientConversationId: String
    var firstEmissionId: UUID
    var target: NativeConversationTarget
    var state: State
    var sessionId: String?
}
