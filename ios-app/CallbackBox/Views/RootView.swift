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
    @State private var locationShareResult: NativeLocationShareResult?
    @State private var locationSharingEnabled = false
    @State private var narrationEnabled = false
    @State private var speechPlaybackActive = false
    @State private var responseActive = false
    @State private var screenshotRequest: NativeScreenshotRequest?
    @State private var screenshotResult: NativeScreenshotResult?
    @State private var composerCommandAcknowledgements: [NativeComposerCommandAcknowledgement] = []

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
                let composerBox = box.withSessionID(visibleChatBoxID == box.id ? visibleChatSessionID : box.sessionID)
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
            speechPlaybackActive = false
            responseActive = false
            screenshotRequest = nil
            screenshotResult = nil
            composerCommandAcknowledgements = []
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
            locationShareRequest: locationShareRequest,
            screenshotRequest: screenshotRequest,
            composerCommandAcknowledgements: composerCommandAcknowledgements,
            onSessionChange: { sessionID in
                if visibleChatSessionID != sessionID {
                    narrationEnabled = false
                    speechPlaybackActive = false
                    responseActive = false
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
                handleComposerCommand(delivery, boxID: box.id)
            },
            onComposerCommandAcknowledgementDelivered: { id in
                composerCommandAcknowledgements.removeAll { $0.id == id }
            }
        )
        .id(box.id)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            NativeComposerView(
                box: composerBox,
                draftStore: composerDraftStore,
                pendingStore: pendingEmissionStore,
                captureAvailable: visibleChatBoxID == box.id && visibleChatSessionID?.isEmpty == false,
                narrationEnabled: narrationEnabled,
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
                }
            )
        }
    }

    private func handleComposerCommand(_ delivery: NativeComposerCommandDelivery, boxID: PairedBox.ID) {
        switch delivery {
        case .command(let command):
            Task {
                let acknowledgement = await composerDraftStore.applySelectionCommand(command, boxID: boxID)
                composerCommandAcknowledgements.removeAll { $0.id == acknowledgement.id }
                composerCommandAcknowledgements.append(acknowledgement)
            }
        case .rejection(let acknowledgement):
            composerCommandAcknowledgements.removeAll { $0.id == acknowledgement.id }
            composerCommandAcknowledgements.append(acknowledgement)
        }
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
        identifier = UIApplication.shared.beginBackgroundTask(withName: "callbackbox.log-flush") {
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
            Text("Add a Callback Box URL to load its chat.")
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
