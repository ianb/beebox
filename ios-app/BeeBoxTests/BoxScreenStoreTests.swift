import XCTest
@testable import BeeBox

@MainActor
final class BoxScreenStoreTests: XCTestCase {
    /// Stands in for the quick chat procedures of one box.
    fileprivate final class FakeClient: QuickChatClient {
        var offline = false
        var submitAnswer: QuickChatView.State = .needsChoice
        /// The destination of a `sending` or `sent` answer.
        var destination: QuickChatView.Destination?
        var lastError: String?
        var homeAnswer = QuickChatHome(open: [], recentlySent: [], recentChats: [], shortcuts: [])
        var homeFails = false
        var homeError: Error = URLError(.timedOut)
        var homeCalls = 0
        /// Thrown by the next calls of `home`, one each, before `homeFails` applies.
        var nextHomeErrors: [Error] = []
        var submitted: [(UUID, String)] = []
        var submittedOrigins: [QuickChatOrigin?] = []
        var submittedSources: [String?] = []
        var submittedHqServices: [String?] = []
        var chosen: [String] = []
        var retried: [UUID] = []
        /// What `retry` throws instead of answering, such as a box without it.
        var retryError: Error?
        /// Runs inside `home`, before it answers, so a test can land an answer
        /// while a refresh is in flight.
        var duringHome: (@MainActor () async -> Void)?
        /// Runs inside `submit`, before it answers, so a test can leave the
        /// box screen while the request is out.
        var duringSubmit: (@MainActor () async -> Void)?

        func submit(
            id: UUID,
            message: String,
            origin: QuickChatOrigin?,
            source: String? = nil,
            hqService: String? = nil
        ) async throws -> QuickChatView {
            submitted.append((id, message))
            submittedOrigins.append(origin)
            submittedSources.append(source)
            submittedHqServices.append(hqService)
            await duringSubmit?()
            if offline {
                throw URLError(.notConnectedToInternet)
            }
            var answer = view(id: id, message: message, state: submitAnswer)
            answer.destination = destination
            answer.lastError = lastError
            return answer
        }

        func choose(id: UUID, candidateId: String) async throws -> QuickChatView {
            chosen.append(candidateId)
            var answer = view(id: id, message: "chosen", state: .sent)
            answer.destination = destination
            return answer
        }

        func discard(id: UUID) async throws -> QuickChatView {
            view(id: id, message: "gone", state: .discarded)
        }

        func retry(id: UUID) async throws -> QuickChatView {
            retried.append(id)
            if let retryError {
                throw retryError
            }
            var answer = view(id: id, message: "", state: .sent)
            answer.destination = destination
            return answer
        }

        func home() async throws -> QuickChatHome {
            homeCalls += 1
            await duringHome?()
            if nextHomeErrors.isEmpty == false {
                throw nextHomeErrors.removeFirst()
            }
            if homeFails {
                throw homeError
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

    private func makeStore(
        _ client: FakeClient,
        retryDelays: [TimeInterval] = BoxScreenStore.homeRetryDelays,
        asleepRecheckDelay: TimeInterval = BoxScreenStore.asleepRecheckDelay
    ) -> (BoxScreenStore, ComposerDraftRepository) {
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = BoxScreenStore(repository: repository, retryDelays: retryDelays, asleepRecheckDelay: asleepRecheckDelay, client: { _ in client })
        store.updateBoxes([box])
        return (store, repository)
    }

    /// A dictated thought the phone ran HQ on keeps its engine on disk and
    /// sends it (docs/plans/ios-quick-chat-hq.md).
    func testHqThoughtCarriesItsEngineThroughTheOutbox() async throws {
        let client = FakeClient()
        let (store, repository) = makeStore(client)
        await store.start()

        _ = await store.submitThought("Call Odette", origin: .voice, boxID: box.id, hqService: "apple-speech-transcriber")

        let onDisk = try await repository.loadQuickChatOutbox()
        XCTAssertEqual(onDisk.map(\.hqService), ["apple-speech-transcriber"])
        try await waitUntil { store.outbox.entries.isEmpty }
        XCTAssertEqual(client.submittedHqServices, ["apple-speech-transcriber"])
    }

    func testSubmitThoughtIsOnDiskWhenItAnswersAndTheAnswerBecomesARow() async throws {
        let client = FakeClient()
        let (store, repository) = makeStore(client)
        await store.start()

        let stored = await store.submitThought("Call mom", origin: .voice, boxID: box.id)

        XCTAssertTrue(stored)
        let onDisk = try await repository.loadQuickChatOutbox()
        XCTAssertEqual(onDisk.map(\.text), ["Call mom"])
        try await waitUntil { store.outbox.entries.isEmpty }
        XCTAssertEqual(client.submitted.map(\.1), ["Call mom"])
        XCTAssertEqual(client.submittedOrigins, [.voice], "a dictated thought is submitted as voice")
        XCTAssertEqual(client.submittedHqServices, [nil], "a live dictated thought names no HQ engine")
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

        _ = await store.submitThought("Ask Dana about the 14th", origin: .typed, boxID: box.id)
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

        _ = await store.submitThought("posted", origin: .typed, boxID: box.id)
        try await waitUntil { store.outbox.entries.isEmpty }
        client.offline = true
        _ = await store.submitThought("waiting", origin: .typed, boxID: box.id)
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

    func testRetryingANotDeliveredRecordCallsRetryWithItsId() async {
        let client = FakeClient()
        var pageOnly = view(id: UUID(), message: "", state: .sending)
        pageOnly.page = .init(title: "Cedar raised bed kits", url: "https://example.com/garden/cedar-beds")
        client.homeAnswer.open = [pageOnly]
        let (store, _) = makeStore(client)
        await store.refresh(boxID: box.id)

        await store.retry(pageOnly, boxID: box.id)

        XCTAssertEqual(client.retried, [pageOnly.id])
        XCTAssertTrue(client.submitted.isEmpty)
        XCTAssertNil(store.actionErrors[pageOnly.id])
        XCTAssertEqual(store.sent(boxID: box.id).map(\.id), [pageOnly.id])
    }

    /// A box from before `quickChat.retry` answers 404 for the procedure.
    func testRetryOnABoxWithoutRetryResubmitsTheSameIdAndText() async {
        let client = FakeClient()
        client.submitAnswer = .sent
        client.retryError = QuickChatAPI.APIError.server(status: 404, message: #"No procedure found on path "quickChat.retry""#)
        let notDelivered = view(id: UUID(), message: "Order filters", state: .sending)
        client.homeAnswer.open = [notDelivered]
        let (store, _) = makeStore(client)
        await store.refresh(boxID: box.id)

        await store.retry(notDelivered, boxID: box.id)

        XCTAssertEqual(client.retried, [notDelivered.id])
        XCTAssertEqual(client.submitted.map(\.0), [notDelivered.id])
        XCTAssertEqual(client.submitted.map(\.1), ["Order filters"])
        XCTAssertEqual(client.submittedOrigins, [nil], "a retry keeps the origin the server stored")
        XCTAssertEqual(store.sent(boxID: box.id).map(\.id), [notDelivered.id])
    }

    func testRetryDoesNotResubmitAnEmptyMessageOrAMissingRecord() async {
        let client = FakeClient()
        let pageOnly = view(id: UUID(), message: "", state: .sending)
        let missing = view(id: UUID(), message: "Order filters", state: .sending)
        client.homeAnswer.open = [pageOnly, missing]
        let (store, _) = makeStore(client)
        await store.refresh(boxID: box.id)

        client.retryError = QuickChatAPI.APIError.server(status: 404, message: #"No procedure found on path "quickChat.retry""#)
        await store.retry(pageOnly, boxID: box.id)
        client.retryError = QuickChatAPI.APIError.server(status: 404, message: "Quick chat message not found.")
        await store.retry(missing, boxID: box.id)

        XCTAssertTrue(client.submitted.isEmpty)
        XCTAssertNotNil(store.actionErrors[pageOnly.id])
        XCTAssertEqual(store.actionErrors[missing.id], "Quick chat message not found.")
    }

    func testAFailedRefreshKeepsTheCachedHomeAndTheNextLaunchDrawsFromTheCache() async throws {
        let client = FakeClient()
        client.homeAnswer.recentChats = [
            .init(sessionId: "s0", label: "Plan the week", lastActivity: "t", landmark: nil),
            .init(sessionId: "s1", label: "Trip planning", lastActivity: "t", landmark: .init(dir: "_content/travel", label: "Travel")),
        ]
        let (store, repository) = makeStore(client)
        await store.refresh(boxID: box.id)
        client.homeFails = true

        await store.refresh(boxID: box.id)

        XCTAssertEqual(store.refreshes[box.id], .failed(.unreachable))
        XCTAssertEqual(store.homes[box.id]?.recentChats.map(\.label), ["Plan the week", "Trip planning"])

        let relaunched = BoxScreenStore(repository: repository, client: { _ in client })
        relaunched.updateBoxes([box])
        await relaunched.loadCachedHome(boxID: box.id)
        XCTAssertEqual(relaunched.homes[box.id]?.recentChats.map(\.label), ["Plan the week", "Trip planning"])
        XCTAssertNil(relaunched.homes[box.id]?.recentChats.first?.landmark)
        // The cache is not the box's answer: it carries its age and is not confirmed.
        let savedAt = try XCTUnwrap(relaunched.homeDates[box.id])
        XCTAssertLessThan(abs(savedAt.timeIntervalSinceNow), 60)
        XCTAssertFalse(relaunched.confirmedBoxIDs.contains(box.id))
    }

    /// The reported bug: the box screen kept a list from before the app went
    /// to the background, because only a launch or box switch refreshed it.
    func testAReturnToTheForegroundRechecksTheShownBox() async throws {
        let client = FakeClient()
        let (store, _) = makeStore(client)
        store.setForeground(true)
        store.setShownBox(box.id)
        try await waitUntil { store.confirmedBoxIDs.contains(self.box.id) }
        XCTAssertEqual(client.homeCalls, 1)

        // Showing again in the same stay does not ask again.
        store.setShownBox(nil)
        store.setShownBox(box.id)
        store.setForeground(true)
        await Task.yield()
        XCTAssertEqual(client.homeCalls, 1)

        store.setForeground(false)
        XCTAssertFalse(store.confirmedBoxIDs.contains(box.id))
        client.homeAnswer.recentChats = [.init(sessionId: "s9", label: "Fix the bike", lastActivity: "t", landmark: nil)]
        store.setForeground(true)
        try await waitUntil { store.confirmedBoxIDs.contains(self.box.id) }
        XCTAssertEqual(client.homeCalls, 2)
        XCTAssertEqual(store.homes[box.id]?.recentChats.map(\.label), ["Fix the bike"])
    }

    func testAnAnswerFromBeforeTheBackgroundDoesNotConfirm() async {
        let client = FakeClient()
        let (store, _) = makeStore(client)
        store.setForeground(true)
        client.duringHome = { store.setForeground(false) }

        await store.refresh(boxID: box.id)

        XCTAssertNotNil(store.homes[box.id])
        XCTAssertEqual(store.refreshes[box.id], .idle)
        XCTAssertFalse(store.confirmedBoxIDs.contains(box.id))
    }

    func testAFailedRefreshSaysWhyAndRetriesUntilTheBoxAnswers() async throws {
        let client = FakeClient()
        client.homeFails = true
        client.homeError = QuickChatAPI.APIError.closed(reason: "docs refresh")
        let (store, _) = makeStore(client, retryDelays: [0.01])
        store.setForeground(true)
        store.setShownBox(box.id)
        try await waitUntil { store.refreshes[self.box.id] == .failed(.closed(reason: "docs refresh")) }

        client.homeFails = false
        try await waitUntil { store.confirmedBoxIDs.contains(self.box.id) }
        XCTAssertEqual(store.refreshes[box.id], .idle)
        XCTAssertGreaterThanOrEqual(client.homeCalls, 2)
    }

    func testRetriesStopInTheBackgroundAndOffTheBoxScreen() async throws {
        let client = FakeClient()
        client.homeFails = true
        let (store, _) = makeStore(client, retryDelays: [0.05])
        store.setForeground(true)
        store.setShownBox(box.id)
        try await waitUntil { store.refreshes[self.box.id] == .failed(.unreachable) }
        store.setForeground(false)
        let calls = client.homeCalls
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(client.homeCalls, calls)

        store.setForeground(true)
        try await waitUntil { client.homeCalls > calls }
        store.setShownBox(nil)
        let shownCalls = client.homeCalls
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(client.homeCalls, shownCalls)
    }

    /// The hub answers for a sleeping box with its last list (contract §5.11):
    /// current, dated from when the box went to sleep, and asked again while
    /// shown so the live list replaces it once the box wakes.
    func testAnAsleepAnswerIsCurrentAndIsAskedAgainUntilTheBoxWakes() async throws {
        let client = FakeClient()
        client.homeAnswer.recentChats = [.init(sessionId: "s9", label: "Fix the bike", lastActivity: "t", landmark: nil)]
        client.homeAnswer.asleep = .init(savedAt: "2026-10-26T15:12:00.000Z")
        let (store, repository) = makeStore(client, asleepRecheckDelay: 0.01)
        store.setForeground(true)
        store.setShownBox(box.id)
        try await waitUntil { store.confirmedBoxIDs.contains(self.box.id) }
        XCTAssertEqual(store.homeDates[box.id], Date(timeIntervalSince1970: 1_793_027_520))

        // A relaunch draws the cached snapshot with its own age, not the file's.
        let relaunched = BoxScreenStore(repository: repository, client: { _ in client })
        relaunched.updateBoxes([box])
        await relaunched.loadCachedHome(boxID: box.id)
        XCTAssertEqual(relaunched.homeDates[box.id], Date(timeIntervalSince1970: 1_793_027_520))

        client.homeAnswer.asleep = nil
        try await waitUntil { store.homes[self.box.id]?.asleep == nil }
        let calls = client.homeCalls
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(client.homeCalls, calls, "a live answer is not asked again")
    }

    /// Opening a chat and coming back to the same box screen cancels the
    /// sleeping box's check; showing the screen again re-arms it.
    func testShowingASleepingBoxAgainResumesItsCheck() async throws {
        let client = FakeClient()
        client.homeAnswer.asleep = .init(savedAt: "2026-10-26T15:12:00.000Z")
        let (store, _) = makeStore(client, asleepRecheckDelay: 0.05)
        store.setForeground(true)
        store.setShownBox(box.id)
        try await waitUntil { store.confirmedBoxIDs.contains(self.box.id) }
        store.setShownBox(nil)
        client.homeAnswer.asleep = nil
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertNotNil(store.homes[box.id]?.asleep, "no check while the screen is not shown")

        store.setShownBox(box.id)
        try await waitUntil { store.homes[self.box.id]?.asleep == nil }
    }

    /// A failed check of a sleeping box says so, rather than keeping its
    /// earlier answer styled as current.
    func testAFailedCheckUnconfirmsTheHome() async throws {
        let client = FakeClient()
        client.homeAnswer.asleep = .init(savedAt: "2026-10-26T15:12:00.000Z")
        let (store, _) = makeStore(client, retryDelays: [10], asleepRecheckDelay: 0.01)
        store.setForeground(true)
        store.setShownBox(box.id)
        try await waitUntil { store.confirmedBoxIDs.contains(self.box.id) }
        client.homeFails = true
        try await waitUntil { store.refreshes[self.box.id] == .failed(.unreachable) }
        XCTAssertFalse(store.confirmedBoxIDs.contains(box.id))
    }

    /// Switching away and back while a refresh runs finds it still running;
    /// when it then ends cancelled, the shown box asks again.
    func testACancelledRefreshOfAShownBoxIsReplaced() async throws {
        let client = FakeClient()
        let (store, _) = makeStore(client)
        store.setForeground(true)
        client.nextHomeErrors = [URLError(.cancelled)]
        client.duringHome = {
            client.duringHome = nil
            store.setShownBox(nil)
            store.setShownBox(self.box.id)
        }
        await store.refresh(boxID: box.id)
        try await waitUntil { store.confirmedBoxIDs.contains(self.box.id) }
        XCTAssertEqual(client.homeCalls, 2)
    }

    /// Cancellations one after another do not ask again at once each time.
    func testRepeatedCancellationsWaitOnTheBackoff() async throws {
        let client = FakeClient()
        let (store, _) = makeStore(client, retryDelays: [10])
        store.setForeground(true)
        client.nextHomeErrors = [URLError(.cancelled), URLError(.cancelled), URLError(.cancelled)]
        store.setShownBox(box.id)
        try await waitUntil { client.homeCalls == 2 }
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(client.homeCalls, 2)
    }

    func testRefreshFailureKinds() {
        XCTAssertEqual(BoxScreenStore.RefreshFailure(URLError(.cannotConnectToHost)), .unreachable)
        XCTAssertEqual(BoxScreenStore.RefreshFailure(QuickChatAPI.APIError.notOpen), .notOpen)
        XCTAssertEqual(BoxScreenStore.RefreshFailure(QuickChatAPI.APIError.closed(reason: nil)), .closed(reason: nil))
        XCTAssertEqual(BoxScreenStore.RefreshFailure(QuickChatAPI.APIError.server(status: 500, message: "x")), .other)
    }

    func testRemovingABoxDropsItsOutboxEntries() async throws {
        let client = FakeClient()
        client.offline = true
        let (store, repository) = makeStore(client)
        await store.start()
        _ = await store.submitThought("for a box about to go", origin: .typed, boxID: box.id)
        try await waitUntil { store.outbox.inFlight.isEmpty && client.submitted.count == 1 }

        store.updateBoxes([])
        try await waitUntil { store.outbox.entries.isEmpty }

        let remaining = try await repository.loadQuickChatOutbox()
        XCTAssertEqual(remaining, [])
    }

    // MARK: After the person's own send or choose

    func testASentAnswerToThePersonsSendOpensItsChat() async throws {
        let client = FakeClient()
        client.submitAnswer = .sent
        client.destination = .init(label: "Trip planning", sessionId: "s1")
        let (store, _) = makeStore(client)
        await store.start()
        store.setShownBox(box.id)

        _ = await store.submitThought("Check the lumber order", origin: .typed, boxID: box.id)
        try await waitUntil { store.followUp != nil }

        let request = try XCTUnwrap(store.followUp)
        XCTAssertEqual(request.boxID, box.id)
        XCTAssertEqual(request.followUp, .openChat(sessionID: "s1"))
        XCTAssertEqual(store.sent(boxID: box.id).map(\.message), ["Check the lumber order"])
        store.consumeFollowUp(request)
        XCTAssertNil(store.followUp)
    }

    func testAChoiceThatPostsOpensItsChat() async throws {
        let client = FakeClient()
        client.destination = .init(label: "Trip planning", sessionId: "s2")
        let open = view(id: UUID(), message: "Remind me", state: .needsChoice)
        client.homeAnswer.open = [open]
        let (store, _) = makeStore(client)
        await store.refresh(boxID: box.id)
        XCTAssertNil(store.followUp, "rows from home follow up nothing")
        store.setShownBox(box.id)

        await store.choose(.init(candidateId: "c2", label: "Trip planning"), for: open, boxID: box.id)

        XCTAssertEqual(store.followUp?.followUp, .openChat(sessionID: "s2"))
    }

    /// With no chat to open, the box screen stays and brings the row into
    /// view with its status line.
    func testAnswersWithNoChatToOpenRevealTheirRow() async throws {
        let cases: [(QuickChatView.State, QuickChatView.Destination?, String?, String)] = [
            (.sent, .init(label: "New general chat"), nil, "Sent to New general chat"),
            (.needsChoice, nil, nil, "Not sure where this goes"),
            (.sending, .init(label: "Trip planning", sessionId: "s1"), "Chat is not running", "Not delivered"),
        ]
        for (state, destination, lastError, status) in cases {
            let client = FakeClient()
            client.submitAnswer = state
            client.destination = destination
            client.lastError = lastError
            let (store, _) = makeStore(client)
            await store.start()
            store.setShownBox(box.id)

            _ = await store.submitThought("A thought", origin: .typed, boxID: box.id)
            try await waitUntil { store.followUp != nil }

            let id = try XCTUnwrap(client.submitted.first?.0)
            XCTAssertEqual(store.followUp?.followUp, .reveal(rowID: id, status: status), "\(state)")
        }
    }

    func testAnOfflineSendRevealsItsWaitingRowAndALaterRetryOpensNothing() async throws {
        let client = FakeClient()
        client.offline = true
        let (store, _) = makeStore(client)
        await store.start()
        store.setShownBox(box.id)

        _ = await store.submitThought("Ask Dana about the 14th", origin: .typed, boxID: box.id)
        try await waitUntil { store.followUp != nil }

        let entry = try XCTUnwrap(store.outbox.entries.first)
        let request = try XCTUnwrap(store.followUp)
        XCTAssertEqual(request.followUp, .reveal(rowID: entry.id, status: "Waiting to send"))
        store.consumeFollowUp(request)

        // The backoff retry succeeds later, into a chat: the list updates, and
        // the screen stays where the person is.
        client.offline = false
        client.submitAnswer = .sent
        client.destination = .init(label: "Trip planning", sessionId: "s1")
        await store.outbox.retry(id: entry.id)

        XCTAssertEqual(store.sent(boxID: box.id).map(\.id), [entry.id])
        XCTAssertNil(store.followUp)
    }

    func testThePersonsRetryOfAWaitingRowFollowsUp() async throws {
        let client = FakeClient()
        client.offline = true
        let (store, _) = makeStore(client)
        await store.start()
        store.setShownBox(box.id)
        _ = await store.submitThought("Ask Dana about the 14th", origin: .typed, boxID: box.id)
        // The reveal is published before the failed attempt is saved and
        // leaves `inFlight`; a retry before then is ignored. The row shows
        // "Sending" with no Retry button for that window.
        try await waitUntil { store.followUp != nil && store.outbox.inFlight.isEmpty }
        store.consumeFollowUp(try XCTUnwrap(store.followUp))
        let entry = try XCTUnwrap(store.outbox.entries.first)

        client.offline = false
        client.submitAnswer = .sent
        client.destination = .init(label: "Trip planning", sessionId: "s1")
        await store.retryOutboxEntry(id: entry.id, boxID: box.id)

        XCTAssertEqual(store.followUp?.followUp, .openChat(sessionID: "s1"))
    }

    func testALaunchRetryOnlyUpdatesTheRows() async throws {
        let client = FakeClient()
        client.offline = true
        let (store, repository) = makeStore(client)
        await store.start()
        _ = await store.submitThought("Stored before the app closed", origin: .typed, boxID: box.id)
        try await waitUntil { client.submitted.count == 1 && store.outbox.inFlight.isEmpty }

        client.offline = false
        client.submitAnswer = .sent
        client.destination = .init(label: "Trip planning", sessionId: "s1")
        let relaunched = BoxScreenStore(repository: repository, client: { _ in client })
        relaunched.updateBoxes([box])
        relaunched.setShownBox(box.id)
        await relaunched.start()

        XCTAssertEqual(relaunched.sent(boxID: box.id).map(\.message), ["Stored before the app closed"])
        XCTAssertNil(relaunched.followUp)
    }

    func testAnAnswerAfterLeavingSwitchingBoxesOrBackgroundingOnlyUpdatesTheRows() async throws {
        let otherBoxID = UUID()
        let leaves: [(String, @MainActor (BoxScreenStore) -> Void)] = [
            ("left the box screen", { $0.setShownBox(nil) }),
            ("switched boxes", { $0.setShownBox(otherBoxID) }),
            ("went to the background", { $0.setForeground(false) }),
        ]
        for (name, leave) in leaves {
            let client = FakeClient()
            client.submitAnswer = .sent
            client.destination = .init(label: "Trip planning", sessionId: "s1")
            let (store, _) = makeStore(client)
            await store.start()
            store.setShownBox(box.id)
            client.duringSubmit = { leave(store) }

            _ = await store.submitThought("A thought", origin: .typed, boxID: box.id)
            // The id leaves `inFlight` only after the emptied outbox is saved;
            // the next iteration's store loads the same directory.
            try await waitUntil { store.outbox.entries.isEmpty && store.outbox.inFlight.isEmpty }

            XCTAssertEqual(store.sent(boxID: box.id).map(\.message), ["A thought"], name)
            XCTAssertNil(store.followUp, name)
        }
    }

    func testADiscardFollowsUpNothing() async {
        let client = FakeClient()
        let open = view(id: UUID(), message: "Remind me", state: .needsChoice)
        client.homeAnswer.open = [open]
        let (store, _) = makeStore(client)
        await store.refresh(boxID: box.id)
        store.setShownBox(box.id)

        await store.discard(open, boxID: box.id)

        XCTAssertEqual(store.needs(boxID: box.id), [])
        XCTAssertNil(store.followUp)
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
