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
            if let restored = try await repository.load(boxID: boxID) {
                draft = restored
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
