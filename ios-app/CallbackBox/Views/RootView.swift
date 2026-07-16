import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: PairedBoxStore
    @EnvironmentObject private var outbox: OutboxStore
    @State private var showingPairSheet = false
    @State private var boxPendingRemoval: PairedBox?
    @State private var visibleChatSessionID: String?
    @State private var visibleChatBoxID: PairedBox.ID?
    @State private var pendingNativeEmissions: [NativeChatEmission] = []
    @State private var deliveredNativeEmissionID: NativeChatEmission.ID?
    @State private var showingWebControls = false

    var body: some View {
        NavigationStack {
            Group {
                if let box = store.selectedBox {
                    let composerBox = box.withSessionID(visibleChatBoxID == box.id ? visibleChatSessionID : box.sessionID)
                    VStack(spacing: 0) {
                        ChatWebView(
                            box: box,
                            embedded: showingWebControls == false,
                            pendingEmissions: pendingNativeEmissions,
                            onSessionChange: { sessionID in
                                visibleChatBoxID = box.id
                                visibleChatSessionID = sessionID
                            },
                            onEmissionHandled: { emissionID in
                                pendingNativeEmissions.removeAll { $0.id == emissionID }
                                deliveredNativeEmissionID = emissionID
                            }
                        )
                            .id("\(box.id.uuidString)-\(showingWebControls ? "web" : "native")")
                            .ignoresSafeArea(edges: .bottom)
                        if showingWebControls == false {
                            NativeComposerView(
                                box: composerBox,
                                deliveredEmissionID: deliveredNativeEmissionID
                            ) { emission in
                                pendingNativeEmissions.append(emission)
                            }
                        }
                    }
                } else {
                    EmptyBoxView {
                        showingPairSheet = true
                    }
                }
            }
            .navigationTitle(store.selectedBox?.label ?? "Callback Box")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    AppChromeMenu(
                        showingPairSheet: $showingPairSheet,
                        showingWebControls: $showingWebControls,
                        requestRemoval: { boxPendingRemoval = $0 }
                    )
                }
            }
            .sheet(isPresented: $showingPairSheet) {
                PairBoxView()
            }
            .onChange(of: store.selectedBox?.id) { _, newBoxID in
                visibleChatBoxID = newBoxID
                visibleChatSessionID = nil
                pendingNativeEmissions = []
                deliveredNativeEmissionID = nil
                showingWebControls = false
            }
            .alert("Remove Box?", isPresented: removeAlertBinding) {
                Button("Cancel", role: .cancel) {
                    boxPendingRemoval = nil
                }
                Button("Remove", role: .destructive) {
                    if let boxPendingRemoval {
                        store.remove(boxPendingRemoval)
                    }
                    boxPendingRemoval = nil
                }
            } message: {
                Text("This removes the box and its mobile auth token from this iPhone. You can pair it again from Settings.")
            }
        }
    }

    private var removeAlertBinding: Binding<Bool> {
        Binding(
            get: { boxPendingRemoval != nil },
            set: { showing in
                if !showing {
                    boxPendingRemoval = nil
                }
            }
        )
    }
}

private struct AppChromeMenu: View {
    @EnvironmentObject private var store: PairedBoxStore
    @Binding var showingPairSheet: Bool
    @Binding var showingWebControls: Bool
    var requestRemoval: (PairedBox) -> Void

    var body: some View {
        Menu {
            if store.boxes.isEmpty == false {
                Section("Boxes") {
                    ForEach(store.boxes) { box in
                        Button {
                            store.select(box)
                        } label: {
                            if box.id == store.selectedBox?.id {
                                Label(box.label, systemImage: "checkmark")
                            } else {
                                Text(box.label)
                            }
                        }
                    }
                }
            }

            Section {
                if store.selectedBox != nil {
                    Button {
                        showingWebControls.toggle()
                    } label: {
                        Label(
                            showingWebControls ? "Use Native Input" : "Show Web Controls",
                            systemImage: showingWebControls ? "keyboard" : "safari"
                        )
                    }
                }
                Button {
                    showingPairSheet = true
                } label: {
                    Label("Manage Boxes", systemImage: "rectangle.stack")
                }
                if let selectedBox = store.selectedBox {
                    Button(role: .destructive) {
                        requestRemoval(selectedBox)
                    } label: {
                        Label("Remove Current Box", systemImage: "trash")
                    }
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.title3)
        }
        .accessibilityLabel("Box controls")
    }
}

private struct EmptyBoxView: View {
    var onManualPair: () -> Void
    @EnvironmentObject private var store: PairedBoxStore

    var body: some View {
        ContentUnavailableView {
            Label("No Box Paired", systemImage: "link.badge.plus")
        } description: {
            Text("Add a Callback Box URL to load its embedded chat.")
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
        .environmentObject(OutboxStore())
}
