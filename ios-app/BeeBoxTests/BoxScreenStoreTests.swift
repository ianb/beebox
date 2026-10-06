import XCTest
@testable import BeeBox

@MainActor
final class BoxScreenStoreTests: XCTestCase {
    /// Stands in for the quick chat procedures of one box.
    fileprivate final class FakeClient: QuickChatClient {
        var offline = false
        var submitAnswer: QuickChatView.State = .needsChoice
        var homeAnswer = QuickChatHome(open: [], recentlySent: [], recentChats: [], shortcuts: [])
        var homeFails = false
        var submitted: [(UUID, String)] = []
        var chosen: [String] = []
        /// Runs inside `home`, before it answers, so a test can land an answer
        /// while a refresh is in flight.
        var duringHome: (@MainActor () async -> Void)?

        func submit(id: UUID, message: String) async throws -> QuickChatView {
            submitted.append((id, message))
            if offline {
                throw URLError(.notConnectedToInternet)
            }
            return view(id: id, message: message, state: submitAnswer)
        }

        func choose(id: UUID, candidateId: String) async throws -> QuickChatView {
            chosen.append(candidateId)
            return view(id: id, message: "chosen", state: .sent)
        }

        func discard(id: UUID) async throws -> QuickChatView {
            view(id: id, message: "gone", state: .discarded)
        }

        func home() async throws -> QuickChatHome {
            await duringHome?()
            if homeFails {
                throw URLError(.timedOut)
            }
            return homeAnswer
        }
    }

    private var rootURL: URL!
    private let box = PairedBox(
        id: UUID(),
        label: "Test",
        baseURL: URL(string: "http://127.0.0.1:3210/main/test1")!,
        sessionID: nil,
        authToken: "secret",
        requiresDeviceUnlock: false
    )

    override func setUpWithError() throws {
        rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: rootURL)
    }

    private func makeStore(_ client: FakeClient) -> (BoxScreenStore, ComposerDraftRepository) {
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = BoxScreenStore(repository: repository, client: { _ in client })
        store.updateBoxes([box])
        return (store, repository)
    }

    func testSubmitThoughtIsOnDiskWhenItAnswersAndTheAnswerBecomesARow() async throws {
        let client = FakeClient()
        let (store, repository) = makeStore(client)
        await store.start()

        let stored = await store.submitThought("Call mom", boxID: box.id)

        XCTAssertTrue(stored)
        let onDisk = try await repository.loadQuickChatOutbox()
        XCTAssertEqual(onDisk.map(\.text), ["Call mom"])
        try await waitUntil { store.outbox.entries.isEmpty }
        XCTAssertEqual(client.submitted.map(\.1), ["Call mom"])
        guard case .record(let view) = store.needs(boxID: box.id).first else {
            return XCTFail("expected the needs-choice answer under Needs you")
        }
        XCTAssertEqual(view.state, .needsChoice)
        let remaining = try await repository.loadQuickChatOutbox()
        XCTAssertEqual(remaining, [])
    }

    func testAnOfflineSubmitStaysInTheOutboxAsAWaitingRow() async throws {
        let client = FakeClient()
        client.offline = true
        let (store, _) = makeStore(client)
        await store.start()

        _ = await store.submitThought("Ask Dana about the 14th", boxID: box.id)
        try await waitUntil { client.submitted.count == 1 && store.outbox.inFlight.isEmpty }

        guard case .outbox(let entry, .waiting) = store.needs(boxID: box.id).first else {
            return XCTFail("expected a waiting outbox row")
        }
        XCTAssertEqual(entry.text, "Ask Dana about the 14th")
    }

    func testOutboxRowsComeBeforeServerRowsAndSentAnswersAreSeparate() async throws {
        let client = FakeClient()
        let serverOpen = view(id: UUID(), message: "old", state: .needsChoice)
        client.homeAnswer.open = [serverOpen]
        client.submitAnswer = .sent
        let (store, _) = makeStore(client)
        await store.start()
        await store.refresh(boxID: box.id)

        _ = await store.submitThought("posted", boxID: box.id)
        try await waitUntil { store.outbox.entries.isEmpty }
        client.offline = true
        _ = await store.submitThought("waiting", boxID: box.id)
        try await waitUntil { store.outbox.inFlight.isEmpty && client.submitted.count == 2 }

        XCTAssertEqual(store.needs(boxID: box.id).map(\.id), [store.outbox.entries[0].id, serverOpen.id])
        XCTAssertEqual(store.sent(boxID: box.id).map(\.message), ["posted"])
    }

    func testChoosingMovesARecordFromNeedsToSent() async throws {
        let client = FakeClient()
        let open = view(id: UUID(), message: "Remind me", state: .needsChoice)
        client.homeAnswer.open = [open]
        let (store, _) = makeStore(client)
        await store.refresh(boxID: box.id)

        await store.choose(.init(candidateId: "c2", label: "Trip planning"), for: open, boxID: box.id)

        XCTAssertEqual(client.chosen, ["c2"])
        XCTAssertEqual(store.needs(boxID: box.id), [])
        XCTAssertEqual(store.sent(boxID: box.id).map(\.id), [open.id])
    }

    func testARefreshThatStartedBeforeAChoiceDoesNotBringTheRowBack() async throws {
        let client = FakeClient()
        let open = view(id: UUID(), message: "Remind me", state: .needsChoice)
        client.homeAnswer.open = [open]
        let (store, _) = makeStore(client)
        client.duringHome = {
            client.duringHome = nil
            await store.choose(.init(candidateId: "c2", label: "Trip planning"), for: open, boxID: self.box.id)
        }

        await store.refresh(boxID: box.id)

        XCTAssertEqual(store.needs(boxID: box.id), [])
        XCTAssertEqual(store.sent(boxID: box.id).map(\.id), [open.id])
    }

    func testRetryingANotDeliveredRecordResubmitsTheSameIdAndText() async {
        let client = FakeClient()
        client.submitAnswer = .sent
        let notDelivered = view(id: UUID(), message: "Order filters", state: .sending)
        client.homeAnswer.open = [notDelivered]
        let (store, _) = makeStore(client)
        await store.refresh(boxID: box.id)

        await store.retry(notDelivered, boxID: box.id)

        XCTAssertEqual(client.submitted.map(\.0), [notDelivered.id])
        XCTAssertEqual(client.submitted.map(\.1), ["Order filters"])
        XCTAssertEqual(store.sent(boxID: box.id).map(\.id), [notDelivered.id])
    }

    func testAFailedRefreshKeepsTheCachedHomeAndTheNextLaunchDrawsFromTheCache() async throws {
        let client = FakeClient()
        client.homeAnswer.recentChats = [
            .init(sessionId: "s1", label: "Trip planning", lastActivity: "t", landmark: .init(dir: "_content/travel", label: "Travel")),
        ]
        let (store, repository) = makeStore(client)
        await store.refresh(boxID: box.id)
        client.homeFails = true

        await store.refresh(boxID: box.id)

        XCTAssertEqual(store.refreshes[box.id], .failed)
        XCTAssertEqual(store.homes[box.id]?.recentChats.map(\.label), ["Trip planning"])

        let relaunched = BoxScreenStore(repository: repository, client: { _ in client })
        relaunched.updateBoxes([box])
        await relaunched.loadCachedHome(boxID: box.id)
        XCTAssertEqual(relaunched.homes[box.id]?.recentChats.map(\.label), ["Trip planning"])
    }

    func testRemovingABoxDropsItsOutboxEntries() async throws {
        let client = FakeClient()
        client.offline = true
        let (store, repository) = makeStore(client)
        await store.start()
        _ = await store.submitThought("for a box about to go", boxID: box.id)
        try await waitUntil { store.outbox.inFlight.isEmpty && client.submitted.count == 1 }

        store.updateBoxes([])
        try await waitUntil { store.outbox.entries.isEmpty }

        let remaining = try await repository.loadQuickChatOutbox()
        XCTAssertEqual(remaining, [])
    }

    func testShortcutAndChatPaths() {
        XCTAssertEqual(BoxScreenView.boxPath(fromShortcut: "/questions"), "questions")
        XCTAssertEqual(BoxScreenView.chatPath(sessionID: "abc-1"), "chat?session=abc-1")
        XCTAssertEqual(
            box.url(forBoxPath: BoxScreenView.chatPath(sessionID: "abc-1"))?.absoluteString,
            "http://127.0.0.1:3210/main/test1/chat?nativeComposer=1&session=abc-1"
        )
    }

    private func view(id: UUID, message: String, state: QuickChatView.State) -> QuickChatView {
        QuickChatView(id: id, message: message, createdAt: "2026-10-06T14:02:11.000Z", state: state)
    }

    private func waitUntil(_ condition: @MainActor () -> Bool) async throws {
        for _ in 0..<200 where condition() == false {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(condition(), "condition not reached")
    }
}

private extension BoxScreenStoreTests.FakeClient {
    func view(id: UUID, message: String, state: QuickChatView.State) -> QuickChatView {
        QuickChatView(id: id, message: message, createdAt: "2026-10-06T14:02:11.000Z", state: state)
    }
}
