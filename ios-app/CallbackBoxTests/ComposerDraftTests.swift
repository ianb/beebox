import XCTest
@testable import CallbackBox

final class ComposerDraftReducerTests: XCTestCase {
    func testUnicodeCaretInsertionUsesUTF16Offsets() {
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&draft, .setText("A 👩🏽‍💻 Z"))
        let emojiRange = (draft.text as NSString).range(of: "👩🏽‍💻")
        ComposerDraftReducer.reduce(
            &draft,
            .setSelection(NSRangeValue(location: NSMaxRange(emojiRange), length: 0))
        )
        ComposerDraftReducer.reduce(&draft, .addFile(DraftFile(
            id: 7,
            filename: "payload.pdf",
            originalName: "payload.pdf",
            size: 12,
            mimetype: "application/pdf",
            state: .local
        )))

        XCTAssertEqual(draft.text, "A 👩🏽‍💻 [file7] Z")
        XCTAssertEqual(draft.selection.location, ("A 👩🏽‍💻 [file7]" as NSString).length)
        XCTAssertEqual(draft.nextFileID, 8)
    }

    func testRemovingAnItemKeepsMonotonicIDsAndStripsOnlyItsToken() {
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&draft, .addImage(DraftImage(id: 2, filename: "a.jpg", mimeType: "image/jpeg", state: .local)))
        ComposerDraftReducer.reduce(&draft, .addImage(DraftImage(id: 5, filename: "b.jpg", mimeType: "image/jpeg", state: .local)))
        ComposerDraftReducer.reduce(&draft, .removeImage(2))

        XCTAssertEqual(draft.images.map(\.id), [5])
        XCTAssertFalse(draft.text.contains("[image2]"))
        XCTAssertTrue(draft.text.contains("[image5]"))
        XCTAssertEqual(draft.nextImageID, 6)
    }

    func testCaretInsideComposedEmojiFallsBackToEnd() {
        let text = "👩🏽‍💻 then"
        let emojiRange = (text as NSString).range(of: "👩🏽‍💻")
        let invalid = NSRangeValue(location: emojiRange.location + 1, length: 0)

        XCTAssertEqual(invalid.clamped(to: text), NSRange(location: (text as NSString).length, length: 0))
    }
}

final class ComposerDraftRepositoryTests: XCTestCase {
    private var rootURL: URL!

    override func setUpWithError() throws {
        rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: rootURL)
    }

    func testAtomicManifestReloadsForItsBox() async throws {
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&draft, .setText("durable text"))
        try await repository.save(draft, boxID: boxID)

        let restored = try await ComposerDraftRepository(rootURL: rootURL).load(boxID: boxID)
        XCTAssertEqual(restored, draft)
        let files = try FileManager.default.contentsOfDirectory(atPath: rootURL.appendingPathComponent(boxID.uuidString.lowercased()).path)
        XCTAssertEqual(files, ["manifest.json"])
    }

    func testCorruptManifestIsQuarantined() async throws {
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let manifestURL = await repository.manifestURL(boxID: boxID)
        try FileManager.default.createDirectory(at: manifestURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: manifestURL)

        await XCTAssertThrowsErrorAsync {
            _ = try await repository.load(boxID: boxID)
        }
        let files = try FileManager.default.contentsOfDirectory(atPath: manifestURL.deletingLastPathComponent().path)
        XCTAssertFalse(files.contains("manifest.json"))
        XCTAssertTrue(files.contains { $0.hasPrefix("manifest.corrupt-") })
    }

    @MainActor
    func testLegacyTextMigratesOnceAndBoxSwitchingRestoresIndependentDrafts() async throws {
        let suite = "ComposerDraftTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let firstBox = UUID()
        let secondBox = UUID()
        defaults.set("legacy text", forKey: "draft.\(firstBox.uuidString)")
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = ComposerDraftStore(repository: repository, defaults: defaults)

        await store.activate(boxID: firstBox)
        XCTAssertEqual(store.draft.text, "legacy text")
        XCTAssertNil(defaults.string(forKey: "draft.\(firstBox.uuidString)"))
        store.setText("first box")
        await store.flush()
        await store.activate(boxID: secondBox)
        XCTAssertEqual(store.draft.text, "")
        store.setText("second box")
        await store.flush()
        await store.activate(boxID: firstBox)
        XCTAssertEqual(store.draft.text, "first box")
    }
}

private func XCTAssertThrowsErrorAsync(
    _ expression: () async throws -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await expression()
        XCTFail("Expected expression to throw", file: file, line: line)
    } catch {
        // Expected.
    }
}
