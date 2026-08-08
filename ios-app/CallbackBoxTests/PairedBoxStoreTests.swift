import XCTest
@testable import CallbackBox

@MainActor
final class PairedBoxStoreTests: XCTestCase {
    func testLoadMigratesLegacyTokenToCredentialStoreAndPersistsTokenFreeSnapshot() throws {
        let files = FileManager.default.temporaryDirectory
            .appendingPathComponent("callback-box-ios-store-tests-\(UUID().uuidString)\(0)")
        try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
        let storage = files.appendingPathComponent("paired-boxes.json")

        let boxID = UUID()
        let payload = """
        {
          "boxes": [
            {
              "id": "\(boxID.uuidString)",
              "label": "Callback Box",
              "baseURL": "https://example.test",
              "sessionID": "main",
              "authToken": "legacy-token",
              "requiresDeviceUnlock": false
            }
          ],
          "selectedBoxID": "\(boxID.uuidString)"
        }
        """
        try Data(payload.utf8).write(to: storage)

        let credentialStore = FakeCredentialStore()
        let snapshotStore = FakeSelectedBoxSnapshotStore()
        _ = PairedBoxStore(
            storageURL: storage,
            credentialStore: credentialStore,
            selectedBoxStore: snapshotStore
        )

        XCTAssertEqual(credentialStore.tokens[boxID], "legacy-token")
        let raw = try String(contentsOf: storage)
        XCTAssertFalse(raw.contains("\"authToken\""), "Token should not be persisted in token-free metadata")
        XCTAssertEqual(snapshotStore.snapshot?.id, boxID)
    }

    func testLoadRestoresTokenFromCredentialStoreWhenSnapshotHasNoToken() throws {
        let files = FileManager.default.temporaryDirectory
            .appendingPathComponent("callback-box-ios-store-tests-\(UUID().uuidString)\(1)")
        try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
        let storage = files.appendingPathComponent("paired-boxes.json")

        let boxID = UUID()
        let box = PairedBox(
            id: boxID,
            label: "Callback Box",
            baseURL: URL(string: "https://example.test")!,
            sessionID: "main",
            authToken: nil,
            requiresDeviceUnlock: false
        )
        let snapshot = PersistedSnapshot(boxes: [box], selectedBoxID: boxID)
        try JSONEncoder().encode(snapshot).write(to: storage)

        let credentialStore = FakeCredentialStore()
        let snapshotStore = FakeSelectedBoxSnapshotStore()
        try credentialStore.writeToken("keychain-token", for: boxID)

        let store = PairedBoxStore(
            storageURL: storage,
            credentialStore: credentialStore,
            selectedBoxStore: snapshotStore
        )

        XCTAssertEqual(store.boxes.count, 1)
        XCTAssertEqual(store.boxes.first?.authToken, "keychain-token")
        XCTAssertEqual(snapshotStore.snapshot?.id, boxID)
    }

    func testFailedLegacyMigrationKeepsPlaintextFallbackAcrossLaterSave() throws {
        let files = FileManager.default.temporaryDirectory
            .appendingPathComponent("callback-box-ios-store-tests-\(UUID().uuidString)-fallback")
        try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
        let storage = files.appendingPathComponent("paired-boxes.json")
        let boxID = UUID()
        let box = PairedBox(
            id: boxID,
            label: "Callback Box",
            baseURL: URL(string: "https://example.test")!,
            sessionID: "main",
            authToken: "only-copy",
            requiresDeviceUnlock: false
        )
        try JSONEncoder().encode(PersistedSnapshot(boxes: [box], selectedBoxID: boxID)).write(to: storage)
        let credentialStore = FakeCredentialStore()
        credentialStore.failAllWrites = true
        let store = PairedBoxStore(
            storageURL: storage,
            credentialStore: credentialStore,
            selectedBoxStore: FakeSelectedBoxSnapshotStore()
        )

        store.select(try XCTUnwrap(store.boxes.first))

        let raw = try String(contentsOf: storage)
        XCTAssertTrue(raw.contains("\"authToken\""))
        XCTAssertTrue(raw.contains("only-copy"))
    }

    func testAddOrSelectReturnsFalseAndSkipsMetadataWhenTokenPersistenceFails() {
        let files = FileManager.default.temporaryDirectory
            .appendingPathComponent("callback-box-ios-store-tests-\(UUID().uuidString)\(2)")
        try! FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
        let storage = files.appendingPathComponent("paired-boxes.json")

        let credentialStore = FakeCredentialStore()
        let snapshotStore = FakeSelectedBoxSnapshotStore()
        credentialStore.failAllWrites = true
        let result = PairedBoxStore(
            storageURL: storage,
            credentialStore: credentialStore,
            selectedBoxStore: snapshotStore
        ).addOrSelectBox(
            label: "New Box",
            baseURL: URL(string: "https://example.test")!,
            sessionID: nil,
            authToken: "token"
        )

        XCTAssertFalse(result)
    }

    func testRemoveFailsClosedWhenTokenDeletionFails() throws {
        let files = FileManager.default.temporaryDirectory
            .appendingPathComponent("callback-box-ios-store-tests-\(UUID().uuidString)\(3)")
        try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
        let storage = files.appendingPathComponent("paired-boxes.json")

        let tokenID = UUID()
        let box = PairedBox(
            id: tokenID,
            label: "Callback Box",
            baseURL: URL(string: "https://example.test")!,
            sessionID: "main",
            authToken: "pair-token",
            requiresDeviceUnlock: false
        )
        let snapshot = PersistedSnapshot(boxes: [box], selectedBoxID: tokenID)
        try JSONEncoder().encode(snapshot).write(to: storage)

        let credentialStore = FakeCredentialStore()
        try credentialStore.writeToken("pair-token", for: tokenID)
        credentialStore.deleteFailIDs.insert(tokenID)
        let snapshotStore = FakeSelectedBoxSnapshotStore()
        let store = PairedBoxStore(
            storageURL: storage,
            credentialStore: credentialStore,
            selectedBoxStore: snapshotStore
        )

        store.remove(box)

        XCTAssertEqual(store.boxes.count, 1)
        XCTAssertEqual(store.boxes.first?.id, tokenID)
        let raw = try String(contentsOf: storage)
        XCTAssertFalse(raw.contains("\"authToken\""))
        XCTAssertEqual(snapshotStore.events.last, "persist:\(tokenID.uuidString)")
    }

    func testRemoveDeletesTokenBeforePersistingSnapshot() throws {
        let files = FileManager.default.temporaryDirectory
            .appendingPathComponent("callback-box-ios-store-tests-\(UUID().uuidString)\(4)")
        try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
        let storage = files.appendingPathComponent("paired-boxes.json")

        let tokenID = UUID()
        let box = PairedBox(
            id: tokenID,
            label: "Callback Box",
            baseURL: URL(string: "https://example.test")!,
            sessionID: "main",
            authToken: "pair-token",
            requiresDeviceUnlock: false
        )
        let snapshot = PersistedSnapshot(boxes: [box], selectedBoxID: tokenID)
        try JSONEncoder().encode(snapshot).write(to: storage)

        let credentialStore = FakeCredentialStore()
        try credentialStore.writeToken("pair-token", for: tokenID)
        let snapshotStore = FakeSelectedBoxSnapshotStore()
        snapshotStore.events.removeAll()
        let store = PairedBoxStore(
            storageURL: storage,
            credentialStore: credentialStore,
            selectedBoxStore: snapshotStore
        )
        snapshotStore.events.removeAll()
        credentialStore.events.removeAll()

        store.remove(box)

        XCTAssertNil(store.selectedBox)
        XCTAssertTrue(store.boxes.isEmpty)
        XCTAssertEqual(credentialStore.events.first, "delete-\(tokenID.uuidString)")
        XCTAssertEqual(snapshotStore.events.last, "persist:nil")
    }
}

private struct PersistedSnapshot: Codable {
    var boxes: [PairedBox]
    var selectedBoxID: UUID?
}

private final class FakeCredentialStore: PairedBoxCredentialStoreProtocol {
    enum Failure: Error {
        case writeFailed
        case deleteFailed
    }

    var tokens: [UUID: String] = [:]
    var writeFailIDs: Set<UUID> = []
    var deleteFailIDs: Set<UUID> = []
    var events: [String] = []
    var failAllWrites = false

    func readToken(for boxID: UUID) -> String? {
        tokens[boxID]
    }

    func writeToken(_ token: String, for boxID: UUID) throws {
        if failAllWrites || writeFailIDs.contains(boxID) {
            events.append("write-fail-\(boxID.uuidString)")
            throw Failure.writeFailed
        }
        tokens[boxID] = token
        events.append("write-\(boxID.uuidString)")
    }

    func deleteToken(for boxID: UUID) throws {
        if deleteFailIDs.contains(boxID) {
            events.append("delete-fail-\(boxID.uuidString)")
            throw Failure.deleteFailed
        }
        tokens[boxID] = nil
        events.append("delete-\(boxID.uuidString)")
    }

    func purgeOrphanTokens(knownBoxIDs: Set<UUID>) -> Int {
        return 0
    }
}

private final class FakeSelectedBoxSnapshotStore: SharedSelectedBoxSnapshotStoreProtocol {
    var snapshot: SharedSelectedBoxSnapshot?
    var events: [String] = []

    func read() -> SharedSelectedBoxSnapshot? {
        snapshot
    }

    func persist(_ selectedBox: PairedBox?) {
        if let selectedBox {
            snapshot = SharedSelectedBoxSnapshot(
                id: selectedBox.id,
                label: selectedBox.label,
                baseURL: selectedBox.baseURL,
                requiresDeviceUnlock: selectedBox.requiresDeviceUnlock
            )
            events.append("persist:\(selectedBox.id.uuidString)")
        } else {
            snapshot = nil
            events.append("persist:nil")
        }
    }
}
