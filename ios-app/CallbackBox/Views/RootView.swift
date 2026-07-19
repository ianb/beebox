import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: PairedBoxStore
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var composerDraftStore = ComposerDraftStore()
    @StateObject private var pendingEmissionStore = PendingEmissionStore()
    @State private var showingPairSheet = false
    @State private var visibleChatSessionID: String?
    @State private var visibleChatBoxID: PairedBox.ID?
    @State private var locationShareRequest: NativeLocationShareRequest?
    @State private var locationShareResult: NativeLocationShareResult?
    @State private var screenshotRequest: NativeScreenshotRequest?
    @State private var screenshotResult: NativeScreenshotResult?
    @State private var composerCommandAcknowledgements: [NativeComposerCommandAcknowledgement] = []

    var body: some View {
        Group {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--capture-fixture=") }) {
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
                ChatWebView(
                    box: box,
                    pendingEmissions: pendingEmissionStore.deliveries,
                    locationShareRequest: locationShareRequest,
                    screenshotRequest: screenshotRequest,
                    composerCommandAcknowledgements: composerCommandAcknowledgements,
                    onSessionChange: { sessionID in
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
                        locationShareResult = result
                    },
                    onScreenshotResult: { result in
                        guard result.requestID == screenshotRequest?.id else {
                            return
                        }
                        screenshotRequest = nil
                        screenshotResult = result
                    },
                    onComposerCommand: { delivery in
                        switch delivery {
                        case .command(let command):
                            Task {
                                let acknowledgement = await composerDraftStore.applySelectionCommand(
                                    command,
                                    boxID: box.id
                                )
                                composerCommandAcknowledgements.removeAll { $0.id == acknowledgement.id }
                                composerCommandAcknowledgements.append(acknowledgement)
                            }
                        case .rejection(let acknowledgement):
                            composerCommandAcknowledgements.removeAll { $0.id == acknowledgement.id }
                            composerCommandAcknowledgements.append(acknowledgement)
                        }
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
                        locationShareResult: locationShareResult,
                        screenshotResult: screenshotResult,
                        onShareLocation: {
                            locationShareResult = nil
                            locationShareRequest = NativeLocationShareRequest()
                        },
                        onTakeScreenshot: {
                            screenshotResult = nil
                            screenshotRequest = NativeScreenshotRequest()
                        }
                    )
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
            visibleChatBoxID = newBoxID
            visibleChatSessionID = nil
            locationShareRequest = nil
            locationShareResult = nil
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
            guard phase == .background else {
                return
            }
            Task {
                await composerDraftStore.flush()
            }
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
}
