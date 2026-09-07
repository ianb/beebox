import SwiftUI
import UIKit

struct RootView: View {
    @EnvironmentObject private var store: PairedBoxStore
    @EnvironmentObject private var boxLockManager: BoxLockManager
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var composerDraftStore = ComposerDraftStore()
    @StateObject private var pendingEmissionStore = PendingEmissionStore()
    @State private var showingPairSheet = false
    @State private var visibleChatSessionID: String?
    @State private var visibleChatBoxID: PairedBox.ID?
    @State private var locationShareRequest: NativeLocationShareRequest?
    /// One pending barge-in: the record button was pressed while the box was
    /// speaking, and the page has not been told to stop yet (contract §4.9).
    @State private var speechStopRequest: NativeSpeechStopRequest?
    @State private var locationShareResult: NativeLocationShareResult?
    @State private var locationSharingEnabled = false
    @State private var narrationEnabled = false
    @State private var hqDictationEnabled = false
    @State private var speechPlaybackActive = false
    @State private var responseActive = false
    @State private var screenshotRequest: NativeScreenshotRequest?
    @State private var screenshotResult: NativeScreenshotResult?
    @State private var composerCommandAcknowledgements: [NativeComposerCommandAcknowledgement] = []
    @State private var composerCommandResults: [NativeComposerCommandResult] = []
    /// What the native chrome currently on screen has declared about itself, for
    /// the web's `scan-controls` request. Populated by `.controlAnchor` in the
    /// composer's own view bodies, so it cannot describe a control that is not
    /// rendered.
    @StateObject private var controlRegistry = NativeControlRegistry()
    /// The native ring a `control:` pointer asked for, if one is on screen. Held
    /// here rather than in the composer because the ring is drawn over the whole
    /// app in global coordinates, and the surface it points at may not be the
    /// composer forever.
    @State private var controlRing: NativeControlRing?
    @State private var emissionRedeliveryRequest: NativeEmissionRedeliveryRequest?
    /// Emission IDs already logged as redelivered / long-pending, so the
    /// forwarded log carries one line per transition instead of one per tick.
    @State private var redeliveryLoggedIDs: Set<UUID> = []
    @State private var longPendingLoggedIDs: Set<UUID> = []
    /// Drives redelivery re-evaluation while the scene is active. Foregrounding
    /// re-evaluates directly, so a suspended timer costs nothing.
    @State private var emissionRedeliveryTicker = Timer
        .publish(every: 5, on: .main, in: .common)
        .autoconnect()

    var body: some View {
        Group {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--composer-fixture=") }) {
                NativeComposerFixtureScreen()
            } else if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--capture-fixture=") }) {
                NativeCaptureFixtureScreen()
            } else {
                rootContent
            }
            #else
            rootContent
            #endif
        }
    }

    @ViewBuilder
    private var rootContent: some View {
        Group {
            if let box = store.selectedBox {
                let composerBox = box.withSessionID(pendingEmissionStore.composerBinding != nil
                    ? pendingEmissionStore.selectedSessionID
                    : (visibleChatBoxID == box.id ? visibleChatSessionID : box.sessionID))
                let locked = boxLockManager.isLocked(box)
                ZStack {
                    boxContent(box: box, composerBox: composerBox)
                        .allowsHitTesting(locked == false)
                        .accessibilityHidden(locked)

                    if locked {
                        LockedBoxView(
                            box: box,
                            status: boxLockManager.status,
                            onUnlock: { boxLockManager.unlock(box) },
                            onCancel: boxLockManager.cancelAuthentication,
                            onOpenWithoutPasscode: { boxLockManager.openWithoutPasscode(box) },
                            onManageBoxes: { showingPairSheet = true }
                        )
                    }
                }
            } else {
                EmptyBoxView {
                    showingPairSheet = true
                }
            }
        }
        .overlay {
            if let controlRing {
                NativeControlRingView(frame: controlRing.frame) {
                    self.controlRing = nil
                }
                .id(controlRing.id)
            }
        }
        .sheet(isPresented: $showingPairSheet) {
            PairBoxView()
        }
        .onChange(of: store.selectedBox?.id) { _, newBoxID in
            if let newBoxID {
                BoxLog.info(
                    "selected box id=\(newBoxID.uuidString)",
                    category: .lifecycle,
                    targetBoxID: newBoxID
                )
            }
            resignProtectedFirstResponder()
            boxLockManager.relock()
            visibleChatBoxID = newBoxID
            visibleChatSessionID = nil
            locationShareRequest = nil
            locationShareResult = nil
            locationSharingEnabled = false
            narrationEnabled = false
            hqDictationEnabled = false
            speechPlaybackActive = false
            responseActive = false
            screenshotRequest = nil
            screenshotResult = nil
            speechStopRequest = nil
            composerCommandAcknowledgements = []
            composerCommandResults = []
            controlRing = nil
            pendingEmissionStore.deactivate()
        }
        .task(id: store.selectedBox?.id) {
            guard let boxID = store.selectedBox?.id else {
                return
            }
            await composerDraftStore.activate(boxID: boxID)
            await pendingEmissionStore.activate(boxID: boxID)
        }
        .onChange(of: scenePhase) { _, phase in
            if let boxID = store.selectedBox?.id {
                BoxLog.info(
                    "scene phase=\(scenePhaseName(phase))",
                    category: .lifecycle,
                    targetBoxID: boxID
                )
            }
            if phase == .active {
                Task {
                    await LogForwarder.shared.setActive(true)
                    await LogForwarder.shared.flush()
                }
                evaluatePendingEmissionRedelivery()
            }
            guard phase == .background else {
                return
            }
            LogFlushBackgroundTask().begin()
            if store.selectedBox?.requiresDeviceUnlock == true {
                showingPairSheet = false
                resignProtectedFirstResponder()
            }
            boxLockManager.relock()
            Task {
                await composerDraftStore.flush()
            }
        }
        .onReceive(emissionRedeliveryTicker) { _ in
            guard scenePhase == .active else {
                return
            }
            evaluatePendingEmissionRedelivery()
        }
    }

    /// Redeliver pending emissions whose receipt has not arrived within the
    /// backoff, and log the two transitions worth diagnosing later.
    private func evaluatePendingEmissionRedelivery(now: Date = Date()) {
        guard let boxID = store.selectedBox?.id else {
            return
        }
        let pending = pendingEmissionStore.pending.filter { $0.boxID == boxID }
        let liveIDs = Set(pending.map(\.id))
        redeliveryLoggedIDs.formIntersection(liveIDs)
        longPendingLoggedIDs.formIntersection(liveIDs)

        for emission in pending {
            guard case .pending(let attempts, _) = emission.state else {
                continue
            }
            guard
                EmissionRedeliveryPolicy.isLongPending(createdAt: emission.createdAt, now: now),
                longPendingLoggedIDs.contains(emission.id) == false
            else {
                continue
            }
            longPendingLoggedIDs.insert(emission.id)
            BoxLog.info(
                "emission long pending attempts=\(attempts)"
                    + " age=\(Int(now.timeIntervalSince(emission.createdAt)))s",
                category: .webview,
                targetBoxID: boxID
            )
        }

        let due = pending.filter {
            EmissionRedeliveryPolicy.shouldRedeliver(state: $0.state, now: now)
        }
        guard due.isEmpty == false else {
            return
        }
        for emission in due where redeliveryLoggedIDs.contains(emission.id) == false {
            redeliveryLoggedIDs.insert(emission.id)
            guard case .pending(let attempts, let lastAttemptAt) = emission.state else {
                continue
            }
            let waited = lastAttemptAt.map { Int(now.timeIntervalSince($0)) } ?? 0
            BoxLog.info(
                "emission redelivery started attempts=\(attempts) waited=\(waited)s",
                category: .webview,
                targetBoxID: boxID
            )
        }
        emissionRedeliveryRequest = NativeEmissionRedeliveryRequest(
            emissionIDs: Set(due.map(\.id))
        )
    }

    private func resignProtectedFirstResponder() {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil,
            from: nil,
            for: nil
        )
    }

    private func boxContent(box: PairedBox, composerBox: PairedBox) -> some View {
        ChatWebView(
            box: box,
            pendingEmissions: pendingEmissionStore.deliveries,
            emissionRedeliveryRequest: emissionRedeliveryRequest,
            locationShareRequest: locationShareRequest,
            screenshotRequest: screenshotRequest,
            speechStopRequest: speechStopRequest,
            composerCommandAcknowledgements: composerCommandAcknowledgements,
            composerCommandResults: composerCommandResults,
            onComposerBinding: { publication in
                guard let publication else { pendingEmissionStore.invalidateBinding(); return }
                guard publication.boxSlug == box.baseURL.lastPathComponent else { return }
                if pendingEmissionStore.changesConversation(publication) {
                    narrationEnabled = false
                    hqDictationEnabled = false
                    speechPlaybackActive = false
                    responseActive = false
                    speechStopRequest = nil
                }
                Task { await pendingEmissionStore.receiveBinding(publication, box: box) }
            },
            onSessionChange: { sessionID in
                guard pendingEmissionStore.composerBinding == nil else { return }
                if visibleChatSessionID != sessionID {
                    narrationEnabled = false
                    hqDictationEnabled = false
                    speechPlaybackActive = false
                    responseActive = false
                    speechStopRequest = nil
                }
                visibleChatBoxID = box.id
                visibleChatSessionID = sessionID
            },
            onEmissionDeliveryAttempt: { emissionID in
                Task {
                    await pendingEmissionStore.markDeliveryAttempt(id: emissionID)
                }
            },
            onEmissionReceipt: { receipt in
                Task {
                    await pendingEmissionStore.handleReceipt(receipt)
                }
            },
            onLocationShareResult: { result in
                guard result.requestID == locationShareRequest?.id else {
                    return
                }
                locationShareRequest = nil
                if let enabled = result.enabled {
                    locationSharingEnabled = enabled
                }
                locationShareResult = result
            },
            onLocationSharingStateChange: { enabled in
                locationSharingEnabled = enabled
            },
            onNarrationStateChange: { enabled in
                narrationEnabled = enabled
            },
            onHqDictationStateChange: { enabled in
                hqDictationEnabled = enabled
            },
            onSpeechPlaybackStateChange: { playing in
                if speechPlaybackActive != playing {
                    BoxLog.info(
                        "speech playback active=\(playing)",
                        category: .audio,
                        targetBoxID: box.id
                    )
                }
                speechPlaybackActive = playing
            },
            onResponseStateChange: { active in
                if responseActive != active {
                    BoxLog.info(
                        "response active=\(active)",
                        category: .lifecycle,
                        targetBoxID: box.id
                    )
                }
                responseActive = active
            },
            onScreenshotResult: { result in
                guard result.requestID == screenshotRequest?.id else {
                    return
                }
                screenshotRequest = nil
                screenshotResult = result
            },
            onComposerCommand: { delivery in
                handleComposerCommand(delivery, box: box)
            },
            onComposerCommandAcknowledgementDelivered: { id in
                composerCommandAcknowledgements.removeAll { $0.id == id }
            },
            onComposerCommandResultDelivered: { id in
                composerCommandResults.removeAll { $0.id == id }
            },
            onLastAudioRequest: { request in
                answerLastAudioRequest(request, box: box)
            },
            onSpeechStopRequestSettled: { id in
                guard speechStopRequest?.id == id else {
                    return
                }
                speechStopRequest = nil
            }
        )
        .environment(\.nativeControlRegistry, controlRegistry)
        .id(box.id)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            NativeComposerView(
                box: composerBox,
                draftStore: composerDraftStore,
                pendingStore: pendingEmissionStore,
                captureAvailable: composerBox.sessionID?.isEmpty == false,
                narrationEnabled: narrationEnabled,
                hqDictationEnabled: hqDictationEnabled,
                speechPlaybackActive: speechPlaybackActive,
                responseActive: responseActive,
                locationSharingEnabled: locationSharingEnabled,
                locationShareResult: locationShareResult,
                screenshotResult: screenshotResult,
                onToggleLocationSharing: {
                    locationShareResult = nil
                    locationShareRequest = NativeLocationShareRequest()
                },
                onTakeScreenshot: {
                    screenshotResult = nil
                    screenshotRequest = NativeScreenshotRequest()
                },
                onInterruptSpeech: {
                    speechStopRequest = NativeSpeechStopRequest()
                },
                requiresConversationBinding: true
            )
        }
    }

    /// Answer a box agent's request for one voice message's recording. The
    /// answer goes straight to the box over HTTP rather than back through the
    /// page — see the contract note on `NativeLastAudioRequest`.
    ///
    /// A device that does not hold the recording still answers, with "none":
    /// staying silent would be indistinguishable from a phone that is asleep,
    /// and a "none" cannot settle the request early, so it costs the agent
    /// nothing while a tab that DOES hold the audio keeps its chance to answer.
    private func answerLastAudioRequest(_ request: NativeLastAudioRequest, box: PairedBox) {
        Task {
            let retained = await VoiceAudioRetentionStore.shared.retained(
                emissionID: request.messageID,
                boxID: box.id
            )
            do {
                try await ChatAPI(box: box).answerLastAudio(request, retained: retained)
            } catch {
                BoxLog.warn(
                    "last-audio answer failed: \(error.localizedDescription)",
                    category: .composer,
                    targetBoxID: box.id
                )
            }
        }
    }

    private func handleComposerCommand(_ delivery: NativeComposerCommandDelivery, box: PairedBox) {
        switch delivery {
        case .command(let command):
            switch command.payload {
            case .addSelection:
                Task {
                    let acknowledgement = await composerDraftStore.applySelectionCommand(command, boxID: box.id)
                    acknowledge(acknowledgement)
                }
            case .scanControls:
                // A native surface can cover the chat while the composer under it
                // stays mounted and therefore stays registered. Answering from the
                // registry then would describe controls the user cannot see or
                // reach, and — worse — would report the dump as covering native
                // chrome while the thing actually on top (the lock screen, the
                // pairing sheet) is nowhere in it. Refuse instead: the web reads a
                // refusal exactly like silence and says the native controls are
                // missing from the list. See mobile-contract.md §4.8.
                if let reason = obstructedNativeSurface(box: box) {
                    acknowledge(.accepted(id: command.id))
                    deliver(.refused(id: command.id, kind: .scanControls, reason: reason))
                    return
                }
                // The registry is the answer, and an EMPTY registry is still an
                // answer — the web distinguishes "native reported nothing on
                // screen" from "native never answered", and only the second one
                // makes the dump say the composer may be missing from it.
                let controls = controlRegistry.entries
                BoxLog.info(
                    "native control scan answered count=\(controls.count)",
                    category: .webview,
                    targetBoxID: box.id
                )
                acknowledge(.accepted(id: command.id))
                deliver(.controls(id: command.id, controls))
            case .pointAtControl(let target):
                // Same obstruction rule as the scan, for the same reason: a
                // ring drawn under the unlock screen or the pairing sheet is a
                // pointer at something the user cannot see, reported as success.
                if let reason = obstructedNativeSurface(box: box) {
                    acknowledge(.accepted(id: command.id))
                    deliver(.refused(id: command.id, kind: .pointAtControl, reason: reason))
                    return
                }
                acknowledge(.accepted(id: command.id))
                switch controlRegistry.perform(target.action, on: target.id) {
                case .pointed(let frame):
                    controlRing = NativeControlRing(frame: frame)
                    BoxLog.info(
                        "native control pointed id=\(target.id) action=\(target.action.rawValue)",
                        category: .webview,
                        targetBoxID: box.id
                    )
                    deliver(.pointed(id: command.id))
                case .refused(let reason):
                    BoxLog.warn(
                        "native control point refused id=\(target.id) action=\(target.action.rawValue)",
                        category: .webview,
                        targetBoxID: box.id
                    )
                    deliver(.refused(id: command.id, kind: .pointAtControl, reason: reason))
                }
            }
        case .rejection(let acknowledgement):
            acknowledge(acknowledgement)
        }
    }

    /// Why the registry must not be reported as the native surface right now, or
    /// nil when it may be. Covers the two full-screen natives `RootView` itself
    /// presents; a sheet a child view raises (the attach menu, capture) is not
    /// visible from here and is a known imprecision, recorded in §4.8.
    private func obstructedNativeSurface(box: PairedBox) -> String? {
        if boxLockManager.isLocked(box) {
            return "The box is locked, so its native controls are covered by the unlock screen."
        }
        if showingPairSheet {
            return "The box-pairing sheet is covering the app's native controls."
        }
        return nil
    }

    private func acknowledge(_ acknowledgement: NativeComposerCommandAcknowledgement) {
        composerCommandAcknowledgements.removeAll { $0.id == acknowledgement.id }
        composerCommandAcknowledgements.append(acknowledgement)
    }

    private func deliver(_ result: NativeComposerCommandResult) {
        composerCommandResults.removeAll { $0.id == result.id }
        composerCommandResults.append(result)
    }

    private func scenePhaseName(_ phase: ScenePhase) -> String {
        switch phase {
        case .active:
            "active"
        case .inactive:
            "inactive"
        case .background:
            "background"
        @unknown default:
            "unknown"
        }
    }
}

/// A ring currently drawn on a native control. The `id` is what restarts the
/// timer when the same control is pointed at twice in a row: a new value
/// re-identifies the overlay, which is what remounts it.
private struct NativeControlRing: Identifiable {
    var id = UUID()
    var frame: CGRect
}

/// One best-effort log flush as the app backgrounds, held open by a UIKit
/// background-task assertion.
///
/// The entries are already on disk, so this is opportunistic: expiration
/// cancels the flush and ends the assertion rather than racing the watchdog.
/// The running `Task` keeps this object alive for its own lifetime.
@MainActor
private final class LogFlushBackgroundTask {
    private var identifier = UIBackgroundTaskIdentifier.invalid
    private var work: Task<Void, Never>?

    func begin() {
        identifier = UIApplication.shared.beginBackgroundTask(withName: "beebox.log-flush") {
            MainActor.assumeIsolated {
                self.end()
            }
        }
        work = Task {
            await LogForwarder.shared.setActive(false)
            await LogForwarder.shared.flush()
            self.end()
        }
    }

    private func end() {
        work?.cancel()
        work = nil
        guard identifier != .invalid else {
            return
        }
        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }
}

private struct LockedBoxView: View {
    var box: PairedBox
    var status: BoxLockStatus
    var onUnlock: () -> Void
    var onCancel: () -> Void
    var onOpenWithoutPasscode: () -> Void
    var onManageBoxes: () -> Void
    @EnvironmentObject private var store: PairedBoxStore

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "lock.fill")
                .font(.system(size: 42))
                .foregroundStyle(.secondary)
            Text(box.label)
                .font(.title2.bold())
            statusContent
            Menu("Choose Another Box") {
                ForEach(store.boxes.filter { $0.id != box.id }) { otherBox in
                    Button(otherBox.label) {
                        store.select(otherBox)
                    }
                }
            }
            .disabled(store.boxes.count < 2)
            Button("Manage Boxes", action: onManageBoxes)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
        .background(Color(uiColor: .systemBackground))
    }

    @ViewBuilder
    private var statusContent: some View {
        switch status {
        case .locked:
            Button("Unlock", action: onUnlock)
                .buttonStyle(.borderedProminent)
        case .authenticating:
            ProgressView("Authenticating…")
            Button("Cancel", action: onCancel)
        case .failed:
            Text("Authentication failed. Try again.")
                .foregroundStyle(.secondary)
            Button("Retry", action: onUnlock)
                .buttonStyle(.borderedProminent)
        case .passcodeNotSet:
            Text("This device has no passcode, so it cannot verify your identity.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Open Anyway", action: onOpenWithoutPasscode)
                .buttonStyle(.borderedProminent)
        }
    }
}

private struct EmptyBoxView: View {
    var onManualPair: () -> Void
    @EnvironmentObject private var store: PairedBoxStore

    var body: some View {
        ContentUnavailableView {
            Label("No Box Paired", systemImage: "link.badge.plus")
        } description: {
            Text("Add a Bee Box URL to load its chat.")
        } actions: {
            Button("Add Box", action: onManualPair)
            #if DEBUG
            Button("Use Local Test Box") {
                store.addLocalTestBox()
            }
            #endif
        }
    }
}

#Preview {
    RootView()
        .environmentObject(PairedBoxStore())
        .environmentObject(BoxLockManager())
}
