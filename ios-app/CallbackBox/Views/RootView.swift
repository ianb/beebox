import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: PairedBoxStore
    @State private var showingPairSheet = false
    @State private var boxPendingRemoval: PairedBox?
    @State private var visibleChatSessionID: String?
    @State private var visibleChatBoxID: PairedBox.ID?
    @State private var pendingNativeEmissions: [NativeChatEmission] = []
    @State private var nativeEmissionReceipt: NativeEmissionReceipt?

    var body: some View {
        NavigationStack {
            Group {
                if let box = store.selectedBox {
                    let composerBox = box.withSessionID(visibleChatBoxID == box.id ? visibleChatSessionID : box.sessionID)
                    VStack(spacing: 0) {
                        ChatWebView(
                            box: box,
                            pendingEmissions: pendingNativeEmissions,
                            onSessionChange: { sessionID in
                                visibleChatBoxID = box.id
                                visibleChatSessionID = sessionID
                            },
                            onEmissionReceipt: { receipt in
                                pendingNativeEmissions.removeAll { $0.id == receipt.emissionID }
                                nativeEmissionReceipt = receipt
                            }
                        )
                            .id(box.id)
                            .safeAreaInset(edge: .bottom, spacing: 0) {
                                NativeComposerView(
                                    box: composerBox,
                                    emissionReceipt: nativeEmissionReceipt
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
                nativeEmissionReceipt = nil
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
