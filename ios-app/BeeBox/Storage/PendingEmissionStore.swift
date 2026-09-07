import Combine
import Foundation

@MainActor
final class PendingEmissionStore: ObservableObject {
    enum StoreError: Error {
        case inactiveBox
        case incompleteFile
        case bindingUnavailable
        case bindingReviewRequired
    }

    @Published private(set) var pending: [PendingEmission] = []
    @Published private(set) var deliveries: [NativeChatEmission] = []
    @Published private(set) var voicePreparations: [VoicePreparation] = []
    @Published private(set) var composerBinding: NativeComposerBinding?
    @Published private var startups: [NativeConversationStartup] = []
    @Published private(set) var notice: String?

    private let repository: ComposerDraftRepository
    private var activeBoxID: UUID?
    private var activationGeneration = UUID()
    private var restored = false
    private var startupReviewIDs: Set<String> = []
    private var waitingBindings: [(NativeComposerBinding, PairedBox)] = []

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
        restored = false
        waitingBindings = []
        pending = []
        deliveries = []
        notice = nil
        do {
            async let restoredPending = repository.loadPendingEmissions(boxID: boxID)
            async let restoredVoice = repository.loadVoicePreparations(boxID: boxID)
            let restored = try await (restoredPending, restoredVoice)
            guard activeBoxID == boxID, activationGeneration == generation else {
                return
            }
            let savedStartups = try? await repository.loadConversationStartups(boxID: boxID)
            guard activeBoxID == boxID, activationGeneration == generation else { return }
            startups = savedStartups ?? []
            pending = restored.0
            voicePreparations = restored.1
            let restoredIDs = pending.compactMap { $0.binding?.target.clientConversationId }
                + voicePreparations.compactMap { $0.binding?.target.clientConversationId }
            startupReviewIDs = Set(restoredIDs).subtracting(startups.map(\.clientConversationId))
            if !startupReviewIDs.isEmpty { notice = "Saved messages need an existing conversation before retrying." }
        } catch {
            guard activeBoxID == boxID, activationGeneration == generation else {
                return
            }
            pending = []
            voicePreparations = []
            notice = "Pending messages could not be restored."
        }
        restored = true
        let bindings = waitingBindings
        waitingBindings = []
        for (publication, box) in bindings { await receiveBinding(publication, box: box) }
        await rebuildDeliveries()
    }

    func deactivate() {
        activationGeneration = UUID()
        activeBoxID = nil
        restored = false
        waitingBindings = []
        pending = []
        deliveries = []
        voicePreparations = []
        notice = nil
        composerBinding = nil
        startups = []
        startupReviewIDs = []
    }

    func invalidateBinding() { composerBinding = nil }

    func changesConversation(_ publication: NativeComposerBinding) -> Bool {
        guard publication.kind == .selection else { return false }
        let old = composerBinding?.selection?.target
        let new = publication.selection?.target
        if old?.logicalID == new?.logicalID { return false }
        if old?.kind == .start, new?.kind == .session,
           let alias = startups.first(where: { $0.clientConversationId == old?.clientConversationId })?.sessionId,
           alias == new?.sessionId { return false }
        return true
    }

    var selectedSessionID: String? {
        guard let target = composerBinding?.sendBinding?.target else { return nil }
        if target.kind == .session { return target.sessionId }
        return startups.first { $0.clientConversationId == target.clientConversationId }?.sessionId
    }

    func bindLegacyVoice(id: UUID) async {
        guard let index = voicePreparations.firstIndex(where: { $0.id == id }),
              voicePreparations[index].binding == nil, let binding = composerBinding?.sendBinding,
              let boxID = activeBoxID else { return }
        voicePreparations[index].binding = binding
        voicePreparations[index].bindingRevision = composerBinding?.revision
        do { try await repository.saveVoicePreparations(voicePreparations, boxID: boxID) }
        catch { voicePreparations[index].binding = nil; notice = "Conversation could not be saved." }
    }

    func receiveBinding(_ publication: NativeComposerBinding, box: PairedBox) async {
        guard publication.isValid, publication.boxSlug == box.baseURL.lastPathComponent,
              activeBoxID == box.id else { return }
        guard restored else { waitingBindings.append((publication, box)); return }
        if publication.kind == .selection {
            if composerBinding?.selection?.target?.logicalID != publication.selection?.target?.logicalID {
                BoxLog.info("composer binding selection state=\(publication.selection?.kind.rawValue ?? "unknown")",
                    category: .composer, targetBoxID: box.id)
            }
            composerBinding = publication
            return
        }
        guard let clientID = publication.clientConversationId, let sessionID = publication.sessionId else { return }
        if let index = startups.firstIndex(where: { $0.clientConversationId == clientID }) {
            guard startups[index].target.contextDir == publication.contextDir else { return }
            startups[index].state = .assigned
            startups[index].sessionId = sessionID
            do { try await repository.saveConversationStartups(startups, boxID: box.id) }
            catch { notice = "Conversation assignment could not be saved. Keep this page open and retry." }
        }
        BoxLog.info("composer binding assigned", category: .composer, targetBoxID: box.id)
        // Assignment updates waiting deliveries, never the selected conversation.
        await rebuildDeliveries()
    }

    /// Frozen at the gesture, before attachments or HQ work can suspend.
    func replacementFirstEmissionID(for binding: NativeSendBinding?) -> UUID? {
        guard let clientID = binding?.target.clientConversationId,
              let startup = startups.first(where: { $0.clientConversationId == clientID }),
              startup.state == .prepared else { return nil }
        return startup.firstEmissionId
    }

    private func prepareStartup(_ emission: PendingEmission) async throws {
        guard let target = emission.binding?.target, target.kind == .start,
              let clientID = target.clientConversationId else { return }
        if startupReviewIDs.contains(clientID) { throw StoreError.bindingReviewRequired }
        if let index = startups.firstIndex(where: { $0.clientConversationId == clientID }) {
            let previous = startups[index]
            if previous.state == .prepared,
               previous.firstEmissionId == emission.id || previous.firstEmissionId == emission.replacesFirstEmissionID {
                startups[index].firstEmissionId = emission.id
                startups[index].state = .attempted
                do { try await repository.saveConversationStartups(startups, boxID: emission.boxID) }
                catch { startups[index] = previous; throw error }
            } else if previous.firstEmissionId != emission.id && previous.state != .assigned {
                throw StoreError.bindingUnavailable
            }
            return
        }
        startups.append(NativeConversationStartup(clientConversationId: clientID,
            firstEmissionId: emission.id, target: target, state: .attempted))
        do { try await repository.saveConversationStartups(startups, boxID: emission.boxID) }
        catch { startups.removeAll { $0.clientConversationId == clientID }; throw error }
    }

    func stageVoicePreparation(
        draft: ComposerDraft,
        liveTranscript: String,
        priorInput: String,
        action: SpeechKeywordAction,
        matchedPhrase: String,
        appendsKeywordTag: Bool = true,
        audioURL: URL?,
        boxID: UUID,
        binding: NativeSendBinding? = nil,
        bindingRevision: Int? = nil,
        replacesFirstEmissionID: UUID? = nil
    ) async throws -> VoicePreparation {
        guard activeBoxID == boxID else {
            throw StoreError.inactiveBox
        }
        let id = UUID()
        let audioFilename = audioURL.map { _ in "voice-\(id.uuidString.lowercased()).wav" }
        if let audioURL, let audioFilename {
            try await repository.importPayload(from: audioURL, filename: audioFilename, boxID: boxID)
        }
        let preparation = VoicePreparation(
            binding: binding, bindingRevision: bindingRevision, replacesFirstEmissionID: replacesFirstEmissionID,
            id: id,
            boxID: boxID,
            draft: draft,
            liveTranscript: liveTranscript,
            priorInput: priorInput,
            action: action,
            matchedPhrase: matchedPhrase,
            appendsKeywordTag: appendsKeywordTag,
            audioFilename: audioFilename,
            createdAt: Date()
        )
        do {
            let updated = voicePreparations + [preparation]
            try await repository.saveVoicePreparations(updated, boxID: boxID)
            voicePreparations = updated
            return preparation
        } catch {
            if let audioFilename {
                try? await repository.removePayload(filename: audioFilename, boxID: boxID)
            }
            throw error
        }
    }

    func voiceAudioURL(for preparation: VoicePreparation) async -> URL? {
        guard let filename = preparation.audioFilename else {
            return nil
        }
        return try? await repository.payloadURL(filename: filename, boxID: preparation.boxID)
    }

    func finishVoicePreparation(
        id: UUID,
        text: String,
        diarized: Bool,
        hqText: Bool,
        hqService: String?
    ) async throws {
        guard let index = voicePreparations.firstIndex(where: { $0.id == id }) else {
            return
        }
        let preparation = voicePreparations[index]
        guard activeBoxID == preparation.boxID else {
            throw StoreError.inactiveBox
        }
        if pending.contains(where: { $0.id == id }) == false {
            let emission = PendingEmission(
                binding: preparation.binding, bindingRevision: preparation.bindingRevision, replacesFirstEmissionID: preparation.replacesFirstEmissionID,
                id: id,
                boxID: preparation.boxID,
                draft: preparation.draft,
                text: text,
                origin: .voice,
                diarized: diarized,
                hqText: hqText ? true : nil,
                hqService: hqText ? hqService : nil,
                state: .pending(deliveryAttempts: 0, lastAttemptAt: nil),
                createdAt: preparation.createdAt
            )
            _ = try await nativeEmission(from: emission)
            pending.append(emission)
            sortPendingByCreation()
            try await persist()
        }
        let remaining = voicePreparations.filter { $0.id != id }
        if remaining.isEmpty {
            try await repository.clearVoicePreparation(boxID: preparation.boxID)
        } else {
            try await repository.saveVoicePreparations(remaining, boxID: preparation.boxID)
        }
        if let filename = preparation.audioFilename {
            try? await repository.removePayload(filename: filename, boxID: preparation.boxID)
        }
        voicePreparations = remaining
        await rebuildDeliveries()
    }

    func enqueue(
        draft: ComposerDraft,
        text: String,
        origin: NativeEmissionV2.Origin,
        diarized: Bool,
        boxID: UUID,
        binding: NativeSendBinding? = nil,
        bindingRevision: Int? = nil,
        replacesFirstEmissionID: UUID? = nil
    ) async throws -> PendingEmission {
        guard activeBoxID == boxID else {
            throw StoreError.inactiveBox
        }
        let emission = PendingEmission(
            binding: binding, bindingRevision: bindingRevision, replacesFirstEmissionID: replacesFirstEmissionID,
            id: UUID(),
            boxID: boxID,
            draft: draft,
            text: text,
            origin: origin,
            diarized: diarized,
            state: .pending(deliveryAttempts: 0, lastAttemptAt: nil),
            createdAt: Date()
        )
        _ = try await nativeEmission(from: emission)
        let previous = pending
        pending.append(emission)
        sortPendingByCreation()
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
        let attempts: Int
        switch pending[index].state {
        case .pending(let priorAttempts, _):
            attempts = priorAttempts + 1
        case .rejected:
            return
        }
        pending[index].state = .pending(deliveryAttempts: attempts, lastAttemptAt: date)
        try? await persist()
    }

    func handleReceipt(_ receipt: NativeEmissionReceipt) async {
        guard let index = pending.firstIndex(where: { $0.id == receipt.emissionID }) else {
            return
        }
        switch receipt.disposition {
        case .sent, .queued:
            if let clientID = pending[index].binding?.target.clientConversationId,
               let startupIndex = startups.firstIndex(where: { $0.clientConversationId == clientID }) {
                if startups[startupIndex].state != .assigned { startups[startupIndex].state = .accepted }
                do { try await repository.saveConversationStartups(startups, boxID: pending[index].boxID) }
                catch { notice = "Message accepted; conversation recovery could not be saved."; return }
            }
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
            if receipt.definitive == true,
               let clientID = pending[index].binding?.target.clientConversationId,
               let startupIndex = startups.firstIndex(where: { $0.clientConversationId == clientID }),
               startups[startupIndex].firstEmissionId == receipt.emissionID,
               startups[startupIndex].state != .assigned {
                startups[startupIndex].state = .prepared
                do { try await repository.saveConversationStartups(startups, boxID: pending[index].boxID) }
                catch { notice = "The refused message needs conversation recovery before retry." }
            }
            pending[index].state = .rejected(reason: receipt.reason ?? "The message was not accepted.")
            deliveries.removeAll { $0.id == receipt.emissionID }
            do {
                try await persist()
            } catch {
                notice = "The rejected message could not be saved."
            }
            await rebuildDeliveries()
        }
    }

    func retry(id: UUID) async {
        guard let index = pending.firstIndex(where: { $0.id == id }) else {
            return
        }
        let needsStartupReview = pending[index].binding?.target.clientConversationId.map(startupReviewIDs.contains) == true
        if pending[index].binding == nil || needsStartupReview {
            guard let binding = composerBinding?.sendBinding,
                  !needsStartupReview || binding.target.kind == .session else {
                notice = "Choose a conversation before retrying."
                return
            }
            pending[index].binding = binding
            pending[index].bindingRevision = composerBinding?.revision
        }
        pending[index].state = .pending(deliveryAttempts: 0, lastAttemptAt: nil)
        do { try await persist() }
        catch { notice = "Retry could not be saved."; return }
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
            await forgetRetainedVoiceAudio(for: restored)
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
            await forgetRetainedVoiceAudio(for: discarded)
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
        let preparationBarrier = voicePreparations.map(\.createdAt).min()
        for index in pending.indices {
            guard pending[index].boxID == activeBoxID else {
                continue
            }
            if let preparationBarrier, pending[index].createdAt > preparationBarrier {
                continue
            }
            if pending[index].binding == nil {
                pending[index].state = .rejected(reason: "Choose a conversation, then send here. The original message ID is retained.")
                changed = true
            }
            if case .rejected = pending[index].state {
                continue
            }
            do {
                try await prepareStartup(pending[index])
                var delivery = try await nativeEmission(from: pending[index])
                if let clientID = delivery.binding?.target.clientConversationId,
                   let startup = startups.first(where: { $0.clientConversationId == clientID }),
                   let sessionID = startup.sessionId {
                    delivery.binding?.target = NativeConversationTarget(kind: .session,
                        sessionId: sessionID, contextDir: startup.target.contextDir)
                }
                rebuilt.append(delivery)
            } catch StoreError.bindingReviewRequired {
                pending[index].state = .rejected(reason: "Choose an existing conversation, then Retry. This keeps the original message ID.")
                changed = true
            } catch StoreError.bindingUnavailable {
                let clientID = pending[index].binding?.target.clientConversationId
                if startups.contains(where: { $0.clientConversationId == clientID && $0.state == .prepared }) {
                    pending[index].state = .rejected(reason: "The first message was refused. Restore this message before sending again.")
                    changed = true
                } else {
                    notice = "Waiting for conversation. If startup was interrupted, restore and choose a conversation."
                }
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

    private func sortPendingByCreation() {
        pending.sort { first, second in
            if first.createdAt == second.createdAt {
                return first.id.uuidString < second.id.uuidString
            }
            return first.createdAt < second.createdAt
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
            binding: pending.binding, bindingRevision: pending.bindingRevision,
            id: pending.id,
            text: pending.text,
            origin: pending.origin,
            diarized: pending.diarized,
            hqText: pending.hqText,
            hqService: pending.hqService,
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

    /// Drop a voice send's retained recording when the message itself is going
    /// away — discarded, or pulled back into the composer. Retention outlives
    /// delivery on purpose (that is what makes retranscription work), but it
    /// must not outlive a message the user withdrew. A REJECTED emission keeps
    /// its recording: `retry` can still send it.
    private func forgetRetainedVoiceAudio(for emission: PendingEmission) async {
        guard emission.origin == .voice else {
            return
        }
        await VoiceAudioRetentionStore.shared.forget(
            emissionID: emission.id.uuidString,
            boxID: emission.boxID
        )
    }
}
