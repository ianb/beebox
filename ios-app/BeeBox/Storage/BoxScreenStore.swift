import Combine
import Foundation

/// The quick chat procedures the box screen calls. `QuickChatAPI` is the real
/// one; the DEBUG fixture screen supplies a fake.
protocol QuickChatClient {
    func submit(id: UUID, message: String, origin: QuickChatOrigin?, source: String?) async throws -> QuickChatView
    func choose(id: UUID, candidateId: String) async throws -> QuickChatView
    func discard(id: UUID) async throws -> QuickChatView
    func home() async throws -> QuickChatHome
}

extension QuickChatAPI: QuickChatClient {}

/// One row under "Needs you".
enum BoxScreenNeed: Identifiable, Equatable {
    /// Not yet accepted by the server.
    case outbox(QuickChatOutboxEntry, QuickChatOutbox.Status)
    /// A stored message in `needs-choice` or `sending`.
    case record(QuickChatView)

    var id: UUID {
        switch self {
        case .outbox(let entry, _):
            entry.id
        case .record(let view):
            view.id
        }
    }
}

/// What the box screen does with the answer to a send or choose the person
/// just made there.
enum BoxScreenFollowUp: Equatable {
    /// The thought is posted to a chat: open it. It is already stored and
    /// posted, so a slow chat loses nothing.
    case openChat(sessionID: String)
    /// Stay, bring the row into view, and announce its status line.
    case reveal(rowID: UUID, status: String)

    static func after(_ view: QuickChatView) -> BoxScreenFollowUp? {
        switch view.state {
        case .sent:
            if let sessionID = view.destination?.sessionId {
                return .openChat(sessionID: sessionID)
            }
            return .reveal(rowID: view.id, status: view.statusLine)
        case .needsChoice, .sending:
            return .reveal(rowID: view.id, status: view.statusLine)
        case .discarded:
            return nil
        }
    }
}

/// One follow-up for the box screen of `boxID`. The serial tells two equal
/// follow-ups apart, so each is carried out once.
struct BoxScreenFollowUpRequest: Equatable {
    var serial: Int
    var boxID: UUID
    var followUp: BoxScreenFollowUp
}

extension QuickChatView {
    /// The row's status line, as the box screen shows and announces it.
    var statusLine: String {
        switch state {
        case .sent:
            "\(queued == true ? "Queued in" : "Sent to") \(destination?.label ?? "a chat")"
        case .needsChoice:
            switch reason {
            case .uncertain, nil:
                "Not sure where this goes"
            case .routingUnavailable:
                "Could not sort this"
            case .destinationGone:
                "That chat is gone"
            }
        case .sending where expired == true:
            lastError ?? "This may already be in \(destination?.label ?? "the chat"). Open the chat to check."
        case .sending:
            "Not delivered"
        case .discarded:
            "Discarded"
        }
    }
}

/// What the box screen shows for each paired box: the outbox, the last `home`
/// answer (cached on disk so the screen draws at once on the next launch), and
/// the server's answers to this app session's submissions.
///
/// The store also decides which answers the person is waiting for: their own
/// send, choose, or Retry, made on the box screen that is showing. Only those
/// set `followUp`. Outbox retries on the backoff or at launch, rows from the
/// `home` refresh, and anything that answers after the person left the box
/// screen, switched boxes, or put the app in the background only update the
/// rows.
@MainActor
final class BoxScreenStore: ObservableObject {
    enum ExternalCaptureResult {
        case persistenceFailed
        case submitted(QuickChatView)
        case savedLocally
    }
    enum Refresh: Equatable {
        case idle
        case refreshing
        case failed
    }

    enum StoreError: LocalizedError {
        case boxNotPaired

        var errorDescription: String? {
            "This box is no longer paired."
        }
    }

    /// One server answer from this app session, with the order it arrived in.
    private struct Answer {
        var view: QuickChatView
        var serial: Int
    }

    let outbox: QuickChatOutbox
    @Published private(set) var homes: [UUID: QuickChatHome] = [:]
    @Published private(set) var refreshes: [UUID: Refresh] = [:]
    /// Records with a choose, discard, or retry in flight.
    @Published private(set) var busyIDs: Set<UUID> = []
    /// The last failed choose, discard, or retry, by record id.
    @Published private(set) var actionErrors: [UUID: String] = [:]
    @Published private var answers: [UUID: [Answer]] = [:]
    /// The next thing the showing box screen should do; it calls
    /// `consumeFollowUp` once done.
    @Published private(set) var followUp: BoxScreenFollowUpRequest?

    private let repository: ComposerDraftRepository
    private let client: (PairedBox) -> any QuickChatClient
    private var boxes: [PairedBox] = []
    private var answerSerial = 0
    private var foreground = false
    private var retryTask: Task<Void, Never>?
    /// The box whose box screen is showing, if any.
    private var shownBoxID: UUID?
    /// Row ids whose answer the person is waiting for, with their box.
    private var awaiting: [UUID: UUID] = [:]
    private var followUpSerial = 0

    init(
        repository: ComposerDraftRepository = ComposerDraftRepository(),
        now: @escaping () -> Date = Date.init,
        client: @escaping (PairedBox) -> any QuickChatClient = { QuickChatAPI(box: $0) }
    ) {
        self.repository = repository
        self.client = client
        let relay = SubmitRelay()
        outbox = QuickChatOutbox(repository: repository, now: now) { entry in
            try await relay.submit(entry)
        }
        relay.store = self
    }

    // MARK: Lifecycle

    func updateBoxes(_ boxes: [PairedBox]) {
        let removed = Set(self.boxes.map(\.id)).subtracting(boxes.map(\.id))
        self.boxes = boxes
        for boxID in removed {
            homes[boxID] = nil
            refreshes[boxID] = nil
            answers[boxID] = nil
        }
        guard outbox.isLoaded, removed.isEmpty == false else {
            return
        }
        let paired = Set(boxes.map(\.id))
        Task {
            await outbox.forgetBoxes(except: paired)
        }
    }

    /// Restore the outbox and make its launch attempts. Call after
    /// `updateBoxes`, so each entry can find its box.
    func start() async {
        await outbox.load()
        await outbox.forgetBoxes(except: Set(boxes.map(\.id)))
        resumeRetries()
    }

    /// Capture one external thought through the same durable outbox as the box
    /// screen, without draining unrelated entries restored from disk.
    func captureExternalThought(_ text: String, box: PairedBox) async -> ExternalCaptureResult {
        await outbox.restore()
        guard boxes.contains(where: { $0.id == box.id }), box.requiresDeviceUnlock == false,
              let entry = await outbox.store(text: text, origin: .external, source: "apple-app-intents", boxID: box.id) else {
            return .persistenceFailed
        }
        BoxLog.info("external quick chat stored", category: .composer, targetBoxID: box.id)
        await outbox.retry(id: entry.id)
        if let answer = answers.values.flatMap(\.self).first(where: { $0.view.id == entry.id })?.view {
            return .submitted(answer)
        }
        return .savedLocally
    }

    /// The outbox retries on its backoff only while the app is in the foreground.
    func setForeground(_ foreground: Bool) {
        self.foreground = foreground
        if foreground {
            resumeRetries()
        } else {
            retryTask?.cancel()
            retryTask = nil
            stopAwaiting()
        }
    }

    /// The box screen showing now, or nil when it is not shown. A change
    /// forgets what the person was waiting for: an answer that lands after
    /// they left or switched boxes only updates the rows.
    func setShownBox(_ boxID: UUID?) {
        guard boxID != shownBoxID else {
            return
        }
        shownBoxID = boxID
        stopAwaiting()
    }

    func consumeFollowUp(_ request: BoxScreenFollowUpRequest) {
        if followUp == request {
            followUp = nil
        }
    }

    /// Draw from the cached answer before the refresh returns.
    func loadCachedHome(boxID: UUID) async {
        guard homes[boxID] == nil, let cached = await repository.loadQuickChatHome(boxID: boxID) else {
            return
        }
        guard homes[boxID] == nil else {
            return
        }
        homes[boxID] = cached
    }

    func refresh(boxID: UUID) async {
        guard let box = box(boxID), refreshes[boxID] != .refreshing else {
            return
        }
        let wasFailed = refreshes[boxID] == .failed
        refreshes[boxID] = .refreshing
        let startSerial = answerSerial
        do {
            let home = try await client(box).home()
            // An open answer that arrived before this refresh started is older
            // than the server's list, so the list wins.
            answers[boxID]?.removeAll { $0.serial <= startSerial && Self.isOpen($0.view) }
            homes[boxID] = home
            refreshes[boxID] = .idle
            if wasFailed {
                BoxLog.info("box screen refresh recovered", category: .net, targetBoxID: boxID)
            }
            do {
                try await repository.saveQuickChatHome(home, boxID: boxID)
            } catch {
                BoxLog.warn("box screen home cache save failed error=\(type(of: error))", category: .net, targetBoxID: boxID)
            }
        } catch {
            refreshes[boxID] = .failed
            if wasFailed == false {
                BoxLog.warn("box screen refresh failed \(Self.describe(error))", category: .net, targetBoxID: boxID)
            }
        }
    }

    // MARK: Rows

    func needs(boxID: UUID) -> [BoxScreenNeed] {
        let outboxRows = outbox.entries(for: boxID).map { BoxScreenNeed.outbox($0, outbox.status(of: $0)) }
        let sessionAnswers = answers[boxID] ?? []
        let answered = Set(sessionAnswers.map(\.view.id))
        let sessionOpen = sessionAnswers.map(\.view).filter(Self.isOpen)
        let serverOpen = (homes[boxID]?.open ?? []).filter { answered.contains($0.id) == false }
        return outboxRows + (sessionOpen + serverOpen).map(BoxScreenNeed.record)
    }

    /// Sent answers to this app session's submissions, newest first.
    func sent(boxID: UUID) -> [QuickChatView] {
        (answers[boxID] ?? []).map(\.view).filter { $0.state == .sent }
    }

    // MARK: Actions

    /// The composer's quick chat target. Answers once the thought is on disk;
    /// the first attempt runs after.
    func submitThought(_ text: String, origin: QuickChatOrigin, boxID: UUID, source: String? = nil) async -> Bool {
        await outbox.restore()
        guard let entry = await outbox.store(text: text, origin: origin, source: source, boxID: boxID) else {
            return false
        }
        BoxLog.info("quick chat thought stored origin=\(origin.rawValue)", category: .composer, targetBoxID: boxID)
        awaitAnswer(entry.id, boxID: boxID)
        Task {
            await outbox.retry(id: entry.id)
            resumeRetries()
        }
        return true
    }

    /// The person's Retry on a waiting or not-sent outbox row.
    func retryOutboxEntry(id: UUID, boxID: UUID) async {
        awaitAnswer(id, boxID: boxID)
        await outbox.retry(id: id)
    }

    func choose(_ choice: QuickChatView.Choice, for view: QuickChatView, boxID: UUID) async {
        await act(on: view, boxID: boxID, name: "choose", follows: true) { client in
            try await client.choose(id: view.id, candidateId: choice.candidateId)
        }
    }

    func discard(_ view: QuickChatView, boxID: UUID) async {
        await act(on: view, boxID: boxID, name: "discard", follows: false) { client in
            try await client.discard(id: view.id)
        }
    }

    /// Retry a `sending` record: `submit` with the same id delivers again.
    func retry(_ view: QuickChatView, boxID: UUID) async {
        await act(on: view, boxID: boxID, name: "retry", follows: true) { client in
            try await client.submit(id: view.id, message: view.message, origin: nil, source: nil)
        }
    }

    fileprivate func submitEntry(_ entry: QuickChatOutboxEntry) async throws {
        guard let box = box(entry.boxID) else {
            throw StoreError.boxNotPaired
        }
        let view: QuickChatView
        do {
            view = try await client(box).submit(id: entry.id, message: entry.text, origin: entry.origin, source: entry.source)
        } catch {
            if entry.attempts == 0 {
                BoxLog.warn("quick chat submit failed \(Self.describe(error))", category: .net, targetBoxID: box.id)
            }
            let status = outbox.isStopped(entry) ? "Not sent" : "Waiting to send"
            follow(entry.id, boxID: box.id, with: .reveal(rowID: entry.id, status: status))
            throw error
        }
        BoxLog.info("quick chat submitted state=\(view.state.rawValue)", category: .net, targetBoxID: box.id)
        record(view, boxID: box.id)
        follow(view.id, boxID: box.id, with: .after(view))
    }

    private func act(
        on view: QuickChatView,
        boxID: UUID,
        name: String,
        follows: Bool,
        _ call: (any QuickChatClient) async throws -> QuickChatView
    ) async {
        guard let box = box(boxID), busyIDs.contains(view.id) == false else {
            return
        }
        if follows {
            awaitAnswer(view.id, boxID: boxID)
        }
        busyIDs.insert(view.id)
        actionErrors[view.id] = nil
        defer { busyIDs.remove(view.id) }
        do {
            let answer = try await call(client(box))
            BoxLog.info("quick chat \(name) state=\(answer.state.rawValue)", category: .net, targetBoxID: boxID)
            record(answer, boxID: boxID)
            follow(answer.id, boxID: boxID, with: .after(answer))
        } catch {
            // The error shows on the row the person just tapped.
            awaiting[view.id] = nil
            actionErrors[view.id] = error.localizedDescription
            BoxLog.warn("quick chat \(name) failed \(Self.describe(error))", category: .net, targetBoxID: boxID)
        }
    }

    private func record(_ view: QuickChatView, boxID: UUID) {
        answerSerial += 1
        var list = answers[boxID] ?? []
        list.removeAll { $0.view.id == view.id }
        list.insert(Answer(view: view, serial: answerSerial), at: 0)
        answers[boxID] = list
    }

    private func awaitAnswer(_ id: UUID, boxID: UUID) {
        guard shownBoxID == boxID else {
            return
        }
        awaiting[id] = boxID
    }

    /// Publish a follow-up when the person was waiting for this answer, on the
    /// box screen still showing. Either way the answer is no longer awaited.
    private func follow(_ id: UUID, boxID: UUID, with next: BoxScreenFollowUp?) {
        guard awaiting.removeValue(forKey: id) == boxID, shownBoxID == boxID, let next else {
            return
        }
        followUpSerial += 1
        followUp = BoxScreenFollowUpRequest(serial: followUpSerial, boxID: boxID, followUp: next)
    }

    private func stopAwaiting() {
        awaiting.removeAll()
        followUp = nil
    }

    private func resumeRetries() {
        guard foreground, outbox.isLoaded else {
            return
        }
        retryTask?.cancel()
        retryTask = Task { [outbox] in
            await outbox.runRetries()
        }
    }

    private func box(_ id: UUID) -> PairedBox? {
        boxes.first { $0.id == id }
    }

    private static func isOpen(_ view: QuickChatView) -> Bool {
        view.state == .needsChoice || view.state == .sending
    }

    /// Bounded metadata for the log: the HTTP status, or the error's type.
    private static func describe(_ error: Error) -> String {
        switch error {
        case QuickChatAPI.APIError.server(let status, _):
            "status=\(status)"
        case let urlError as URLError:
            "urlError=\(urlError.code.rawValue)"
        default:
            "error=\(type(of: error))"
        }
    }
}

/// Lets the outbox, created in the store's initializer, call back into the
/// store once it exists.
@MainActor
private final class SubmitRelay {
    weak var store: BoxScreenStore?

    func submit(_ entry: QuickChatOutboxEntry) async throws {
        guard let store else {
            throw CancellationError()
        }
        try await store.submitEntry(entry)
    }
}

#if DEBUG
extension BoxScreenStore {
    /// Seed the fixture screen's state without a server.
    func replaceForFixture(home: QuickChatHome?, sent: [QuickChatView], boxID: UUID) {
        homes[boxID] = home
        answers[boxID] = sent.map { view in
            answerSerial += 1
            return Answer(view: view, serial: answerSerial)
        }
    }

    func failRefreshForFixture(boxID: UUID) {
        refreshes[boxID] = .failed
    }
}
#endif
