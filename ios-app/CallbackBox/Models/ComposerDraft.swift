import Foundation

struct NSRangeValue: Codable, Equatable, Sendable {
    var location: Int
    var length: Int

    static let zero = NSRangeValue(location: 0, length: 0)

    func clamped(to text: String) -> NSRange {
        let source = text as NSString
        let utf16Count = source.length
        let safeLocation = min(max(0, location), utf16Count)
        let safeLength = min(max(0, length), utf16Count - safeLocation)
        let range = NSRange(location: safeLocation, length: safeLength)
        guard safeLocation < utf16Count else {
            return range
        }
        if safeLength == 0 {
            let composed = source.rangeOfComposedCharacterSequence(at: safeLocation)
            guard safeLocation == composed.location else {
                return NSRange(location: utf16Count, length: 0)
            }
            return range
        }
        guard Range(range, in: text) != nil else {
            return NSRange(location: utf16Count, length: 0)
        }
        return range
    }
}

enum DraftTransferState: Codable, Equatable, Sendable {
    case local
    case uploading(progress: Double)
    case uploaded(path: String)
    case failed(message: String)
}

struct DraftImage: Codable, Equatable, Identifiable, Sendable {
    var id: Int
    var filename: String
    var mimeType: String
    var state: DraftTransferState
}

struct DraftFile: Codable, Equatable, Identifiable, Sendable {
    var id: Int
    var filename: String
    var originalName: String
    var size: Int
    var mimetype: String
    var state: DraftTransferState
}

struct DraftSelection: Codable, Equatable, Identifiable, Sendable {
    var id: Int
    var ref: String
    var text: String
    var position: String
    var anchor: String?
    var spokenWords: Int?
}

struct ComposerDraft: Codable, Equatable, Sendable {
    var text: String
    var selection: NSRangeValue
    var images: [DraftImage]
    var files: [DraftFile]
    var selections: [DraftSelection]
    var nextImageID: Int
    var nextFileID: Int
    var nextSelectionID: Int
    var processedCommandIDs: [String] = []

    static let empty = ComposerDraft(
        text: "",
        selection: .zero,
        images: [],
        files: [],
        selections: [],
        nextImageID: 1,
        nextFileID: 1,
        nextSelectionID: 1,
        processedCommandIDs: []
    )

    private enum CodingKeys: String, CodingKey {
        case text
        case selection
        case images
        case files
        case selections
        case nextImageID
        case nextFileID
        case nextSelectionID
        case processedCommandIDs
    }

    init(
        text: String,
        selection: NSRangeValue,
        images: [DraftImage],
        files: [DraftFile],
        selections: [DraftSelection],
        nextImageID: Int,
        nextFileID: Int,
        nextSelectionID: Int,
        processedCommandIDs: [String] = []
    ) {
        self.text = text
        self.selection = selection
        self.images = images
        self.files = files
        self.selections = selections
        self.nextImageID = nextImageID
        self.nextFileID = nextFileID
        self.nextSelectionID = nextSelectionID
        self.processedCommandIDs = processedCommandIDs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        text = try container.decode(String.self, forKey: .text)
        selection = try container.decode(NSRangeValue.self, forKey: .selection)
        images = try container.decode([DraftImage].self, forKey: .images)
        files = try container.decode([DraftFile].self, forKey: .files)
        selections = try container.decode([DraftSelection].self, forKey: .selections)
        nextImageID = try container.decode(Int.self, forKey: .nextImageID)
        nextFileID = try container.decode(Int.self, forKey: .nextFileID)
        nextSelectionID = try container.decode(Int.self, forKey: .nextSelectionID)
        processedCommandIDs = try container.decodeIfPresent([String].self, forKey: .processedCommandIDs) ?? []
    }
}

enum PendingEmissionState: Codable, Equatable, Sendable {
    case awaitingWebView
    case awaitingReceipt(attempt: Int, sentAt: Date)
    case rejected(reason: String)
}

struct PendingEmission: Codable, Equatable, Identifiable, Sendable {
    var id: UUID
    var boxID: UUID
    var draft: ComposerDraft
    var text: String
    var origin: NativeEmissionV2.Origin
    var diarized: Bool
    var state: PendingEmissionState
    var createdAt: Date
}

struct VoicePreparation: Codable, Equatable, Identifiable, Sendable {
    var id: UUID
    var boxID: UUID
    var draft: ComposerDraft
    var liveTranscript: String
    var priorInput: String
    var action: SpeechKeywordAction
    var matchedPhrase: String
    var audioFilename: String?
    var createdAt: Date
}

enum ComposerDraftMutation: Equatable, Sendable {
    case setText(String)
    case setSelection(NSRangeValue)
    case addImage(DraftImage)
    case addFile(DraftFile)
    case addSelection(DraftSelection)
    case updateFile(DraftFile)
    case updateImage(DraftImage)
    case applySelectionCommand(commandID: String, selection: DraftSelection)
    case removeImage(Int)
    case removeFile(Int)
    case removeSelection(Int)
    case reset
}

enum ComposerDraftReducer {
    static func reduce(_ draft: inout ComposerDraft, _ mutation: ComposerDraftMutation) {
        switch mutation {
        case .setText(let text):
            draft.text = text
            draft.selection = NSRangeValue(location: min(draft.selection.location, (text as NSString).length), length: 0)
        case .setSelection(let selection):
            let range = selection.clamped(to: draft.text)
            draft.selection = NSRangeValue(location: range.location, length: range.length)
        case .addImage(let image):
            draft.images.append(image)
            draft.nextImageID = max(draft.nextImageID, image.id + 1)
            insertToken("[image\(image.id)]", into: &draft)
        case .addFile(let file):
            draft.files.append(file)
            draft.nextFileID = max(draft.nextFileID, file.id + 1)
            insertToken("[file\(file.id)]", into: &draft)
        case .addSelection(let selection):
            draft.selections.append(selection)
            draft.nextSelectionID = max(draft.nextSelectionID, selection.id + 1)
            if selection.anchor == nil {
                insertToken("[selection\(selection.id)]", into: &draft)
            }
        case .updateFile(let file):
            guard let index = draft.files.firstIndex(where: { $0.id == file.id }) else {
                return
            }
            draft.files[index] = file
        case .updateImage(let image):
            guard let index = draft.images.firstIndex(where: { $0.id == image.id }) else {
                return
            }
            draft.images[index] = image
        case .applySelectionCommand(let commandID, let selection):
            guard draft.processedCommandIDs.contains(commandID) == false else {
                return
            }
            draft.processedCommandIDs.append(commandID)
            if draft.processedCommandIDs.count > 256 {
                draft.processedCommandIDs.removeFirst(draft.processedCommandIDs.count - 256)
            }
            draft.selections.append(selection)
            draft.nextSelectionID = max(draft.nextSelectionID, selection.id + 1)
            if selection.anchor == nil {
                insertToken("[selection\(selection.id)]", into: &draft)
            }
        case .removeImage(let id):
            draft.images.removeAll { $0.id == id }
            removeToken("[image\(id)]", from: &draft)
        case .removeFile(let id):
            draft.files.removeAll { $0.id == id }
            removeToken("[file\(id)]", from: &draft)
        case .removeSelection(let id):
            draft.selections.removeAll { $0.id == id }
            removeToken("[selection\(id)]", from: &draft)
        case .reset:
            let processedCommandIDs = draft.processedCommandIDs
            draft = .empty
            draft.processedCommandIDs = processedCommandIDs
        }
    }

    private static func insertToken(_ token: String, into draft: inout ComposerDraft) {
        let source = draft.text as NSString
        let range = draft.selection.clamped(to: draft.text)
        let prefix = range.location > 0 && isWhitespace(source.substring(with: NSRange(location: range.location - 1, length: 1))) == false ? " " : ""
        let after = range.location + range.length
        let suffix = after < source.length && isWhitespace(source.substring(with: NSRange(location: after, length: 1))) == false ? " " : ""
        let insertion = prefix + token + suffix
        draft.text = source.replacingCharacters(in: range, with: insertion)
        draft.selection = NSRangeValue(location: range.location + (insertion as NSString).length, length: 0)
    }

    private static func isWhitespace(_ value: String) -> Bool {
        value.rangeOfCharacter(from: .whitespacesAndNewlines) != nil
    }

    private static func removeToken(_ token: String, from draft: inout ComposerDraft) {
        draft.text = draft.text.replacingOccurrences(of: token, with: "")
        draft.text = draft.text.replacingOccurrences(of: "  ", with: " ")
        let end = (draft.text as NSString).length
        draft.selection = NSRangeValue(location: min(draft.selection.location, end), length: 0)
    }
}
