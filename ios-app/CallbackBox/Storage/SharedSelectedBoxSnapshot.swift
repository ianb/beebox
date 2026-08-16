import Foundation

protocol SharedSelectedBoxSnapshotStoreProtocol {
    func read() -> SharedPairedBoxesSnapshot?
    func persist(boxes: [PairedBox], selectedBoxID: PairedBox.ID?)
}

struct SharedPairedBoxMetadata: Codable, Equatable, Identifiable {
    var id: PairedBox.ID
    var label: String
    var baseURL: URL
    var requiresDeviceUnlock: Bool

    init(box: PairedBox) {
        id = box.id
        label = box.label
        baseURL = box.baseURL
        requiresDeviceUnlock = box.requiresDeviceUnlock
    }

    func pairedBox(withToken token: String) -> PairedBox {
        PairedBox(
            id: id,
            label: label,
            baseURL: baseURL,
            sessionID: nil,
            authToken: token,
            requiresDeviceUnlock: requiresDeviceUnlock
        )
    }

    var displayLabel: String {
        guard let host = baseURL.host, host != label else { return label }
        return "\(label) — \(host)"
    }
}

struct ShareDestinationLoadTracker {
    private(set) var currentID = UUID()

    mutating func begin() -> UUID {
        let loadID = UUID()
        currentID = loadID
        return loadID
    }

    func accepts(_ loadID: UUID) -> Bool {
        currentID == loadID
    }
}

struct SharedPairedBoxesSnapshot: Codable, Equatable {
    var boxes: [SharedPairedBoxMetadata]
    var selectedBoxID: PairedBox.ID?

    var selectedBox: SharedPairedBoxMetadata? {
        guard let selectedBoxID else { return boxes.first }
        return boxes.first { $0.id == selectedBoxID } ?? boxes.first
    }
}

struct SharedSelectedBoxStore: SharedSelectedBoxSnapshotStoreProtocol {
    static let suite = "group.app.callbackbox.ios"
    static let key = "selectedBoxSnapshot"

    private let defaults: UserDefaults?

    init() {
        defaults = UserDefaults(suiteName: Self.suite)
    }

    init(defaults: UserDefaults?) {
        self.defaults = defaults
    }

    func read() -> SharedPairedBoxesSnapshot? {
        guard let data = defaults?.data(forKey: Self.key) else { return nil }
        do {
            return try JSONDecoder().decode(SharedPairedBoxesSnapshot.self, from: data)
        } catch {
            // The first shipped Share Extension stored only the selected box.
            // Keep that snapshot usable until the main app next publishes the
            // complete list after an upgrade.
            if let legacy = try? JSONDecoder().decode(LegacySelectedBoxSnapshot.self, from: data) {
                let metadata = SharedPairedBoxMetadata(
                    box: PairedBox(
                        id: legacy.id,
                        label: legacy.label,
                        baseURL: legacy.baseURL,
                        sessionID: nil,
                        authToken: nil,
                        requiresDeviceUnlock: legacy.requiresDeviceUnlock
                    )
                )
                return SharedPairedBoxesSnapshot(boxes: [metadata], selectedBoxID: metadata.id)
            }
            assertionFailure("Failed to decode shared paired-box snapshot: \(error)")
            return nil
        }
    }

    func persist(boxes: [PairedBox], selectedBoxID: PairedBox.ID?) {
        guard boxes.isEmpty == false else {
            defaults?.removeObject(forKey: Self.key)
            return
        }
        let snapshot = SharedPairedBoxesSnapshot(
            boxes: boxes.map(SharedPairedBoxMetadata.init),
            selectedBoxID: selectedBoxID
        )
        do {
            defaults?.set(try JSONEncoder().encode(snapshot), forKey: Self.key)
        } catch {
            assertionFailure("Failed to encode shared paired-box snapshot: \(error)")
        }
    }

    private struct LegacySelectedBoxSnapshot: Codable {
        var id: PairedBox.ID
        var label: String
        var baseURL: URL
        var requiresDeviceUnlock: Bool
    }
}
