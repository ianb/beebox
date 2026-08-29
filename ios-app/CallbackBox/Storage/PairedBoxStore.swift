import Combine
import Foundation
import UIKit

@MainActor
final class PairedBoxStore: ObservableObject {
    @Published private(set) var boxes: [PairedBox] = []
    @Published var selectedBoxID: PairedBox.ID?

    private let storageURL: URL
    private let credentialStore: PairedBoxCredentialStoreProtocol
    private let selectedBoxStore: SharedSelectedBoxSnapshotStoreProtocol

    convenience init() {
        let supportDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        self.init(
            storageURL: supportDirectory.appendingPathComponent("paired-boxes.json"),
            credentialStore: PairedBoxCredentialStore(),
            selectedBoxStore: SharedSelectedBoxStore()
        )
    }

    init(
        storageURL: URL,
        credentialStore: PairedBoxCredentialStoreProtocol = PairedBoxCredentialStore(),
        selectedBoxStore: SharedSelectedBoxSnapshotStoreProtocol = SharedSelectedBoxStore()
    ) {
        self.storageURL = storageURL
        self.credentialStore = credentialStore
        self.selectedBoxStore = selectedBoxStore
        load()
    }

    var selectedBox: PairedBox? {
        guard let selectedBoxID else {
            return boxes.first
        }
        return boxes.first { $0.id == selectedBoxID } ?? boxes.first
    }

    func addManualBox(label: String, baseURL: URL, sessionID: String?) {
        _ = addOrSelectBox(label: label, baseURL: baseURL, sessionID: sessionID, authToken: nil)
    }

    @discardableResult func addOrSelectBox(
        label: String,
        baseURL: URL,
        sessionID: String?,
        authToken: String?
    ) -> Bool {
        let cleanLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanSessionID = sessionID?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        let cleanAuthToken = authToken?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        return addOrSelectBoxInternal(
            label: cleanLabel,
            baseURL: baseURL,
            sessionID: cleanSessionID,
            authToken: cleanAuthToken
        )
    }

    @discardableResult private func addOrSelectBoxInternal(
        label: String,
        baseURL: URL,
        sessionID: String?,
        authToken: String?
    ) -> Bool {
        let resolvedLabel = label.isEmpty ? (baseURL.host ?? "Callback Box") : label

        if let existingIndex = boxes.firstIndex(where: { $0.baseURL == baseURL && $0.sessionID == sessionID }) {
            let cleanLabel = label.isEmpty ? boxes[existingIndex].label : label
            var existing = boxes[existingIndex]
            existing.label = cleanLabel

            if let authToken {
                do {
                    try persistToken(authToken, for: existing.id)
                    existing.authToken = authToken
                } catch {
                    return false
                }
            }

            boxes[existingIndex] = existing
            selectedBoxID = existing.id
            save()
            return true
        }

        let resolvedID = UUID()
        if let authToken {
            do {
                try persistToken(authToken, for: resolvedID)
            } catch {
                return false
            }
        }

        let normalized = PairedBox(
            id: resolvedID,
            label: resolvedLabel,
            baseURL: baseURL,
            sessionID: sessionID,
            authToken: authToken,
            requiresDeviceUnlock: false
        )
        boxes.append(normalized)
        selectedBoxID = normalized.id
        save()
        return true
    }

    func pair(from url: URL) async -> Bool {
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
        let label = queryItems.value(named: "label") ?? "Callback Box"
        if let pairingToken = queryItems.value(named: "pairingToken") ?? queryItems.value(named: "token") {
            do {
                let redeemed = try await redeemPairing(baseURL: baseURL, pairingToken: pairingToken)
                return addOrSelectBox(
                    label: label,
                    baseURL: baseURL,
                    sessionID: queryItems.value(named: "session"),
                    authToken: redeemed.token
                )
            } catch {
                return false
            }
        }
        #if DEBUG
        let directAuthToken = queryItems.value(named: "authToken")
        #else
        let directAuthToken: String? = nil
        #endif
        return addOrSelectBox(
            label: label,
            baseURL: baseURL,
            sessionID: queryItems.value(named: "session"),
            authToken: directAuthToken
        )
    }

    #if DEBUG
    func addLocalTestBox() {
        guard let url = URL(string: "http://127.0.0.1:3210/main/test1") else {
            assertionFailure("Local test box URL is invalid")
            return
        }
        _ = addOrSelectBox(label: "Local test box", baseURL: url, sessionID: nil, authToken: nil)
    }
    #endif

    func select(_ box: PairedBox) {
        selectedBoxID = box.id
        save()
    }

    func setRequiresDeviceUnlock(_ required: Bool, for box: PairedBox) {
        guard let index = boxes.firstIndex(where: { $0.id == box.id }) else {
            return
        }
        boxes[index].requiresDeviceUnlock = required
        save()
    }

    func remove(at offsets: IndexSet) {
        let toRemove = offsets.compactMap { boxes[safe: $0] }
        do {
            try removeBoxes(toRemove)
        } catch {
            // Failed pairing cleanup is intentionally non-fatal; keep metadata unchanged.
        }
    }

    func remove(_ box: PairedBox) {
        do {
            try removeBoxes([box])
        } catch {
            // Failed pairing cleanup is intentionally non-fatal; keep metadata unchanged.
        }
    }

    private func removeBoxes(_ boxesToRemove: [PairedBox]) throws {
        guard boxesToRemove.isEmpty == false else {
            return
        }

        try deleteTokensFirst(for: boxesToRemove)
        // Retained voice recordings belong to the box they were dictated into,
        // so unpairing takes them with it — synchronously, before the pairing
        // itself is dropped. Deferring it to a task would let the app be
        // suspended in between, leaving audio on disk for a box the user has
        // just removed.
        for box in boxesToRemove {
            VoiceAudioRetentionStore.forgetSynchronously(boxID: box.id)
        }
        let removing = Set(boxesToRemove.map(\.id))
        boxes.removeAll { removing.contains($0.id) }
        if let selectedBoxID, removing.contains(selectedBoxID) {
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
            _ = migrateOrRestoreTokens()
        } catch {
            boxes = []
            selectedBoxID = nil
        }
        publishSharedBoxes()
    }

    private func save() {
        do {
            try FileManager.default.createDirectory(
                at: storageURL.deletingLastPathComponent(),
                withIntermediateDirectories: true,
                attributes: nil
            )
        let snapshot = StoreSnapshot(boxes: boxes.map(persistableBox), selectedBoxID: selectedBoxID)
            let data = try JSONEncoder().encode(snapshot)
            try data.write(to: storageURL, options: [.atomic])
        } catch {
            assertionFailure("Failed to save paired boxes: \(error)")
        }
        publishSharedBoxes()
    }

    private func publishSharedBoxes() {
        selectedBoxStore.persist(boxes: boxes, selectedBoxID: selectedBoxID)
    }

    private func persistableBox(_ box: PairedBox) -> PairedBox {
        let keychainHasToken = box.authToken.map { credentialStore.readToken(for: box.id) == $0 } ?? true
        return PairedBox(
            id: box.id,
            label: box.label,
            baseURL: box.baseURL,
            sessionID: box.sessionID,
            authToken: keychainHasToken ? nil : box.authToken,
            requiresDeviceUnlock: box.requiresDeviceUnlock
        )
    }

    private func migrateOrRestoreTokens() -> Bool {
        let hasLegacyToken = boxes.contains { $0.authToken != nil }
        let allLegacyTokensMigrated = boxes.enumerated().reduce(into: true) { allMigrated, item in
            let index = item.offset
            var box = item.element
            if let legacy = box.authToken {
                if allMigrated {
                    do {
                        try persistToken(legacy, for: box.id)
                    } catch {
                        allMigrated = false
                    }
                }
                box.authToken = legacy
            } else if let token = credentialStore.readToken(for: box.id) {
                box.authToken = token
            }
            boxes[index] = box
        }

        _ = credentialStore.purgeOrphanTokens(knownBoxIDs: Set(boxes.map(\.id)))
        guard hasLegacyToken, allLegacyTokensMigrated else {
            return false
        }
        // Once all legacy tokens verify in keychain, persist a token-free snapshot
        // so plaintext files drop over time.
        save()
        return true
    }

    private func persistToken(_ token: String, for boxID: UUID) throws {
        do {
            try credentialStore.writeToken(token, for: boxID)
            guard credentialStore.readToken(for: boxID) == token else {
                throw MissingTokenReadback.error
            }
        } catch {
            throw error
        }
    }

    private func deleteTokensFirst(for boxesToRemove: [PairedBox]) throws {
        var removed: [(UUID, String)] = []
        for box in boxesToRemove {
            let previousToken = box.authToken ?? credentialStore.readToken(for: box.id)
            do {
                try credentialStore.deleteToken(for: box.id)
            } catch {
                for (id, token) in removed.reversed() {
                    try persistToken(token, for: id)
                }
                throw error
            }
            if let token = previousToken {
                removed.append((box.id, token))
            }
        }
    }

    private func redeemPairing(baseURL: URL, pairingToken: String) async throws -> PairingRedeemResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/pairing/redeem"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("CallbackBox-iOS/0.1", forHTTPHeaderField: "User-Agent")
        request.httpBody = try JSONEncoder().encode(PairingRedeemRequest(
            pairingToken: pairingToken,
            deviceLabel: UIDevice.current.name
        ))
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.userAuthenticationRequired)
        }
        return try JSONDecoder().decode(PairingRedeemResponse.self, from: data)
    }

    private struct MissingTokenReadback: Swift.Error {
        static let error = MissingTokenReadback()
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private struct StoreSnapshot: Codable {
    var boxes: [PairedBox]
    var selectedBoxID: PairedBox.ID?
}

private struct PairingRedeemRequest: Encodable {
    var pairingToken: String
    var deviceLabel: String
}

private struct PairingRedeemResponse: Decodable {
    var token: String
}

extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

private extension Array where Element == URLQueryItem {
    func value(named name: String) -> String? {
        first { $0.name == name }?.value
    }
}
