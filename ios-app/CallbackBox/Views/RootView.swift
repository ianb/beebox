import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: PairedBoxStore
    @EnvironmentObject private var outbox: OutboxStore
    @State private var showingPairSheet = false

    var body: some View {
        NavigationStack {
            Group {
                if let box = store.selectedBox {
                    VStack(spacing: 0) {
                        ChatWebView(box: box)
                            .ignoresSafeArea(edges: .bottom)
                        NativeComposerView(box: box)
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
                    AppChromeMenu(showingPairSheet: $showingPairSheet)
                }
            }
            .sheet(isPresented: $showingPairSheet) {
                PairBoxView()
            }
        }
    }
}

private struct AppChromeMenu: View {
    @EnvironmentObject private var store: PairedBoxStore
    @Binding var showingPairSheet: Bool

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
                    Label("Pair Box", systemImage: "link.badge.plus")
                }
                Button {
                    showingPairSheet = true
                } label: {
                    Label("Manage Boxes", systemImage: "rectangle.stack")
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
