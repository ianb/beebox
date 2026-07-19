import Combine
import Foundation

@MainActor
final class ComposerDraftStore: ObservableObject {
    @Published private(set) var draft = ComposerDraft.empty
    @Published private(set) var restoreNotice: String?

    private let repository: ComposerDraftRepository
    private let defaults: UserDefaults
    private var activeBoxID: UUID?
    private var saveTask: Task<Void, Never>?

    init(
        repository: ComposerDraftRepository = ComposerDraftRepository(),
        defaults: UserDefaults = .standard
    ) {
        self.repository = repository
        self.defaults = defaults
    }

    func activate(boxID: UUID) async {
        guard boxID != activeBoxID else {
            return
        }
        await flush()
        saveTask?.cancel()
        activeBoxID = boxID
        restoreNotice = nil
        do {
            if var restored = try await repository.load(boxID: boxID) {
                let missingImageIDs = await repository.missingImageIDs(restored.images, boxID: boxID)
                for id in missingImageIDs {
                    ComposerDraftReducer.reduce(&restored, .removeImage(id))
                }
                draft = restored
                if missingImageIDs.isEmpty == false {
                    restoreNotice = "Some draft images were missing and were removed."
                    await flush()
                }
                return
            }
        } catch {
            restoreNotice = "Draft could not be restored."
        }
        let key = legacyDraftKey(boxID: boxID)
        if let legacyText = defaults.string(forKey: key) {
            draft = .empty
            ComposerDraftReducer.reduce(&draft, .setText(legacyText))
            defaults.removeObject(forKey: key)
            await flush()
        } else {
            draft = .empty
        }
    }

    func setText(_ text: String) {
        ComposerDraftReducer.reduce(&draft, .setText(text))
        scheduleSave()
    }

    func setSelection(_ selection: NSRangeValue) {
        ComposerDraftReducer.reduce(&draft, .setSelection(selection))
        scheduleSave()
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

    func imageData(for image: DraftImage) async -> Data? {
        guard let activeBoxID else {
            return nil
        }
        return try? await repository.loadPayload(filename: image.filename, boxID: activeBoxID)
    }

    func emissionImages(from snapshot: ComposerDraft, boxID: UUID) async throws -> [ChatImageAttachment] {
        try await repository.emissionImages(snapshot.images, boxID: boxID)
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
        guard let activeBoxID else {
            return
        }
        do {
            try await repository.save(draft, boxID: activeBoxID)
        } catch {
            restoreNotice = "Draft could not be saved."
        }
    }

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

    private func legacyDraftKey(boxID: UUID) -> String {
        "draft.\(boxID.uuidString)"
    }
}
