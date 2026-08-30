#if DEBUG
import SwiftUI
import UIKit

/// A ring the fixture screen is currently drawing. A fresh `id` remounts the
/// overlay, which is what restarts its timer when the same control is pointed at
/// twice in a row.
private struct FixtureRing: Identifiable {
    var id = UUID()
    var frame: CGRect
}

struct NativeComposerFixtureScreen: View {
    private static let boxID = UUID(uuidString: "6f673715-08d2-4e6f-86df-e8f9a457f802") ?? UUID()
    private static let fixtureRootURL: URL = {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("beebox-composer-fixture", isDirectory: true)
        try? FileManager.default.removeItem(at: url)
        return url
    }()

    private let fixture = ProcessInfo.processInfo.arguments
        .first { $0.hasPrefix("--composer-fixture=") }?
        .replacingOccurrences(of: "--composer-fixture=", with: "") ?? "empty"
    /// `--composer-point=<control-id>:<action>` performs one pointer action as
    /// soon as the anchors have registered, so a plain screenshot of the
    /// `control-registry` fixture captures the ring (or the refusal) without
    /// anything having to drive a tap.
    private let pointArgument = ProcessInfo.processInfo.arguments
        .first { $0.hasPrefix("--composer-point=") }?
        .replacingOccurrences(of: "--composer-point=", with: "")
    private let repository: ComposerDraftRepository
    private let box = PairedBox(
        id: Self.boxID,
        label: "Fixture Box",
        baseURL: URL(string: "http://127.0.0.1:3210/main/test1") ?? URL(fileURLWithPath: "/"),
        sessionID: "fixture-session",
        authToken: nil,
        requiresDeviceUnlock: false
    )

    @StateObject private var draftStore: ComposerDraftStore
    @StateObject private var pendingStore: PendingEmissionStore
    @StateObject private var pairedBoxStore = PairedBoxStore()
    @StateObject private var boxLockManager = BoxLockManager()
    @StateObject private var controlRegistry = NativeControlRegistry()
    @State private var seeded = false
    /// The registry as of the last read, for the `control-registry` fixture. Read
    /// on demand rather than observed: the registry deliberately publishes
    /// nothing, so nothing it does can invalidate the view registering into it.
    @State private var registrySnapshot: [NativeControlEntry] = []
    /// The ring the `control-registry` fixture last drew, and the last refusal it
    /// was given. Together these make the fixture a check on the *pointing* half
    /// too — the geometry of the ring against a real laid-out frame, and the
    /// sentence a refusal comes back with, neither of which a unit test can show.
    @State private var fixtureRing: FixtureRing?
    @State private var lastRefusal: String?

    init() {
        let repository = ComposerDraftRepository(rootURL: Self.fixtureRootURL)
        self.repository = repository
        _draftStore = StateObject(wrappedValue: ComposerDraftStore(repository: repository))
        _pendingStore = StateObject(wrappedValue: PendingEmissionStore(repository: repository))
    }

    var body: some View {
        fixtureChat
            .safeAreaInset(edge: .bottom, spacing: 0) {
                NativeComposerView(
                    box: box,
                    draftStore: draftStore,
                    pendingStore: pendingStore,
                    captureAvailable: true,
                    narrationEnabled: false,
                    hqDictationEnabled: false,
                    speechPlaybackActive: false,
                    responseActive: false,
                    locationSharingEnabled: false,
                    onToggleLocationSharing: {},
                    onTakeScreenshot: {},
                    automaticallyResumeVoicePreparations: false,
                    voiceStateOverride: fixtureVoiceState,
                    initiallyFocused: fixture == "keyboard-shown",
                    initialDetailedSelection: fixture == "selection-detail" ? fixtureSelection : nil
                )
            }
            .environmentObject(pairedBoxStore)
            .environmentObject(boxLockManager)
            .environment(\.nativeControlRegistry, controlRegistry)
            .overlay {
                if let fixtureRing {
                    NativeControlRingView(frame: fixtureRing.frame) {
                        self.fixtureRing = nil
                    }
                    .id(fixtureRing.id)
                }
            }
            .task {
                await seedFixture()
            }
    }

    private var fixtureChat: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if fixture == "control-registry" {
                        registryReadout
                    } else {
                        fixtureBubble("Fixture conversation", outgoing: false)
                        fixtureBubble("The native composer stays docked below this web content.", outgoing: true)
                        fixtureBubble("State: \(fixture)", outgoing: false)
                    }
                }
                .padding()
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Fixture Box")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    /// What `scan-controls` would answer right now, without a server or a
    /// webview: the same `controlRegistry.entries` the bridge reads, rendered so
    /// a screenshot of this fixture is a check on the anchors themselves.
    private var registryReadout: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button("Read registry") {
                registrySnapshot = controlRegistry.entries
            }
            .buttonStyle(.borderedProminent)
            .task {
                // Read once unattended so a plain screenshot of this fixture
                // shows the inventory; the composer's anchors register during
                // their own onAppear, which runs after this view's first frame.
                try? await Task.sleep(nanoseconds: 400_000_000)
                registrySnapshot = controlRegistry.entries
                guard let pointArgument else {
                    return
                }
                let parts = pointArgument.split(separator: ":", maxSplits: 1)
                let action = parts.count == 2 ? NativeControlEntry.Action(rawValue: String(parts[1])) : .point
                perform(action ?? .point, on: String(parts[0]))
            }
            Text("\(registrySnapshot.count) native control(s) registered")
                .font(.headline)
            if let lastRefusal {
                Text(lastRefusal)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            ForEach(registrySnapshot) { entry in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(entry.role.rawValue) \(entry.id)")
                        .font(.system(.footnote, design: .monospaced))
                    Text("\(entry.label)\(entry.disabled ? " [disabled]" : "")")
                        .font(.footnote)
                    if let does = entry.does {
                        Text(does)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    // One button per action the entry claims, plus every action
                    // it does NOT — so the fixture shows the refusal sentences
                    // as readily as the successes.
                    HStack(spacing: 8) {
                        ForEach(NativeControlEntry.Action.allCases, id: \.rawValue) { action in
                            Button(entry.actions.contains(action) ? action.rawValue : "\(action.rawValue)?") {
                                perform(action, on: entry.id)
                            }
                            .font(.caption)
                            .buttonStyle(.bordered)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The same call `RootView` makes when a `control:` pointer arrives, so what
    /// this fixture draws is what the phone draws.
    private func perform(_ action: NativeControlEntry.Action, on id: String) {
        switch controlRegistry.perform(action, on: id) {
        case .pointed(let frame):
            lastRefusal = nil
            fixtureRing = FixtureRing(frame: frame)
        case .refused(let reason):
            fixtureRing = nil
            lastRefusal = reason
        }
    }

    private func fixtureBubble(_ text: String, outgoing: Bool) -> some View {
        Text(text)
            .padding(12)
            .foregroundStyle(outgoing ? .white : .primary)
            .background(outgoing ? Color.accentColor : Color(uiColor: .secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .frame(maxWidth: .infinity, alignment: outgoing ? .trailing : .leading)
    }

    @MainActor
    private func seedFixture() async {
        guard seeded == false else {
            return
        }
        seeded = true
        let draft = fixtureDraft
        for image in draft.images {
            try? await repository.savePayload(Self.fixtureImageData, filename: image.filename, boxID: box.id)
        }
        for file in draft.files {
            try? await repository.savePayload(Data("fixture file".utf8), filename: file.filename, boxID: box.id)
        }
        try? await repository.save(draft, boxID: box.id)
        try? await repository.savePendingEmissions(fixturePending, boxID: box.id)
        if fixtureVoicePreparations.isEmpty == false {
            try? await repository.saveVoicePreparations(fixtureVoicePreparations, boxID: box.id)
        }
        await draftStore.activate(boxID: box.id)
        draftStore.replaceForFixture(draft, boxID: box.id)
        await pendingStore.activate(boxID: box.id)
    }

    private var fixtureDraft: ComposerDraft {
        switch fixture {
        case "typing", "keyboard-shown":
            return draft(text: "A draft in progress with a useful insertion point.")
        case "multiline":
            return draft(text: "First paragraph for the agent.\n\nA second paragraph wraps across several lines so the native editor grows without covering the active line or the chat above it.")
        case "many-attachments":
            return attachmentDraft(imageCount: 7, failed: false)
        case "uploading":
            return transferDraft(state: .uploading(progress: 0.46), message: "Uploading field-notes.pdf")
        case "failed-upload":
            return transferDraft(state: .failed(message: "Upload failed while offline. Retry when connected."), message: "Upload needs attention")
        case "selection-detail":
            var value = draft(text: "Review the attached selection before sending.")
            value.selections = [fixtureSelection]
            value.nextSelectionID = 2
            return value
        case "expired-attachment":
            return transferDraft(
                state: .failed(message: "The uploaded file expired. Remove it or upload again."),
                message: "Expired attachment"
            )
        case "recording":
            var value = draft(text: "")
            ComposerDraftReducer.reduce(
                &value,
                .setDictationTranscript(
                    """
                    Earlier spoken words fill the first line of the live transcript.
                    More dictated detail keeps the native editor growing.
                    The transcript is now taller than the editor can display.
                    Newest spoken words stay visible at the bottom.
                    """
                )
            )
            return value
        default:
            return .empty
        }
    }

    private var fixturePending: [PendingEmission] {
        switch fixture {
        case "sending":
            [pending(index: 1, state: .pending(deliveryAttempts: 1, lastAttemptAt: Date()))]
        case "two-pending":
            [
                pending(index: 1, state: .pending(deliveryAttempts: 1, lastAttemptAt: Date())),
                pending(index: 2, state: .pending(deliveryAttempts: 0, lastAttemptAt: nil))
            ]
        case "stuck-pending":
            // Older than the long-pending threshold, still `pending`: the
            // affordance the user sees while redelivery keeps retrying.
            [pending(
                index: 1,
                state: .pending(
                    deliveryAttempts: 3,
                    lastAttemptAt: Date().addingTimeInterval(-40)
                ),
                age: 180
            )]
        case "rejected-send":
            [pending(index: 1, state: .rejected(reason: "The target rejected this message while offline."))]
        default:
            []
        }
    }

    private var fixtureVoicePreparations: [VoicePreparation] {
        guard fixture == "hq-preparation" else {
            return []
        }
        let snapshot = draft(text: "Voice snapshot <send-message phrase=\"send now\" />")
        return [VoicePreparation(
            id: UUID(),
            boxID: box.id,
            draft: snapshot,
            liveTranscript: snapshot.text,
            priorInput: "",
            action: .send,
            matchedPhrase: "send now",
            audioFilename: nil,
            createdAt: Date()
        )]
    }

    private var fixtureVoiceState: VoiceCompositionState? {
        switch fixture {
        case "recording":
            return .recording
        case "starting-dictation":
            return .requestingPermission
        case "interrupted":
            return .failed(
                message: "Dictation was interrupted. Your live transcript is ready to edit or send."
            )
        default:
            return nil
        }
    }

    private var fixtureSelection: DraftSelection {
        DraftSelection(
            id: 1,
            ref: "notes/field-observations.md",
            text: "The selected source text remains a durable snapshot.",
            position: "lines 12-14",
            anchor: nil,
            spokenWords: nil
        )
    }

    private func draft(text: String) -> ComposerDraft {
        var value = ComposerDraft.empty
        ComposerDraftReducer.reduce(&value, .setText(text))
        return value
    }

    private func attachmentDraft(imageCount: Int, failed: Bool) -> ComposerDraft {
        var value = draft(text: "Photos, files, and selections stay scrollable")
        for index in 1...imageCount {
            ComposerDraftReducer.reduce(
                &value,
                .addImage(DraftImage(
                    id: index,
                    filename: "fixture-\(index).png",
                    mimeType: "image/png",
                    state: failed ? .failed(message: "Image unavailable") : .local
                ))
            )
        }
        ComposerDraftReducer.reduce(
            &value,
            .addFile(DraftFile(
                id: 1,
                filename: "fixture.pdf",
                originalName: "field-notes.pdf",
                size: 84_000,
                mimetype: "application/pdf",
                state: .uploaded(path: "tmp/fixture.pdf")
            ))
        )
        ComposerDraftReducer.reduce(&value, .addSelection(fixtureSelection))
        return value
    }

    private func transferDraft(state: DraftTransferState, message: String) -> ComposerDraft {
        var value = draft(text: message)
        ComposerDraftReducer.reduce(
            &value,
            .addFile(DraftFile(
                id: 1,
                filename: "fixture.pdf",
                originalName: "field-notes.pdf",
                size: 84_000,
                mimetype: "application/pdf",
                state: state
            ))
        )
        return value
    }

    private func pending(
        index: Int,
        state: PendingEmissionState,
        age: TimeInterval = 0
    ) -> PendingEmission {
        PendingEmission(
            id: UUID(),
            boxID: box.id,
            draft: draft(text: "Pending message \(index)"),
            text: "Pending message \(index)",
            origin: .typed,
            diarized: false,
            state: state,
            createdAt: Date().addingTimeInterval(Double(index) - age)
        )
    }

    private static var fixtureImageData: Data {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 80, height: 80))
        return renderer.image { context in
            UIColor.systemTeal.setFill()
            context.cgContext.fill(CGRect(x: 0, y: 0, width: 80, height: 80))
            UIColor.systemYellow.setFill()
            context.cgContext.fill(CGRect(x: 12, y: 12, width: 24, height: 24))
        }.pngData() ?? Data()
    }
}
#endif
