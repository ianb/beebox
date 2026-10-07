#if DEBUG
import SwiftUI

/// The box screen with isolated stores and a fake server, for simulator
/// screenshots of each face: `--box-screen-fixture=<state>`, where state is
/// `empty`, `multi-box`, `needs-choice`, `not-delivered`, `waiting-to-send`,
/// `sent`, or `refresh-failed`.
struct BoxScreenFixtureScreen: View {
    private static let fixtureName = ProcessInfo.processInfo.arguments
        .first { $0.hasPrefix("--box-screen-fixture=") }?
        .replacingOccurrences(of: "--box-screen-fixture=", with: "") ?? "empty"
    private static let fixtureRootURL: URL = {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("beebox-box-screen-fixture", isDirectory: true)
        try? FileManager.default.removeItem(at: url)
        return url
    }()
    private static let boxes: [PairedBox] = [
        fixtureBox(id: "6f673715-08d2-4e6f-86df-e8f9a457f802", label: "Home box", slug: "test1"),
        fixtureBox(id: "0c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e", label: "Work box", slug: "work"),
        fixtureBox(id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", label: "Family box", slug: "family"),
    ]

    private let fixture = Self.fixtureName
    private let repository: ComposerDraftRepository
    @StateObject private var screenStore: BoxScreenStore
    @StateObject private var draftStore: ComposerDraftStore
    @StateObject private var pendingStore: PendingEmissionStore
    @StateObject private var pairedBoxStore = PairedBoxStore()
    @StateObject private var boxLockManager = BoxLockManager()
    @State private var opened: String?
    @State private var seeded = false

    init() {
        let repository = ComposerDraftRepository(rootURL: Self.fixtureRootURL)
        self.repository = repository
        let fixture = Self.fixtureName
        _screenStore = StateObject(wrappedValue: BoxScreenStore(repository: repository, client: { _ in
            FixtureQuickChatClient(fixture: fixture)
        }))
        _draftStore = StateObject(wrappedValue: ComposerDraftStore(scope: .newThought, repository: repository))
        _pendingStore = StateObject(wrappedValue: PendingEmissionStore(repository: repository))
    }

    private var box: PairedBox { Self.boxes[0] }
    private var shownBoxes: [PairedBox] { fixture == "multi-box" ? Self.boxes : [box] }

    var body: some View {
        BoxScreenView(
            box: box,
            boxes: shownBoxes,
            screenStore: screenStore,
            outbox: screenStore.outbox,
            draftStore: draftStore,
            pendingStore: pendingStore,
            onOpen: { opened = $0 },
            onSelectBox: { opened = "box \($0.label)" },
            initiallyShowsBoxes: fixture == "multi-box"
        )
        .overlay(alignment: .top) {
            if let opened {
                Text("Would open \(opened)")
                    .font(.caption)
                    .padding(6)
                    .background(.thinMaterial, in: Capsule())
            }
        }
        .environmentObject(pairedBoxStore)
        .environmentObject(boxLockManager)
        .task {
            await seed()
        }
    }

    @MainActor
    private func seed() async {
        guard seeded == false else {
            return
        }
        seeded = true
        screenStore.updateBoxes(shownBoxes)
        if fixture == "waiting-to-send" {
            let entry = QuickChatOutboxEntry(
                id: UUID(),
                boxID: box.id,
                text: "Ask Dana about the 14th",
                origin: .typed,
                createdAt: Date().addingTimeInterval(-90),
                attempts: 1,
                lastAttemptAt: Date().addingTimeInterval(-5)
            )
            try? await repository.saveQuickChatOutbox([entry])
        }
        await draftStore.activate(boxID: box.id)
        let open: [QuickChatView] = switch fixture {
        case "needs-choice": [FixtureQuickChatClient.needsChoice]
        case "not-delivered": [FixtureQuickChatClient.notDelivered]
        default: []
        }
        let sent: [QuickChatView] = fixture == "sent" ? FixtureQuickChatClient.sent : []
        screenStore.replaceForFixture(home: FixtureQuickChatClient.home(open: open), sent: sent, boxID: box.id)
        await screenStore.start()
        if fixture == "refresh-failed" {
            screenStore.failRefreshForFixture(boxID: box.id)
        }
    }

    private static func fixtureBox(id: String, label: String, slug: String) -> PairedBox {
        PairedBox(
            id: UUID(uuidString: id) ?? UUID(),
            label: label,
            baseURL: URL(string: "http://127.0.0.1:3210/main/\(slug)") ?? URL(fileURLWithPath: "/"),
            sessionID: nil,
            authToken: nil,
            requiresDeviceUnlock: false
        )
    }
}

/// A server that answers from fixed data. `waiting-to-send` has no signal.
private struct FixtureQuickChatClient: QuickChatClient {
    var fixture: String

    static let trip = QuickChatView.Destination(label: "Trip planning", sessionId: "0b7d4c1e-6a2f-4e8b-9c3d-2f1a5e7b9d40")

    static let needsChoice = QuickChatView(
        id: UUID(),
        message: "Remind me to renew my passport",
        createdAt: "2026-10-06T14:02:11.000Z",
        state: .needsChoice,
        reason: .uncertain,
        choices: [
            .init(candidateId: "c2", label: "Trip planning", detail: "Travel"),
            .init(candidateId: "c9", label: "New general chat"),
            .init(candidateId: "c0", label: "Household", detail: "Home"),
        ]
    )

    static let notDelivered = QuickChatView(
        id: UUID(),
        message: "Order more coffee filters",
        createdAt: "2026-10-06T13:40:00.000Z",
        state: .sending,
        destination: .init(label: "Household", sessionId: "3c9e1a7b-5d2f-4e6a-8b0c-4d2f6a8c0e10"),
        lastError: "Chat is not running on the box. Retry in a moment."
    )

    static let sent: [QuickChatView] = [
        QuickChatView(
            id: UUID(),
            message: "Check whether the raised bed lumber order shipped",
            createdAt: "2026-10-06T14:10:00.000Z",
            state: .sent,
            destination: .init(label: "Garden raised beds", sessionId: "7e1f3a5c-9b2d-4f6a-8c0e-2a4c6e8a0b30")
        ),
        QuickChatView(
            id: UUID(),
            message: "The dishwasher repair is Tuesday at 10",
            createdAt: "2026-10-06T14:05:00.000Z",
            state: .sent,
            destination: .init(label: "Household", sessionId: "3c9e1a7b-5d2f-4e6a-8b0c-4d2f6a8c0e10"),
            queued: true
        ),
    ]

    static func home(open: [QuickChatView]) -> QuickChatHome {
        QuickChatHome(
            open: open,
            recentlySent: [],
            recentChats: [
                .init(sessionId: "6e2a9c4d-1b3f-4d7e-8a5c-9f0b2d4e6a80", label: "Plan the week", lastActivity: "2026-10-06T14:30:00.000Z",
                      landmark: nil),
                .init(sessionId: trip.sessionId ?? "", label: "Trip planning", lastActivity: "2026-10-06T12:00:00.000Z",
                      landmark: .init(dir: "_content/travel", label: "Travel", symbol: "✈️")),
                .init(sessionId: "3c9e1a7b-5d2f-4e6a-8b0c-4d2f6a8c0e10", label: "Household", lastActivity: "2026-10-05T18:30:00.000Z",
                      landmark: .init(dir: "_content/home", label: "Home", symbol: nil)),
                .init(sessionId: "7e1f3a5c-9b2d-4f6a-8c0e-2a4c6e8a0b30", label: "Garden raised beds", lastActivity: "2026-10-04T09:00:00.000Z",
                      landmark: .init(dir: "_content/garden", label: "Garden", symbol: "🌱")),
            ],
            shortcuts: [
                .init(label: "Questions", to: "/questions"),
                .init(label: "Garden plan", to: "/browse/_content/garden/Garden.landmark.card"),
            ]
        )
    }

    func submit(id: UUID, message: String, origin _: NativeChatEmission.Origin?) async throws -> QuickChatView {
        try offline()
        var view = Self.needsChoice
        view.id = id
        view.message = message
        return view
    }

    func choose(id: UUID, candidateId: String) async throws -> QuickChatView {
        QuickChatView(id: id, message: Self.needsChoice.message, createdAt: Self.needsChoice.createdAt, state: .sent, destination: Self.trip)
    }

    func discard(id: UUID) async throws -> QuickChatView {
        QuickChatView(id: id, message: "", createdAt: "", state: .discarded)
    }

    func home() async throws -> QuickChatHome {
        throw URLError(.notConnectedToInternet)
    }

    private func offline() throws {
        if fixture == "waiting-to-send" {
            throw URLError(.notConnectedToInternet)
        }
    }
}
#endif
