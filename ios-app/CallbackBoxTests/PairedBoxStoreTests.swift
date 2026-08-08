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
        XCTAssertEqual(snapshotStore.snapshot?.selectedBoxID, boxID)
        XCTAssertEqual(snapshotStore.snapshot?.boxes.map(\.id), [boxID])
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
        XCTAssertEqual(snapshotStore.snapshot?.selectedBoxID, boxID)
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

    func testSharedSnapshotPublishesEveryPairedBoxAndCurrentSelection() throws {
        let files = FileManager.default.temporaryDirectory
            .appendingPathComponent("callback-box-ios-store-tests-\(UUID().uuidString)-all-boxes")
        try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
        let credentialStore = FakeCredentialStore()
        let snapshotStore = FakeSelectedBoxSnapshotStore()
        let store = PairedBoxStore(
            storageURL: files.appendingPathComponent("paired-boxes.json"),
            credentialStore: credentialStore,
            selectedBoxStore: snapshotStore
        )
        XCTAssertTrue(store.addOrSelectBox(
            label: "Personal",
            baseURL: URL(string: "https://personal.example.test")!,
            sessionID: nil,
            authToken: "personal-token"
        ))
        XCTAssertTrue(store.addOrSelectBox(
            label: "Work",
            baseURL: URL(string: "https://work.example.test")!,
            sessionID: nil,
            authToken: "work-token"
        ))

        let personal = try XCTUnwrap(store.boxes.first { $0.label == "Personal" })
        store.select(personal)

        XCTAssertEqual(snapshotStore.snapshot?.boxes.map(\.label), ["Personal", "Work"])
        XCTAssertEqual(snapshotStore.snapshot?.selectedBoxID, personal.id)
    }

    func testSharedSnapshotStoreReadsLegacySelectedBoxSnapshot() throws {
        let suiteName = "callback-box-ios-shared-snapshot-tests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let boxID = UUID()
        let payload = """
        {
          "id": "\(boxID.uuidString)",
          "label": "Legacy Box",
          "baseURL": "https://legacy.example.test",
          "requiresDeviceUnlock": true
        }
        """
        defaults.set(Data(payload.utf8), forKey: SharedSelectedBoxStore.key)

        let snapshot = SharedSelectedBoxStore(defaults: defaults).read()

        XCTAssertEqual(snapshot?.selectedBoxID, boxID)
        XCTAssertEqual(snapshot?.boxes.count, 1)
        XCTAssertEqual(snapshot?.selectedBox?.label, "Legacy Box")
        XCTAssertEqual(snapshot?.selectedBox?.requiresDeviceUnlock, true)
    }

    func testSharedSnapshotStorePersistsAllBoxesWithoutTokens() throws {
        let suiteName = "callback-box-ios-shared-snapshot-tests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let personal = PairedBox(
            id: UUID(),
            label: "Personal",
            baseURL: URL(string: "https://personal.example.test")!,
            sessionID: "personal-chat",
            authToken: "personal-secret",
            requiresDeviceUnlock: false
        )
        let work = PairedBox(
            id: UUID(),
            label: "Work",
            baseURL: URL(string: "https://work.example.test")!,
            sessionID: "work-chat",
            authToken: "work-secret",
            requiresDeviceUnlock: true
        )
        let store = SharedSelectedBoxStore(defaults: defaults)

        store.persist(boxes: [personal, work], selectedBoxID: work.id)

        let raw = try XCTUnwrap(defaults.data(forKey: SharedSelectedBoxStore.key))
        let encoded = try XCTUnwrap(String(data: raw, encoding: .utf8))
        XCTAssertFalse(encoded.contains("secret"))
        XCTAssertFalse(encoded.contains("authToken"))
        XCTAssertFalse(encoded.contains("sessionID"))
        XCTAssertEqual(store.read()?.boxes.map(\.label), ["Personal", "Work"])
        XCTAssertEqual(store.read()?.selectedBoxID, work.id)
    }

    func testSharedSnapshotFallsBackToFirstBoxWhenSelectionIsStale() {
        let first = SharedPairedBoxMetadata(box: PairedBox(
            id: UUID(),
            label: "First",
            baseURL: URL(string: "https://first.example.test")!,
            sessionID: nil,
            authToken: nil,
            requiresDeviceUnlock: false
        ))
        let snapshot = SharedPairedBoxesSnapshot(boxes: [first], selectedBoxID: UUID())

        XCTAssertEqual(snapshot.selectedBox, first)
    }

    func testDestinationLoadTrackerRejectsEarlierLoadAfterSwitch() {
        var tracker = ShareDestinationLoadTracker()
        let firstLoad = tracker.begin()
        let secondLoad = tracker.begin()

        XCTAssertFalse(tracker.accepts(firstLoad))
        XCTAssertTrue(tracker.accepts(secondLoad))
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
    var snapshot: SharedPairedBoxesSnapshot?
    var events: [String] = []

    func read() -> SharedPairedBoxesSnapshot? {
        snapshot
    }

    func persist(boxes: [PairedBox], selectedBoxID: PairedBox.ID?) {
        if boxes.isEmpty == false {
            snapshot = SharedPairedBoxesSnapshot(
                boxes: boxes.map(SharedPairedBoxMetadata.init),
                selectedBoxID: selectedBoxID
            )
            events.append("persist:\(selectedBoxID?.uuidString ?? "nil")")
        } else {
            snapshot = nil
            events.append("persist:nil")
        }
    }
}
