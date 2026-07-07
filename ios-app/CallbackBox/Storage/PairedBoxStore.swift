import Combine
import Foundation

@MainActor
final class PairedBoxStore: ObservableObject {
    @Published private(set) var boxes: [PairedBox] = []
    @Published var selectedBoxID: PairedBox.ID?

    private let storageURL: URL

    init() {
        let supportDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        storageURL = supportDirectory.appendingPathComponent("paired-boxes.json")
        load()
    }

    var selectedBox: PairedBox? {
        guard let selectedBoxID else {
            return boxes.first
        }
        return boxes.first { $0.id == selectedBoxID } ?? boxes.first
    }

    func addManualBox(label: String, baseURL: URL, sessionID: String?) {
        addOrSelectBox(label: label, baseURL: baseURL, sessionID: sessionID)
    }

    func addOrSelectBox(label: String, baseURL: URL, sessionID: String?) {
        let cleanLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanSessionID = sessionID?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        if let existing = boxes.first(where: { $0.baseURL == baseURL && $0.sessionID == cleanSessionID }) {
            selectedBoxID = existing.id
            save()
            return
        }
        let normalized = PairedBox(
            id: UUID(),
            label: cleanLabel.isEmpty ? baseURL.host ?? "Callback Box" : cleanLabel,
            baseURL: baseURL,
            sessionID: cleanSessionID
        )
        boxes.append(normalized)
        selectedBoxID = normalized.id
        save()
    }

    func pair(from url: URL) -> Bool {
        guard url.scheme == "callbackbox", url.host == "pair" else {
            return false
        }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return false
        }
        let queryItems = components.queryItems ?? []
        guard let baseURLString = queryItems.value(named: "baseURL") ?? queryItems.value(named: "url") else {
            return false
        }
        guard let baseURL = URL(string: baseURLString), baseURL.scheme != nil, baseURL.host != nil else {
            return false
        }
        addOrSelectBox(
            label: queryItems.value(named: "label") ?? "Callback Box",
            baseURL: baseURL,
            sessionID: queryItems.value(named: "session")
        )
        return true
    }

    #if DEBUG
    func addLocalTestBox() {
        guard let url = URL(string: "http://127.0.0.1:3210/main/test1") else {
            assertionFailure("Local test box URL is invalid")
            return
        }
        addOrSelectBox(label: "Local test box", baseURL: url, sessionID: nil)
    }
    #endif

    func select(_ box: PairedBox) {
        selectedBoxID = box.id
        save()
    }

    func remove(at offsets: IndexSet) {
        for index in offsets.sorted(by: >) {
            boxes.remove(at: index)
        }
        if let selectedBoxID, boxes.contains(where: { $0.id == selectedBoxID }) == false {
            self.selectedBoxID = boxes.first?.id
        }
        save()
    }

    private func load() {
        do {
            let data = try Data(contentsOf: storageURL)
            let snapshot = try JSONDecoder().decode(StoreSnapshot.self, from: data)
            boxes = snapshot.boxes
            selectedBoxID = snapshot.selectedBoxID
        } catch {
            boxes = []
            selectedBoxID = nil
        }
    }

    private func save() {
        do {
            try FileManager.default.createDirectory(
                at: storageURL.deletingLastPathComponent(),
                withIntermediateDirectories: true,
                attributes: nil
            )
            let snapshot = StoreSnapshot(boxes: boxes, selectedBoxID: selectedBoxID)
            let data = try JSONEncoder().encode(snapshot)
            try data.write(to: storageURL, options: [.atomic])
        } catch {
            assertionFailure("Failed to save paired boxes: \(error)")
        }
    }
}

private struct StoreSnapshot: Codable {
    var boxes: [PairedBox]
    var selectedBoxID: PairedBox.ID?
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

private extension [URLQueryItem] {
    func value(named name: String) -> String? {
        first { $0.name == name }?.value
    }
}
