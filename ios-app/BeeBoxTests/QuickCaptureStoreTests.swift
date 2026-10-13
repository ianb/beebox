import XCTest
@testable import BeeBox

final class QuickCaptureStoreTests: XCTestCase {
    private actor DiscardTransport: QuickCaptureTransport {
        var offline = true
        let id: UUID
        var requests: [String] = []
        init(id: UUID) { self.id = id }
        func setOffline(_ value: Bool) { offline = value }
        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            requests.append(request.url!.lastPathComponent)
            if offline { throw URLError(.notConnectedToInternet) }
            let value: [String: Any]
            if request.url!.lastPathComponent == "quickCapture.capabilities" {
                value = ["version": 1, "maxFileBytes": 50 * 1_024 * 1_024, "maxInputCharacters": 10_000,
                         "materialKinds": ["url", "clipping", "image", "audio"]]
            } else {
                value = ["id": id.uuidString.lowercased(), "state": "gone"]
            }
            let bytes = try JSONSerialization.data(withJSONObject: ["result": ["data": value]])
            return (bytes, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
    }
    private var root: URL!
    private var store: QuickCaptureStore!
    private var box: PairedBox!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        store = QuickCaptureStore(rootURL: root)
        box = PairedBox(id: UUID(), label: "Synthetic", baseURL: URL(string: "https://example.com/box")!,
                        sessionID: nil, authToken: "must-not-persist", requiresDeviceUnlock: false)
    }
    override func tearDownWithError() throws { if FileManager.default.fileExists(atPath: root.path) { try FileManager.default.removeItem(at: root) } }

    func testAcceptanceSurvivesNewStoreAndContainsNoCredential() throws {
        let record = try store.accept(box: box, source: .appIntents, input: "  A thought  ")
        let reopened = QuickCaptureStore(rootURL: root)
        XCTAssertEqual(try reopened.record(record.id)?.declaration.input, "A thought")
        let manifest = try String(contentsOf: store.directory(for: record.id).appendingPathComponent("manifest.json"), encoding: .utf8)
        XCTAssertFalse(manifest.contains("must-not-persist"))
        XCTAssertFalse(manifest.contains("authToken"))
    }
    func testCompleteCompositeAndIdenticalFileReplay() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        try Data([1,2,3,4]).write(to: file)
        let id = UUID()
        let material = QuickCaptureMaterial.file(kind: "image", mimeType: "image/png", fileName: "Screenshot.png")
        let original = try store.accept(box: box, source: .shareExtension, input: "Explain this", material: material, fileURL: file, id: id)
        XCTAssertEqual(original.declaration.material?.byteLength, 4)
        XCTAssertEqual(original.declaration.material?.sha256?.count, 64)
        XCTAssertEqual(try store.accept(box: box, source: .shareExtension, input: "Explain this", material: material, fileURL: file, id: id), original)
        XCTAssertThrowsError(try store.accept(box: box, source: .shareExtension, input: "Changed", material: material, fileURL: file, id: id))
        XCTAssertEqual(try store.records().count, 1)
    }
    func testIncompleteDoesNotPublishAndContextKeepsOriginalIdentity() throws {
        XCTAssertThrowsError(try store.accept(box: box, source: .shareExtension,
            material: .file(kind: "image", mimeType: "image/png", fileName: "missing.png")))
        XCTAssertEqual(try store.records().count, 0)
        let original = try store.accept(box: box, source: .appIntents, input: "Original")
        let context = try store.accept(box: box, source: .appIntents, input: "Context", parentCaptureID: original.id)
        XCTAssertEqual(context.declaration.parentCaptureId, original.id)
        XCTAssertEqual(context.boxID, original.boxID)
    }
    func testStatusUpdatesDoNotRewriteCanonicalSource() throws {
        let record = try store.accept(box: box, source: .appIntents, input: "Original")
        let manifest = store.directory(for: record.id).appendingPathComponent("manifest.json")
        let before = try Data(contentsOf: manifest)
        try store.updateStatus(record.id) { $0.state = "accepted"; $0.serverAccepted = true }
        XCTAssertEqual(try Data(contentsOf: manifest), before)
        XCTAssertTrue(try store.record(record.id)!.status.serverAccepted)
    }
    func testTwoStoreInstancesPublishWithoutLostRecords() throws {
        let other = QuickCaptureStore(rootURL: root)
        let a = try store.accept(box: box, source: .appIntents, input: "A")
        let b = try other.accept(box: box, source: .appIntents, input: "B")
        XCTAssertEqual(Set(try store.records().map(\.id)), Set([a.id,b.id]))
    }
    func testMultipartIncludesWordsAndDeclaredBytes() throws {
        let record = try store.accept(box: box, source: .appIntents, input: "Phone test")
        let coordinator = QuickCaptureUploadCoordinator(store: store)
        let body = try coordinator.buildBody(record: record, boundary: "TestBoundary")
        let text = try String(contentsOf: body, encoding: .utf8)
        XCTAssertTrue(text.contains("name=\"declaration\""))
        XCTAssertTrue(text.contains("Phone test"))
        XCTAssertTrue(text.hasSuffix("--TestBoundary--\r\n"))
    }
    func testSharedGoldenDeclarationsAndReceipt() throws {
        let fixtures = try MobileContractFixtures.load("quick-capture")
        for (name, fixture) in fixtures {
            let data = try MobileContractFixtures.jsonData(from: fixture)
            if name.hasPrefix("invalid-") {
                XCTAssertThrowsError(try QuickCaptureAPI.decodeDeclaration(data), name)
            } else if name == "receipt" {
                XCTAssertEqual(try QuickCaptureAPI.decodeReceipt(data).state, "accepted")
            } else {
                XCTAssertEqual(try QuickCaptureAPI.decodeDeclaration(data).version, 1, name)
            }
        }
    }

    func testConcurrentIndependentInstancesKeepEveryPublication() throws {
        let destination = root!
        let target = box!
        let lock = NSLock()
        var failures: [Error] = []
        DispatchQueue.concurrentPerform(iterations: 8) { index in
            do { _ = try QuickCaptureStore(rootURL: destination).accept(box: target, source: .appIntents, input: "Synthetic \(index)") }
            catch { lock.lock(); failures.append(error); lock.unlock() }
        }
        XCTAssertTrue(failures.isEmpty)
        XCTAssertEqual(try store.records().count, 8)
    }
    func testRecoveredDraftIsVisibleAndNeverAutomaticallySubmitted() async throws {
        let record = try store.accept(box: box, source: .appIntents, input: "Partial")
        try store.updateStatus(record.id) { $0.state = "interrupted-draft" }
        try FileManager.default.moveItem(at: store.directory(for: record.id), to: root.appendingPathComponent(".draft-synthetic"))
        let recovered = try XCTUnwrap(store.records().first)
        XCTAssertEqual(recovered.status.state, "interrupted-draft")
        try await QuickCaptureUploadCoordinator(store: store).schedule(record: recovered, box: box)
        XCTAssertEqual(try store.record(record.id)?.status.state, "interrupted-draft")
    }
    func testContextWaitsForLocalParentReceipt() async throws {
        let parent = try store.accept(box: box, source: .appIntents, input: "Original")
        let context = try store.accept(box: box, source: .nativeInput, input: "Later words", parentCaptureID: parent.id)
        try await QuickCaptureUploadCoordinator(store: store).schedule(record: context, box: box)
        XCTAssertEqual(try store.record(context.id)?.status.state, "waiting-for-original")
        XCTAssertFalse(try store.record(context.id)!.status.serverAccepted)
    }
    func testExpiredAutomaticRetryRetainsSource() async throws {
        var record = try store.accept(box: box, source: .appIntents, input: "Old source")
        record.createdAt = Date().addingTimeInterval(-8 * 24 * 60 * 60)
        try await QuickCaptureUploadCoordinator(store: store).schedule(record: record, box: box)
        XCTAssertEqual(try store.record(record.id)?.status.state, "needs-retry")
        XCTAssertEqual(try store.record(record.id)?.declaration.input, "Old source")
    }

    func testNewCaptureDoesNotReinterpretLegacyOutbox() throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let entry = QuickChatOutboxEntry(id: UUID(), boxID: box.id, text: "Legacy pending thought", origin: .external,
            source: "apple-app-intents", createdAt: Date(), attempts: 1, lastAttemptAt: nil)
        let bytes = try JSONEncoder().encode(QuickChatOutboxManifest(entries: [entry]))
        let legacy = root.appendingPathComponent("legacy-outbox.json")
        try bytes.write(to: legacy)
        _ = try store.accept(box: box, source: .appIntents, input: "New composite thought")
        XCTAssertEqual(try Data(contentsOf: legacy), bytes)
        XCTAssertEqual(try JSONDecoder().decode(QuickChatOutboxManifest.self, from: bytes).entries, [entry])
        XCTAssertEqual(try store.records().count, 1)
    }

    func testConfirmedDeletePurgesContentAndLateCallbackCannotRevive() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        try Data([1, 2, 3]).write(to: file)
        let source = try store.accept(box: box, source: .appIntents, input: "Delete this private source",
            material: .file(kind: "image", mimeType: "image/png", fileName: "private.png"), fileURL: file)
        let coordinator = QuickCaptureUploadCoordinator(store: store)
        _ = try coordinator.buildBody(record: source, boundary: "SyntheticBoundary")
        let unfinishedBody = store.directory(for: source.id).appendingPathComponent("request.multipart.interrupted")
        try Data("private multipart remainder".utf8).write(to: unfinishedBody)
        try store.updateStatus(source.id) { $0.serverAccepted = true; $0.state = "gone" }
        try store.purgeAcceptedSource(id: source.id)
        let tombstone = try XCTUnwrap(store.record(source.id))
        XCTAssertEqual(tombstone.status.state, "gone")
        XCTAssertNil(tombstone.declaration.input)
        XCTAssertNil(tombstone.declaration.material)
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.bodyURL(for: source.id).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.materialURL(for: source.id).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: unfinishedBody.path))
        try store.updateStatus(source.id) { $0.state = "accepted"; $0.error = "Late callback" }
        XCTAssertEqual(try store.record(source.id)?.status.state, "gone")
        XCTAssertNil(try store.record(source.id)?.status.error)
        XCTAssertThrowsError(try coordinator.buildBody(record: source, boundary: "SyntheticBoundary"))
        let context = try store.accept(box: box, source: .nativeInput, input: "Keep these follow-up words", parentCaptureID: source.id)
        try await coordinator.schedule(record: context, box: box)
        XCTAssertEqual(try store.record(context.id)?.status.state, "blocked")
        XCTAssertEqual(try store.record(context.id)?.declaration.input, "Keep these follow-up words")
    }
    func testPurgeRefusesUnconfirmedLocalSource() throws {
        let record = try store.accept(box: box, source: .appIntents, input: "Pending source")
        XCTAssertThrowsError(try store.purgeAcceptedSource(id: record.id))
        XCTAssertEqual(try store.record(record.id)?.declaration.input, "Pending source")
    }

    func testUnsentLocalDiscardLeavesContextBlockedWithItsWords() async throws {
        let parent = try store.accept(box: box, source: .appIntents, input: "Discard original")
        let context = try store.accept(box: box, source: .nativeInput, input: "Keep context", parentCaptureID: parent.id)
        try store.discard(parent.id)
        XCTAssertEqual(try store.record(parent.id)?.status.state, "gone")
        XCTAssertNil(try store.record(parent.id)?.declaration.input)
        try await QuickCaptureUploadCoordinator(store: store).schedule(record: context, box: box)
        XCTAssertEqual(try store.record(context.id)?.status.state, "blocked")
        XCTAssertEqual(try store.record(context.id)?.declaration.input, "Keep context")
    }

    func testOfflineDiscardRequestStopsReplayUntilConfirmedServerTombstone() async throws {
        let source = try store.accept(box: box, source: .appIntents, input: "Misheard private words")
        try store.updateStatus(source.id) { $0.attempts = 1 }
        let transport = DiscardTransport(id: source.id)
        let coordinator = QuickCaptureUploadCoordinator(store: store, transport: transport, cancelTransfersHandler: { _ in })
        try await coordinator.requestDiscard(record: source, box: box)
        XCTAssertEqual(try store.record(source.id)?.status.state, "discard-pending")
        XCTAssertEqual(try store.record(source.id)?.declaration.input, "Misheard private words")
        // A stale caller or a late accepted response cannot revive delivery.
        try await coordinator.schedule(record: source, box: box)
        try store.updateStatus(source.id) { $0.state = "accepted"; $0.serverAccepted = true }
        XCTAssertEqual(try store.record(source.id)?.status.state, "discard-pending")
        await transport.setOffline(false)
        await coordinator.recover(boxes: [box])
        XCTAssertEqual(try store.record(source.id)?.status.state, "gone")
        XCTAssertNil(try store.record(source.id)?.declaration.input)
    }
    func testAcceptedReceiptRemovesMultipartButKeepsPlayableOriginal() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        try Data([1, 2, 3]).write(to: file)
        let source = try store.accept(box: box, source: .voiceRecording,
            material: .file(kind: "audio", mimeType: "audio/mp4", fileName: "voice.m4a"), fileURL: file,
            recordingInterrupted: true)
        _ = try QuickCaptureUploadCoordinator(store: store).buildBody(record: source, boundary: "TestReceiptBoundary")
        try store.updateStatus(source.id) { $0.state = "accepted"; $0.serverAccepted = true }
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.bodyURL(for: source.id).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.materialURL(for: source.id).path))
        XCTAssertTrue(try XCTUnwrap(store.record(source.id)?.declaration.recordingInterrupted))
    }
    func testPartialRecordingMarkerCannotLabelUnrelatedInput() throws {
        XCTAssertThrowsError(try store.accept(box: box, source: .appIntents, input: "Text", recordingInterrupted: true))
        XCTAssertThrowsError(try store.accept(box: box, source: .voiceRecording, input: "Text", recordingInterrupted: false))
    }

    func testConfirmedForegroundReceiptSignalsDependentRecovery() async throws {
        let parent = try store.accept(box: box, source: .appIntents, input: "Original")
        let context = try store.accept(box: box, source: .nativeInput, input: "Later context", parentCaptureID: parent.id)
        let coordinator = QuickCaptureUploadCoordinator(store: store)
        try await coordinator.schedule(record: context, box: box)
        let recoveryCalled = expectation(description: "Foreground receipt advances dependent recovery")
        coordinator.setReceiptHandler { recoveryCalled.fulfill() }
        try coordinator.recordReceipt(QuickCaptureReceipt(id: parent.id, state: "accepted"))
        await fulfillment(of: [recoveryCalled], timeout: 2)
        XCTAssertTrue(try XCTUnwrap(store.record(parent.id)?.status.serverAccepted))
        XCTAssertEqual(try store.record(context.id)?.declaration.parentCaptureId, parent.id)
    }

    func testAutomaticRetryReservesFullBackgroundTransferLifetime() async throws {
        var record = try store.accept(box: box, source: .appIntents, input: "Near retry deadline")
        record.createdAt = Date().addingTimeInterval(-(QuickCaptureUploadCoordinator.automaticRetryWindow - QuickCaptureUploadCoordinator.maximumTransferDuration + 1))
        try await QuickCaptureUploadCoordinator(store: store).schedule(record: record, box: box)
        XCTAssertEqual(try store.record(record.id)?.status.state, "needs-retry")
        XCTAssertEqual(try store.record(record.id)?.declaration.input, "Near retry deadline")
    }

    func testProtectionUpgradeSurvivesPairingRemovalWithoutChangingDeclaration() throws {
        var requestedProtections: [URL: FileProtectionType] = [:]
        store = QuickCaptureStore(rootURL: root, protectionWriter: { url, protection in
            requestedProtections[url] = protection
            try FileManager.default.setAttributes([.protectionKey: protection], ofItemAtPath: url.path)
        })
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        try Data([1, 2, 3]).write(to: file)
        let source = try store.accept(box: box, source: .shareExtension,
            material: .file(kind: "image", mimeType: "image/png", fileName: "private.png"), fileURL: file)
        _ = try QuickCaptureUploadCoordinator(store: store).buildBody(record: source, boundary: "ProtectionBoundary")
        var protected = box!
        protected.requiresDeviceUnlock = true
        try store.preserveProtection(boxes: [protected])
        try store.preserveProtection(boxes: [])
        try store.preserveProtection(boxes: [box]) // Downgrades never erase local protection history.
        let reopened = try XCTUnwrap(QuickCaptureStore(rootURL: root).record(source.id))
        XCTAssertTrue(reopened.requiresDeviceUnlock)
        XCTAssertEqual(reopened.declaration, source.declaration)
        XCTAssertEqual(reopened.status, source.status)
        for url in [store.directory(for: source.id), store.directory(for: source.id).appendingPathComponent("manifest.json"),
                    store.directory(for: source.id).appendingPathComponent("status.json"), store.materialURL(for: source.id), store.bodyURL(for: source.id)] {
            // The installed simulator does not expose Data Protection attributes. Verify exact filesystem requests;
            // effective protection while locked remains a physical-device gate.
            XCTAssertEqual(requestedProtections[url], .complete)
        }
    }

    func testProtectionRefusalFlagPersistsEvenIfFileAttributeUpgradeFails() throws {
        let source = try store.accept(box: box, source: .appIntents, input: "Private orphan source")
        let failing = QuickCaptureStore(rootURL: root, protectionWriter: { _, _ in throw QuickCaptureStore.StoreError.unavailable })
        var protected = box!
        protected.requiresDeviceUnlock = true
        XCTAssertThrowsError(try failing.preserveProtection(boxes: [protected]))
        XCTAssertTrue(try XCTUnwrap(store.record(source.id)?.requiresDeviceUnlock))
        XCTAssertEqual(try store.record(source.id)?.declaration, source.declaration)
    }

    func testProtectionUpgradeIncludesUnrecoveredInterruptedDraft() throws {
        let source = try store.accept(box: box, source: .appIntents, input: "Interrupted private source")
        try store.updateStatus(source.id) { $0.state = "interrupted-draft" }
        try FileManager.default.moveItem(at: store.directory(for: source.id), to: root.appendingPathComponent(".draft-private"))
        var protected = box!
        protected.requiresDeviceUnlock = true
        try store.preserveProtection(boxes: [protected])
        let recovered = try XCTUnwrap(store.records().first)
        XCTAssertTrue(recovered.requiresDeviceUnlock)
        XCTAssertEqual(recovered.declaration, source.declaration)
        XCTAssertEqual(recovered.status.state, "interrupted-draft")
    }

}
