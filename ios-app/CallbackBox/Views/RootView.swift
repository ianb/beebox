import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: PairedBoxStore
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var composerDraftStore = ComposerDraftStore()
    @State private var showingPairSheet = false
    @State private var visibleChatSessionID: String?
    @State private var visibleChatBoxID: PairedBox.ID?
    @State private var pendingNativeEmissions: [NativeChatEmission] = []
    @State private var nativeEmissionReceipt: NativeEmissionReceipt?
    @State private var locationShareRequest: NativeLocationShareRequest?
    @State private var locationShareResult: NativeLocationShareResult?

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
                    pendingEmissions: pendingNativeEmissions,
                    locationShareRequest: locationShareRequest,
                    onSessionChange: { sessionID in
                        visibleChatBoxID = box.id
                        visibleChatSessionID = sessionID
                    },
                    onEmissionReceipt: { receipt in
                        pendingNativeEmissions.removeAll { $0.id == receipt.emissionID }
                        nativeEmissionReceipt = receipt
                    },
                    onLocationShareResult: { result in
                        guard result.requestID == locationShareRequest?.id else {
                            return
                        }
                        locationShareRequest = nil
                        locationShareResult = result
                    }
                )
                .id(box.id)
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    NativeComposerView(
                        box: composerBox,
                        draftStore: composerDraftStore,
                        captureAvailable: visibleChatBoxID == box.id && visibleChatSessionID?.isEmpty == false,
                        emissionReceipt: nativeEmissionReceipt,
                        locationShareResult: locationShareResult,
                        onSendEmission: { emission in
                            pendingNativeEmissions.append(emission)
                        },
                        onShareLocation: {
                            locationShareResult = nil
                            locationShareRequest = NativeLocationShareRequest()
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
            pendingNativeEmissions = []
            nativeEmissionReceipt = nil
            locationShareRequest = nil
            locationShareResult = nil
        }
        .task(id: store.selectedBox?.id) {
            guard let boxID = store.selectedBox?.id else {
                return
            }
            await composerDraftStore.activate(boxID: boxID)
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
