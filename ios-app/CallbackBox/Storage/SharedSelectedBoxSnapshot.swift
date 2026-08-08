import Foundation

protocol SharedSelectedBoxSnapshotStoreProtocol {
    func read() -> SharedSelectedBoxSnapshot?
    func persist(_ selectedBox: PairedBox?)
}

struct SharedSelectedBoxSnapshot: Codable {
    var id: PairedBox.ID
    var label: String
    var baseURL: URL
    var requiresDeviceUnlock: Bool
}

struct SharedSelectedBoxStore: SharedSelectedBoxSnapshotStoreProtocol {
    static let suite = "group.app.callbackbox.ios"
    static let key = "selectedBoxSnapshot"

    private let defaults: UserDefaults?

    init() {
        self.defaults = UserDefaults(suiteName: Self.suite)
    }

    func read() -> SharedSelectedBoxSnapshot? {
        guard let data = defaults?.data(forKey: Self.key) else {
            return nil
        }
        do {
            return try JSONDecoder().decode(SharedSelectedBoxSnapshot.self, from: data)
        } catch {
            assertionFailure("Failed to decode shared selected box snapshot: \(error)")
            return nil
        }
    }

    func persist(_ selectedBox: PairedBox?) {
        guard let selectedBox else {
            defaults?.removeObject(forKey: Self.key)
            return
        }

        let snapshot = SharedSelectedBoxSnapshot(
            id: selectedBox.id,
            label: selectedBox.label,
            baseURL: selectedBox.baseURL,
            requiresDeviceUnlock: selectedBox.requiresDeviceUnlock
        )
        do {
            let data = try JSONEncoder().encode(snapshot)
            defaults?.set(data, forKey: Self.key)
        } catch {
            assertionFailure("Failed to encode shared selected box snapshot: \(error)")
        }
    }
}
