import Combine
import Foundation

@MainActor
final class PendingEmissionStore: ObservableObject {
    enum StoreError: Error {
        case inactiveBox
        case incompleteFile
    }

    @Published private(set) var pending: [PendingEmission] = []
    @Published private(set) var deliveries: [NativeChatEmission] = []
    @Published private(set) var notice: String?

    private let repository: ComposerDraftRepository
    private var activeBoxID: UUID?
    private var activationGeneration = UUID()

    init(repository: ComposerDraftRepository = ComposerDraftRepository()) {
        self.repository = repository
    }

    func activate(boxID: UUID) async {
        guard activeBoxID != boxID else {
            return
        }
        let generation = UUID()
        activationGeneration = generation
        activeBoxID = boxID
        pending = []
        deliveries = []
        notice = nil
        do {
            let restored = try await repository.loadPendingEmissions(boxID: boxID)
            guard activeBoxID == boxID, activationGeneration == generation else {
                return
            }
            pending = restored
        } catch {
            guard activeBoxID == boxID, activationGeneration == generation else {
                return
            }
            pending = []
            notice = "Pending messages could not be restored."
        }
        await rebuildDeliveries()
    }

    func deactivate() {
        activationGeneration = UUID()
        activeBoxID = nil
        pending = []
        deliveries = []
        notice = nil
    }

    func enqueue(
        draft: ComposerDraft,
        text: String,
        origin: NativeEmissionV2.Origin,
        diarized: Bool,
        boxID: UUID
    ) async throws -> PendingEmission {
        guard activeBoxID == boxID else {
            throw StoreError.inactiveBox
        }
        let emission = PendingEmission(
            id: UUID(),
            boxID: boxID,
            draft: draft,
            text: text,
            origin: origin,
            diarized: diarized,
            state: .awaitingWebView,
            createdAt: Date()
        )
        _ = try await nativeEmission(from: emission)
        let previous = pending
        pending.append(emission)
        do {
            try await persist()
            await rebuildDeliveries()
            return emission
        } catch {
            pending = previous
            throw error
        }
    }

    func markDeliveryAttempt(id: UUID, at date: Date = Date()) async {
        guard let index = pending.firstIndex(where: { $0.id == id }) else {
            return
        }
        let attempt: Int
        switch pending[index].state {
        case .awaitingWebView:
            attempt = 1
        case .awaitingReceipt(let priorAttempt, _):
            attempt = priorAttempt + 1
        case .rejected:
            return
        }
        pending[index].state = .awaitingReceipt(attempt: attempt, sentAt: date)
        try? await persist()
    }

    func handleReceipt(_ receipt: NativeEmissionReceipt) async {
        guard let index = pending.firstIndex(where: { $0.id == receipt.emissionID }) else {
            return
        }
        switch receipt.disposition {
        case .sent, .queued:
            let completed = pending.remove(at: index)
            deliveries.removeAll { $0.id == completed.id }
            do {
                try await persist()
                await removePayloads(for: completed)
            } catch {
                pending.insert(completed, at: min(index, pending.endIndex))
                notice = "A delivered message could not be cleared locally; it will retry safely."
                await rebuildDeliveries()
            }
        case .rejected:
            pending[index].state = .rejected(reason: receipt.reason ?? "The message was not accepted.")
            deliveries.removeAll { $0.id == receipt.emissionID }
            do {
                try await persist()
            } catch {
                notice = "The rejected message could not be saved."
            }
        }
    }

    func retry(id: UUID) async {
        guard let index = pending.firstIndex(where: { $0.id == id }) else {
            return
        }
        pending[index].state = .awaitingWebView
        try? await persist()
        await rebuildDeliveries()
    }

    func takeForRestore(id: UUID) async -> ComposerDraft? {
        guard let index = pending.firstIndex(where: { $0.id == id }) else {
            return nil
        }
        let restored = pending.remove(at: index)
        deliveries.removeAll { $0.id == id }
        do {
            try await persist()
            return restored.draft
        } catch {
            pending.insert(restored, at: min(index, pending.endIndex))
            notice = "The message could not be restored safely."
            await rebuildDeliveries()
            return nil
        }
    }

    func discard(id: UUID) async {
        guard let index = pending.firstIndex(where: { $0.id == id }) else {
            return
        }
        let discarded = pending.remove(at: index)
        deliveries.removeAll { $0.id == id }
        do {
            try await persist()
            await removePayloads(for: discarded)
        } catch {
            pending.insert(discarded, at: min(index, pending.endIndex))
            notice = "The message could not be discarded safely."
            await rebuildDeliveries()
        }
    }

    private func rebuildDeliveries() async {
        guard let activeBoxID else {
            deliveries = []
            return
        }
        var rebuilt: [NativeChatEmission] = []
        var changed = false
        for index in pending.indices {
            guard pending[index].boxID == activeBoxID else {
                continue
            }
            if case .rejected = pending[index].state {
                continue
            }
            do {
                rebuilt.append(try await nativeEmission(from: pending[index]))
            } catch {
                pending[index].state = .rejected(reason: "A saved attachment is missing or incomplete.")
                changed = true
            }
        }
        deliveries = rebuilt
        if changed {
            try? await persist()
        }
    }

    private func nativeEmission(from pending: PendingEmission) async throws -> NativeChatEmission {
        let images = try await repository.emissionImages(pending.draft.images, boxID: pending.boxID)
        let files = try pending.draft.files.map { file -> NativeEmissionFile in
            guard case .uploaded(let path) = file.state else {
                throw StoreError.incompleteFile
            }
            return NativeEmissionFile(
                id: file.id,
                path: path,
                originalName: file.originalName,
                size: file.size,
                mimetype: file.mimetype
            )
        }
        let selections = pending.draft.selections.map { selection in
            NativeEmissionSelection(
                id: selection.id,
                ref: selection.ref,
                text: selection.text,
                position: selection.position,
                anchor: selection.anchor,
                spokenWords: selection.spokenWords
            )
        }
        return NativeChatEmission(
            id: pending.id,
            text: pending.text,
            origin: pending.origin,
            diarized: pending.diarized,
            images: images,
            files: files,
            selections: selections
        )
    }

    private func persist() async throws {
        guard let activeBoxID else {
            throw StoreError.inactiveBox
        }
        try await repository.savePendingEmissions(pending, boxID: activeBoxID)
    }

    private func removePayloads(for emission: PendingEmission) async {
        await repository.removePayloads(for: emission.draft.images, boxID: emission.boxID)
        await repository.removePayloads(for: emission.draft.files, boxID: emission.boxID)
    }
}
