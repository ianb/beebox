import SwiftUI
import UIKit

struct RootView: View {
    @EnvironmentObject private var store: PairedBoxStore
    @EnvironmentObject private var boxLockManager: BoxLockManager
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var composerDraftStore = ComposerDraftStore(scope: .conversation)
    @StateObject private var pendingEmissionStore = PendingEmissionStore()
    /// The box screen's new-thought draft, separate from the chat's draft.
    @StateObject private var newThoughtDraftStore = ComposerDraftStore(scope: .newThought)
    /// The box screen's composer requires a pending store; a quick chat send
    /// never touches it, so this one is never activated.
    @StateObject private var boxScreenPendingStore = PendingEmissionStore()
    @StateObject private var boxScreenStore = BoxScreenStore()
    /// What the person sees, and whether `ChatWebView` exists behind it.
    @State private var surfaceState = RootSurfaceState.launching
    /// The last stay in the background, until the foreground event or a
    /// notification tap decides the surface. In memory only: a killed app is
    /// a cold launch.
    @State private var backgroundStay: BackgroundStay?
    @State private var showingPairSheet = false
    @State private var navigationFailure: ChatWebView.NavigationFailure?
    /// A notification tap's target, waiting for the chat webview to load it.
    @State private var navigationRequest: ChatWebView.NavigationRequest?
    @ObservedObject private var pushRegistrar = PushRegistrar.shared
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
            } else if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--box-screen-fixture=") }) {
                BoxScreenFixtureScreen()
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
            // A new box starts afresh, as a cold launch does, unless a
            // notification tap for it is waiting to open in the web app.
            if let newBoxID, navigationRequest?.boxID == newBoxID {
                surfaceState = RootSurfaceRule.transition(.launching, on: .notificationTap)
            } else {
                applySurface(.boxSwitched)
            }
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
        .task {
            // The scene is usually active before this runs, and `onChange`
            // does not report the initial phase.
            boxScreenStore.updateBoxes(store.boxes)
            boxScreenStore.setForeground(scenePhase == .active)
            await boxScreenStore.start()
        }
        .onReceive(store.$boxes) { boxes in
            boxScreenStore.updateBoxes(boxes)
        }
        .task(id: store.selectedBox?.id) {
            guard let boxID = store.selectedBox?.id else {
                return
            }
            await boxScreenStore.loadCachedHome(boxID: boxID)
            await composerDraftStore.activate(boxID: boxID)
            await newThoughtDraftStore.activate(boxID: boxID)
            await pendingEmissionStore.activate(boxID: boxID)
            guard Task.isCancelled == false, store.selectedBox?.id == boxID else {
                return
            }
            // The launch rule waits for the restore: pending chat messages are
            // delivered only through a mounted web view.
            applySurface(.restoreCompleted(hasPendingEmissions: hasPendingEmissions(boxID: boxID)))
            await boxScreenStore.refresh(boxID: boxID)
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
                boxScreenStore.setForeground(true)
                returnToForeground()
                Task {
                    await LogForwarder.shared.setActive(true)
                    await LogForwarder.shared.flush()
                }
                NotificationCenterDelegate.clearOnForeground()
                Task {
                    await pushRegistrar.sceneDidBecomeActive()
                }
                evaluatePendingEmissionRedelivery()
            }
            guard phase == .background else {
                return
            }
            backgroundStay = BackgroundStay(since: Date())
            boxScreenStore.setForeground(false)
            LogFlushBackgroundTask().begin()
            if store.selectedBox?.requiresDeviceUnlock == true {
                showingPairSheet = false
                resignProtectedFirstResponder()
            }
            boxLockManager.relock()
            Task {
                await composerDraftStore.flush()
                await newThoughtDraftStore.flush()
            }
        }
        .onReceive(NotificationTapInbox.shared.$pending.compactMap(\.self)) { pending in
            openNotificationTap(pending.tap)
            NotificationTapInbox.shared.clear(pending.id)
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

    /// Open a tapped notification's target (contract §5.10) in the chat webview,
    /// on the paired box the payload's `box` slug names. A payload from an
    /// older box, or one naming no paired box, opens on the selected box.
    private func openNotificationTap(_ tap: NotificationTap) {
        let box: PairedBox
        switch tap.pairedBox(in: store.boxes, selected: store.selectedBox) {
        case .matched(let matched):
            box = matched
        case .ambiguous(let chosen, let matches):
            box = chosen
            BoxLog.info(
                "notification tap box slug matches \(matches) paired boxes; opened on \(chosen.id == store.selectedBox?.id ? "selected" : "first") match",
                category: .push,
                targetBoxID: chosen.id
            )
        case .fallback(let fallback, let boxKeyPresent):
            box = fallback
            if boxKeyPresent || store.boxes.count > 1 {
                BoxLog.info(
                    "notification tap \(boxKeyPresent ? "box slug matches no paired box" : "payload names no box"); opened on \(store.boxes.count == 1 ? "only" : "selected") box boxes=\(store.boxes.count)",
                    category: .push,
                    targetBoxID: fallback.id
                )
            }
        case .none:
            BoxLog.warn("notification tap with no paired box", category: .push)
            return
        }
        guard let path = tap.boxPath else {
            BoxLog.warn(
                "notification tap target unreadable present=\(tap.target != nil)",
                category: .push,
                targetBoxID: box.id
            )
            return
        }
        if store.selectedBox?.id != box.id {
            store.select(box)
        }
        BoxLog.info(
            "notification tap opening scheme=\(tap.scheme)",
            category: .push,
            targetBoxID: box.id
        )
        // `ChatWebView` must exist to consume the request, so the web app is
        // shown and mounted first.
        applySurface(.notificationTap)
        navigationRequest = ChatWebView.NavigationRequest(boxID: box.id, path: path)
    }

    /// Show the web app at a box-relative path: a recent chat, a box-wide page,
    /// or a shortcut on the box screen.
    private func openWeb(path: String, box: PairedBox) {
        resignProtectedFirstResponder()
        applySurface(.openWeb)
        navigationRequest = ChatWebView.NavigationRequest(boxID: box.id, path: path)
    }

    private func applySurface(_ event: RootSurfaceEvent) {
        // Before the no-change return: a tap that finds the web app already
        // shown still consumes the pending foreground decision.
        let stay = RootSurfaceRule.pendingStay(backgroundStay, after: event)
        if event == .notificationTap, backgroundStay != nil {
            BoxLog.info("notification tap consumed the pending foreground return", category: .lifecycle)
        }
        backgroundStay = stay
        let next = RootSurfaceRule.transition(surfaceState, on: event)
        guard next != surfaceState else {
            return
        }
        let message = "root surface=\(next.surface) webMounted=\(next.webMounted) event=\(Self.eventName(event))"
        if let boxID = store.selectedBox?.id {
            BoxLog.info(message, category: .lifecycle, targetBoxID: boxID)
        } else {
            BoxLog.info(message, category: .lifecycle)
        }
        surfaceState = next
    }

    private func returnToForeground() {
        guard let boxID = store.selectedBox?.id else {
            return
        }
        guard let event = RootSurfaceRule.foregroundEvent(
            for: backgroundStay,
            now: Date(),
            hasPendingEmissions: hasPendingEmissions(boxID: boxID)
        ) else {
            return
        }
        applySurface(event)
    }

    private func hasPendingEmissions(boxID: PairedBox.ID) -> Bool {
        pendingEmissionStore.pending.contains { $0.boxID == boxID }
            || pendingEmissionStore.voicePreparations.isEmpty == false
    }

    private static func eventName(_ event: RootSurfaceEvent) -> String {
        switch event {
        case .restoreCompleted(let hasPendingEmissions):
            "restoreCompleted pending=\(hasPendingEmissions)"
        case .returnedToForeground(let backgroundedFor, let webContentAlive, let hasPendingEmissions):
            "returnedToForeground after=\(Int(backgroundedFor))s webAlive=\(webContentAlive) pending=\(hasPendingEmissions)"
        case .notificationTap:
            "notificationTap"
        case .openWeb:
            "openWeb"
        case .openBoxScreen:
            "openBoxScreen"
        case .boxSwitched:
            "boxSwitched"
        case .webContentTerminated:
            "webContentTerminated"
        }
    }

    private func resignProtectedFirstResponder() {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil,
            from: nil,
            for: nil
        )
    }

    /// The box screen, the web app, or, until the launch rule has run, only the
    /// background. The web app stays mounted, hidden, behind the box screen
    /// once it exists, so returning to it is immediate.
    private func boxContent(box: PairedBox, composerBox: PairedBox) -> some View {
        ZStack {
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()
            if surfaceState.webMounted {
                let shown = surfaceState.surface == .web
                webContent(box: box, composerBox: composerBox, composerShown: shown)
                    .opacity(shown ? 1 : 0)
                    .allowsHitTesting(shown)
                    .accessibilityHidden(shown == false)
            }
            if surfaceState.surface == .boxScreen {
                BoxScreenView(
                    box: box,
                    boxes: store.boxes,
                    screenStore: boxScreenStore,
                    outbox: boxScreenStore.outbox,
                    draftStore: newThoughtDraftStore,
                    pendingStore: boxScreenPendingStore,
                    onOpen: { path in
                        openWeb(path: path, box: box)
                    },
                    onSelectBox: { other in
                        store.select(other)
                    }
                )
                .environment(\.nativeControlRegistry, controlRegistry)
            }
        }
    }

    private func webContent(box: PairedBox, composerBox: PairedBox, composerShown: Bool) -> some View {
        ChatWebView(
            box: box,
            pendingEmissions: pendingEmissionStore.deliveries,
            emissionRedeliveryRequest: emissionRedeliveryRequest,
            locationShareRequest: locationShareRequest,
            screenshotRequest: screenshotRequest,
            speechStopRequest: speechStopRequest,
            navigationRequest: navigationRequest,
            composerCommandAcknowledgements: composerCommandAcknowledgements,
            composerCommandResults: composerCommandResults,
            onComposerBinding: { publication in
                guard let publication else { pendingEmissionStore.invalidateBinding(); return }
                guard publication.boxSlug == box.slug else { return }
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
            },
            onNavigationFailure: { failure in
                navigationFailure = failure
            },
            onNavigationRequestLoaded: { id in
                if navigationRequest?.id == id {
                    navigationRequest = nil
                }
            },
            onOpenBoxScreen: {
                resignProtectedFirstResponder()
                applySurface(.openBoxScreen)
            },
            onWebContentTerminated: {
                if scenePhase == .active {
                    applySurface(.webContentTerminated)
                } else {
                    backgroundStay?.webContentEnded = true
                }
            }
        )
        .overlay {
            if let failure = navigationFailure {
                UnreachableBoxView(box: box, failure: failure)
            }
        }
        .environment(\.nativeControlRegistry, controlRegistry)
        .id(box.id)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // Only while the web app is shown; the box screen has its own.
            if composerShown {
                webComposer(composerBox: composerBox)
            }
        }
    }

    private func webComposer(composerBox: PairedBox) -> some View {
        VStack(spacing: 0) {
            if pushRegistrar.permission == .denied {
                HStack {
                    NotificationsOffNotice()
                    Spacer()
                }
                .padding(.vertical, 8)
                .background(.bar)
            }
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
    /// nil when it may be. Covers the full-screen natives `RootView` itself
    /// presents; a sheet a child view raises (the attach menu, capture) is not
    /// visible from here and is a known imprecision, recorded in §4.8.
    private func obstructedNativeSurface(box: PairedBox) -> String? {
        if boxLockManager.isLocked(box) {
            return "The box is locked, so its native controls are covered by the unlock screen."
        }
        if surfaceState.surface != .web {
            return "The box screen is covering the web app and its native controls."
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
    private let hold = BackgroundExecutionHold()
    private var work: Task<Void, Never>?

    func begin() {
        _ = hold.begin(name: "beebox.log-flush") { [weak self] in
            MainActor.assumeIsolated {
                self?.cancelForExpiration()
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
        hold.end()
    }

    private func cancelForExpiration() {
        work?.cancel()
        work = nil
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

/// Shown in place of the blank `WKWebView` when a chat navigation fails.
///
/// Lives in this file rather than its own: the Xcode project uses explicit
/// `project.pbxproj` file references, so a new file would need registering in
/// three places by hand.
///
/// Before this, a navigation failure was reported ONLY through `BoxLog.warn`,
/// which `LogForwarder` sends to the box — the one place that is unreachable in
/// exactly this failure. So an unreachable box showed an empty white screen and
/// nothing else, and a transport problem was indistinguishable from a box that
/// had simply been paired at an address it can never be reached on.
struct UnreachableBoxView: View {
    let box: PairedBox
    let failure: ChatWebView.NavigationFailure

    /// A box paired from a browser sitting on `localhost` stored an address
    /// that means THE PHONE. No network fix reaches it, so retrying is not the
    /// advice — re-pairing is.
    private var pairedToLoopback: Bool {
        guard let host = box.baseURL.host?.lowercased() else { return false }
        return host == "localhost" || host == "127.0.0.1" || host == "::1"
    }

    private var explanation: String {
        if pairedToLoopback {
            return "This box was paired from an address only its own computer can reach "
                + "(\(box.baseURL.host ?? "localhost")), so the phone has nowhere to connect. "
                + "Pair it again from an address this phone can reach."
        }
        return "The phone could not reach \(box.baseURL.host ?? box.baseURL.absoluteString). "
            + "It may be asleep, off the network, or reachable only over a VPN that is not connected."
    }

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: pairedToLoopback ? "link.badge.plus" : "wifi.exclamationmark")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(pairedToLoopback ? "Can't reach this box from here" : "Can't reach \(box.label)")
                .font(.headline)
            Text(explanation)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            // The underlying error, quietly: it is what distinguishes "offline"
            // from "host not found" when someone reports this.
            Text(failure.localizedDescription)
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
    }
}

/// The one-line notification state in the paired-box shell: shown when the
/// system has notifications turned off for the app, so the shell never implies
/// a phone that cannot be reached is reachable (engineering principle 13).
private struct NotificationsOffNotice: View {
    var body: some View {
        HStack(spacing: 6) {
            Label("Notifications off", systemImage: "bell.slash")
                .foregroundStyle(.secondary)
            Button("Settings") {
                guard let url = URL(string: UIApplication.openSettingsURLString) else {
                    return
                }
                UIApplication.shared.open(url)
            }
        }
        .font(.subheadline)
        .padding(.leading)
    }
}
