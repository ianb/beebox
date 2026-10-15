import Foundation

/// Capture ownership is independent of the box currently being browsed.
struct CaptureDestinationStore {
    static let key = "captureDefaultBoxID"
    private let defaults: UserDefaults?

    init(defaults: UserDefaults? = UserDefaults(suiteName: "group.app.beebox.ios")) {
        self.defaults = defaults
    }

    var defaultBoxID: UUID? {
        get { defaults?.string(forKey: Self.key).flatMap(UUID.init(uuidString:)) }
        nonmutating set {
            if let newValue { defaults?.set(newValue.uuidString, forKey: Self.key) }
            else { defaults?.removeObject(forKey: Self.key) }
        }
    }

    enum DestinationError: LocalizedError {
        case needsDefault, removed, protected, missingCredential
        var errorDescription: String? {
            switch self {
            case .needsDefault: "Choose a capture default in Bee Box first."
            case .removed: "The capture destination is no longer paired. Choose a destination in Bee Box."
            case .protected: "This box is unavailable to Siri and Shortcuts. Choose another capture destination."
            case .missingCredential: "Pair this box again before capturing."
            }
        }
    }

    func resolve(boxes: [PairedBox], pinnedBoxID: UUID? = nil, allowsProtected: Bool = false) throws -> PairedBox {
        // Initialization is once-only. A removed explicit default must never fall back.
        if pinnedBoxID == nil, defaultBoxID == nil, boxes.count == 1 {
            defaultBoxID = boxes[0].id
        }
        guard let id = pinnedBoxID ?? defaultBoxID else { throw DestinationError.needsDefault }
        guard let box = boxes.first(where: { $0.id == id }) else { throw DestinationError.removed }
        if box.requiresDeviceUnlock && !allowsProtected { throw DestinationError.protected }
        guard let token = box.authToken, !token.isEmpty else { throw DestinationError.missingCredential }
        return box
    }
}
