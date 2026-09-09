import Combine
import Foundation

@MainActor
final class ComposerDraftStore: ObservableObject {
    enum DraftError: Error {
        case incompleteFile
        case incompleteImage
    }

    struct DiscardedDraft {
        fileprivate var snapshot: ComposerDraft
        fileprivate var boxID: UUID
    }
    @Published private(set) var draft = ComposerDraft.empty
    @Published private(set) var isReady = false
    @Published private(set) var restoreNotice: String?

    private let repository: ComposerDraftRepository
    private let defaults: UserDefaults
    private var activeBoxID: UUID?
    private var activatingBoxID: UUID?
    private var activationGeneration = UUID()
    private var activationWaiters: [UUID: [CheckedContinuation<Void, Never>]] = [:]
    private var saveTask: Task<Void, Never>?
    private var voiceSelectionContext: VoiceSelectionContext?

    init(
        repository: ComposerDraftRepository = ComposerDraftRepository(),
        defaults: UserDefaults = .standard
    ) {
        self.repository = repository
        self.defaults = defaults
    }

    func activate(boxID: UUID) async {
        if boxID == activeBoxID {
            await waitForActivation(boxID: boxID)
            return
        }
        let generation = UUID()
        activationGeneration = generation
        saveTask?.cancel()
        let previousBoxID = activeBoxID
        let previousDraft = draft
        let previousWasReady = isReady
        isReady = false
        if let previousBoxID, previousWasReady {
            try? await repository.save(previousDraft, boxID: previousBoxID)
        }
        guard activationGeneration == generation else {
            return
        }
        if let activatingBoxID {
            activationWaiters.removeValue(forKey: activatingBoxID)?.forEach { $0.resume() }
        }
        activeBoxID = boxID
        activatingBoxID = boxID
        isReady = false
        draft = .empty
        defer {
            if activationGeneration == generation, activatingBoxID == boxID {
                activatingBoxID = nil
                activationWaiters.removeValue(forKey: boxID)?.forEach { $0.resume() }
            }
        }
        restoreNotice = nil
        do {
            if var restored = try await repository.load(boxID: boxID) {
                let missingImageIDs = await repository.missingImageIDs(restored.images, boxID: boxID)
                let missingFileIDs = await repository.missingFileIDs(restored.files, boxID: boxID)
                guard activationIsCurrent(boxID: boxID, generation: generation) else {
                    return
                }
                for id in missingImageIDs {
                    ComposerDraftReducer.reduce(&restored, .removeImage(id))
                }
                for id in missingFileIDs {
                    ComposerDraftReducer.reduce(&restored, .removeFile(id))
                }
                var interruptedUpload = false
                for var image in restored.images {
                    guard case .uploading = image.state else {
                        continue
                    }
                    interruptedUpload = true
                    image.state = .failed(message: "Image processing was interrupted. Retry to continue.")
                    ComposerDraftReducer.reduce(&restored, .updateImage(image))
                }
                for var file in restored.files {
                    guard case .uploading = file.state else {
                        continue
                    }
                    interruptedUpload = true
                    file.state = .failed(message: "Upload was interrupted. Retry when connected.")
                    ComposerDraftReducer.reduce(&restored, .updateFile(file))
                }
                draft = restored
                isReady = true
                if missingImageIDs.isEmpty == false || missingFileIDs.isEmpty == false {
                    restoreNotice = "Some draft attachments were missing and were removed."
                    await flush()
                } else if interruptedUpload {
                    restoreNotice = "An interrupted attachment is ready to retry."
                    await flush()
                }
                return
            }
        } catch {
            guard activationIsCurrent(boxID: boxID, generation: generation) else {
                return
            }
            restoreNotice = "Draft could not be restored."
        }
        guard activationIsCurrent(boxID: boxID, generation: generation) else {
            return
        }
        let key = legacyDraftKey(boxID: boxID)
        if let legacyText = defaults.string(forKey: key) {
            draft = .empty
            ComposerDraftReducer.reduce(&draft, .setText(legacyText))
            defaults.removeObject(forKey: key)
            isReady = true
            await flush()
        } else {
            draft = .empty
            isReady = true
        }
    }

    func setText(_ text: String) {
        ComposerDraftReducer.reduce(&draft, .setText(text))
        scheduleSave()
    }

    func setDictationTranscript(_ text: String) {
        ComposerDraftReducer.reduce(&draft, .setDictationTranscript(text))
        scheduleSave()
    }

    func setSelection(_ selection: NSRangeValue) {
        ComposerDraftReducer.reduce(&draft, .setSelection(selection))
        scheduleSave()
    }

    func setVoiceSelectionContext(transcript: String, active: Bool) {
        let words = transcript.split(whereSeparator: { $0.isWhitespace })
        guard active, words.isEmpty == false else {
            voiceSelectionContext = nil
            return
        }
        voiceSelectionContext = VoiceSelectionContext(
            anchor: words.suffix(8).joined(separator: " "),
            spokenWords: words.count
        )
    }

    func applySelectionCommand(
        _ command: NativeComposerCommand,
        boxID: UUID
    ) async -> NativeComposerCommandAcknowledgement {
        if activeBoxID == nil, activatingBoxID == nil {
            await activate(boxID: boxID)
        }
        await waitForActivation(boxID: boxID)
        guard activeBoxID == boxID, isReady else {
            return .rejected(id: command.id, reason: "The selected box changed before the selection was saved.")
        }
        guard case .addSelection(let source) = command.payload else {
            // Unreachable through `RootView`, which routes by payload; explicit
            // so a future kind cannot silently land in the selection path.
            return .rejected(id: command.id, reason: "That command does not carry a selection.")
        }
        guard
            source.ref.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
            source.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
            source.position.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        else {
            return .rejected(id: command.id, reason: "The selection is missing its source, text, or position.")
        }
        if draft.processedCommandIDs.contains(command.id) {
            return .accepted(id: command.id)
        }
        let previous = draft
        let selection = DraftSelection(
            id: draft.nextSelectionID,
            ref: source.ref,
            text: source.text,
            position: source.position,
            anchor: voiceSelectionContext?.anchor,
            spokenWords: voiceSelectionContext?.spokenWords
        )
        ComposerDraftReducer.reduce(
            &draft,
            .applySelectionCommand(commandID: command.id, selection: selection)
        )
        saveTask?.cancel()
        do {
            try await repository.save(draft, boxID: boxID)
            return .accepted(id: command.id)
        } catch {
            draft = previous
            return .rejected(id: command.id, reason: "The selection could not be saved.")
        }
    }

    func removeSelection(id: Int) async {
        ComposerDraftReducer.reduce(&draft, .removeSelection(id))
        await flush()
    }

    func emissionSelections(from snapshot: ComposerDraft) -> [NativeEmissionSelection] {
        snapshot.selections.map { selection in
            NativeEmissionSelection(
                id: selection.id,
                ref: selection.ref,
                text: selection.text,
                position: selection.position,
                anchor: selection.anchor,
                spokenWords: selection.spokenWords
            )
        }
    }

    func addImage(data: Data, mimeType: String, fileExtension: String) async {
        guard let activeBoxID else {
            return
        }
        let safeExtension = fileExtension.lowercased().filter { $0.isLetter || $0.isNumber }
        let filename = "image-\(UUID().uuidString.lowercased()).\(safeExtension.isEmpty ? "jpg" : safeExtension)"
        do {
            try await repository.savePayload(data, filename: filename, boxID: activeBoxID)
            guard self.activeBoxID == activeBoxID else {
                try? await repository.removePayload(filename: filename, boxID: activeBoxID)
                return
            }
            let image = DraftImage(
                id: draft.nextImageID,
                filename: filename,
                mimeType: mimeType,
                state: .local
            )
            ComposerDraftReducer.reduce(&draft, .addImage(image))
            await flush()
        } catch {
            restoreNotice = "Image could not be saved."
        }
    }

    func beginImageImport(data: Data, mimeType: String) async -> DraftImage? {
        guard let activeBoxID else {
            return nil
        }
        let fileExtension: String
        switch mimeType.lowercased() {
        case "image/png":
            fileExtension = "png"
        case "image/jpeg":
            fileExtension = "jpg"
        case "image/heic", "image/heif":
            fileExtension = "heic"
        default:
            fileExtension = "image"
        }
        let filename = "image-source-\(UUID().uuidString.lowercased()).\(fileExtension)"
        do {
            try await repository.savePayload(data, filename: filename, boxID: activeBoxID)
            guard self.activeBoxID == activeBoxID else {
                try? await repository.removePayload(filename: filename, boxID: activeBoxID)
                return nil
            }
            let image = DraftImage(
                id: draft.nextImageID,
                filename: filename,
                mimeType: mimeType,
                state: .uploading(progress: 0)
            )
            ComposerDraftReducer.reduce(&draft, .addImage(image))
            await flush()
            return image
        } catch {
            restoreNotice = "Image could not be saved."
            return nil
        }
    }

    func completeImageImport(
        id: Int,
        data: Data,
        mimeType: String,
        fileExtension: String,
        boxID: UUID
    ) async {
        guard activeBoxID == boxID,
              var image = draft.images.first(where: { $0.id == id }) else {
            return
        }
        let sourceFilename = image.filename
        let filename = "image-\(UUID().uuidString.lowercased()).\(fileExtension)"
        do {
            try await repository.savePayload(data, filename: filename, boxID: boxID)
            guard activeBoxID == boxID,
                  draft.images.contains(where: { $0.id == id }) else {
                try? await repository.removePayload(filename: filename, boxID: boxID)
                return
            }
            image.filename = filename
            image.mimeType = mimeType
            image.state = .local
            ComposerDraftReducer.reduce(&draft, .updateImage(image))
            await flush()
            try? await repository.removePayload(filename: sourceFilename, boxID: boxID)
        } catch {
            await failImageImport(id: id, message: "The processed image could not be saved.", boxID: boxID)
        }
    }

    func failImageImport(id: Int, message: String, boxID: UUID) async {
        await setImageState(id: id, state: .failed(message: message), boxID: boxID)
    }

    func setImageState(id: Int, state: DraftTransferState, boxID: UUID) async {
        guard activeBoxID == boxID,
              var image = draft.images.first(where: { $0.id == id }) else {
            return
        }
        image.state = state
        ComposerDraftReducer.reduce(&draft, .updateImage(image))
        await flush()
    }

    func removeImage(id: Int) async {
        guard let activeBoxID, let image = draft.images.first(where: { $0.id == id }) else {
            return
        }
        ComposerDraftReducer.reduce(&draft, .removeImage(id))
        await flush()
        do {
            try await repository.removePayload(filename: image.filename, boxID: activeBoxID)
        } catch {
            restoreNotice = "Removed image data could not be cleaned up."
        }
    }

    func addFile(
        from sourceURL: URL,
        originalName: String,
        mimeType: String,
        size: Int
    ) async -> DraftFile? {
        guard let activeBoxID else {
            return nil
        }
        let sourceExtension = sourceURL.pathExtension.lowercased().filter { $0.isLetter || $0.isNumber }
        let suffix = sourceExtension.isEmpty ? "" : ".\(sourceExtension)"
        let filename = "file-\(UUID().uuidString.lowercased())\(suffix)"
        do {
            try await repository.importPayload(from: sourceURL, filename: filename, boxID: activeBoxID)
            guard self.activeBoxID == activeBoxID else {
                try? await repository.removePayload(filename: filename, boxID: activeBoxID)
                return nil
            }
            let file = DraftFile(
                id: draft.nextFileID,
                filename: filename,
                originalName: originalName,
                size: size,
                mimetype: mimeType,
                state: .local
            )
            ComposerDraftReducer.reduce(&draft, .addFile(file))
            await flush()
            return file
        } catch {
            restoreNotice = "File could not be saved."
            return nil
        }
    }

    func fileData(for file: DraftFile, boxID: UUID) async -> Data? {
        try? await repository.loadPayload(filename: file.filename, boxID: boxID)
    }

    func setFileState(id: Int, state: DraftTransferState, boxID: UUID) async {
        if activeBoxID == boxID {
            guard var file = draft.files.first(where: { $0.id == id }) else {
                return
            }
            file.state = state
            ComposerDraftReducer.reduce(&draft, .updateFile(file))
            await flush()
            return
        }
        guard var stored = try? await repository.load(boxID: boxID),
              var file = stored.files.first(where: { $0.id == id }) else {
            return
        }
        file.state = state
        ComposerDraftReducer.reduce(&stored, .updateFile(file))
        try? await repository.save(stored, boxID: boxID)
    }

    func setFileProgress(id: Int, progress: Double, boxID: UUID) async {
        let boundedProgress = min(1, max(0, progress))
        if activeBoxID == boxID {
            guard var file = draft.files.first(where: { $0.id == id }),
                  case .uploading = file.state else {
                return
            }
            file.state = .uploading(progress: boundedProgress)
            ComposerDraftReducer.reduce(&draft, .updateFile(file))
            scheduleSave()
            return
        }
        guard var stored = try? await repository.load(boxID: boxID),
              var file = stored.files.first(where: { $0.id == id }),
              case .uploading = file.state else {
            return
        }
        file.state = .uploading(progress: boundedProgress)
        ComposerDraftReducer.reduce(&stored, .updateFile(file))
        try? await repository.save(stored, boxID: boxID)
    }

    func markFileUploaded(id: Int, upload: UploadedChatFile, boxID: UUID) async {
        if activeBoxID == boxID {
            guard var file = draft.files.first(where: { $0.id == id }) else {
                return
            }
            apply(upload, to: &file)
            ComposerDraftReducer.reduce(&draft, .updateFile(file))
            await flush()
            return
        }
        guard var stored = try? await repository.load(boxID: boxID),
              var file = stored.files.first(where: { $0.id == id }) else {
            return
        }
        apply(upload, to: &file)
        ComposerDraftReducer.reduce(&stored, .updateFile(file))
        try? await repository.save(stored, boxID: boxID)
    }

    private func apply(_ upload: UploadedChatFile, to file: inout DraftFile) {
        file.originalName = upload.originalName
        file.size = upload.size
        file.mimetype = upload.mimetype
        file.state = .uploaded(path: upload.path)
    }

    func removeFile(id: Int) async {
        guard let activeBoxID, let file = draft.files.first(where: { $0.id == id }) else {
            return
        }
        ComposerDraftReducer.reduce(&draft, .removeFile(id))
        await flush()
        try? await repository.removePayload(filename: file.filename, boxID: activeBoxID)
    }

    func imageData(for image: DraftImage) async -> Data? {
        guard let activeBoxID else {
            return nil
        }
        return try? await repository.loadPayload(filename: image.filename, boxID: activeBoxID)
    }

    func imageData(for image: DraftImage, boxID: UUID) async -> Data? {
        try? await repository.loadPayload(filename: image.filename, boxID: boxID)
    }

    func emissionImages(from snapshot: ComposerDraft, boxID: UUID) async throws -> [ChatImageAttachment] {
        guard snapshot.images.allSatisfy({ image in
            if case .local = image.state {
                return true
            }
            return false
        }) else {
            throw DraftError.incompleteImage
        }
        return try await repository.emissionImages(snapshot.images, boxID: boxID)
    }

    func emissionFiles(from snapshot: ComposerDraft) throws -> [NativeEmissionFile] {
        try snapshot.files.map { file in
            guard case .uploaded(let path) = file.state else {
                throw DraftError.incompleteFile
            }
            return NativeEmissionFile(
                id: file.id,
                path: path,
                originalName: file.originalName,
                size: file.size,
                mimetype: file.mimetype
            )
        }
    }

    func clearForSending(boxID: UUID) async {
        guard activeBoxID == boxID else {
            try? await repository.save(.empty, boxID: boxID)
            return
        }
        ComposerDraftReducer.reduce(&draft, .reset)
        await flush()
    }

    func restore(_ snapshot: ComposerDraft, boxID: UUID) async {
        if activeBoxID == boxID {
            draft = snapshot
            await flush()
        } else {
            try? await repository.save(snapshot, boxID: boxID)
        }
    }

    func discard(_ snapshot: ComposerDraft, boxID: UUID) async {
        await repository.removePayloads(for: snapshot.images, boxID: boxID)
        await repository.removePayloads(for: snapshot.files, boxID: boxID)
    }

    /// Detach the current draft synchronously so a command can begin its next
    /// input generation from the reset composer. Persistence and payload
    /// cleanup may finish later, but they retain ownership of only this
    /// returned snapshot and can never clear text entered after the command.
    func detachCurrentDraftForDiscard() -> DiscardedDraft? {
        guard let activeBoxID else {
            return nil
        }
        let discarded = DiscardedDraft(snapshot: draft, boxID: activeBoxID)
        ComposerDraftReducer.reduce(&draft, .reset)
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            await self?.flush()
        }
        return discarded
    }

    func finishDiscarding(_ discarded: DiscardedDraft) async {
        await discard(discarded.snapshot, boxID: discarded.boxID)
    }

    func discardCurrentDraft() async {
        guard let activeBoxID else {
            return
        }
        let snapshot = draft
        ComposerDraftReducer.reduce(&draft, .reset)
        await flush()
        await discard(snapshot, boxID: activeBoxID)
    }

    func flush() async {
        saveTask?.cancel()
        guard let activeBoxID, isReady else {
            return
        }
        let snapshot = draft
        do {
            try await repository.save(snapshot, boxID: activeBoxID)
        } catch {
            if self.activeBoxID == activeBoxID {
                restoreNotice = "Draft could not be saved."
            }
        }
    }

    #if DEBUG
    func replaceForFixture(_ fixtureDraft: ComposerDraft, boxID: UUID) {
        activeBoxID = boxID
        draft = fixtureDraft
        isReady = true
        restoreNotice = nil
    }
    #endif

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard Task.isCancelled == false else {
                return
            }
            await self?.flush()
        }
    }

    private func waitForActivation(boxID: UUID) async {
        guard activatingBoxID == boxID else {
            return
        }
        await withCheckedContinuation { continuation in
            activationWaiters[boxID, default: []].append(continuation)
        }
    }

    private func activationIsCurrent(boxID: UUID, generation: UUID) -> Bool {
        activeBoxID == boxID && activationGeneration == generation
    }

    private func legacyDraftKey(boxID: UUID) -> String {
        "draft.\(boxID.uuidString)"
    }
}

private struct VoiceSelectionContext {
    var anchor: String
    var spokenWords: Int
}
