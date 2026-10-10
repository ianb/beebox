import SwiftUI
import AppIntents

@MainActor
private enum AppRuntime {
    static let pairedBoxStore = PairedBoxStore()
    static let boxScreenStore = BoxScreenStore()
}

@main
struct BeeBoxApp: App {
    @UIApplicationDelegateAdaptor(BeeBoxAppDelegate.self) private var appDelegate
    @StateObject private var store = AppRuntime.pairedBoxStore
    @StateObject private var boxScreenStore = AppRuntime.boxScreenStore
    @StateObject private var boxLockManager = BoxLockManager()
    @StateObject private var pairingURLInbox = PairingURLInbox.shared

    init() {
        AppDependencyManager.shared.add(dependency: { await AppRuntime.pairedBoxStore })
        AppDependencyManager.shared.add(dependency: { await AppRuntime.boxScreenStore })
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(boxScreenStore)
                .environmentObject(boxLockManager)
                .task {
                    // The registrar observes pairings from here on; the app
                    // delegate supplies the APNs token (contract §5.9).
                    PushRegistrar.shared.attach(store: store)
                }
                .onReceive(store.$boxes) { boxes in
                    let runtime = CaptureUploadRuntime.shared
                    runtime.updateBoxes(boxes)
                    Task {
                        try? await runtime.start()
                    }
                    // Launch flush: entries persisted by a suspended, killed, or
                    // offline run land server-side here.
                    let selectedBoxID = store.selectedBoxID ?? boxes.first?.id
                    Task {
                        await LogForwarder.shared.updateBoxes(boxes, selectedBoxID: selectedBoxID)
                        await LogForwarder.shared.flush()
                    }
                }
                .onReceive(store.$selectedBoxID) { selectedBoxID in
                    let boxes = store.boxes
                    let effectiveBoxID = selectedBoxID ?? boxes.first?.id
                    Task {
                        await LogForwarder.shared.updateBoxes(
                            boxes,
                            selectedBoxID: effectiveBoxID
                        )
                    }
                }
                .onOpenURL { url in
                    Task {
                        _ = await store.pair(from: url)
                    }
                }
                .onReceive(pairingURLInbox.$pendingURL.compactMap(\.self)) { url in
                    Task {
                        _ = await store.pair(from: url)
                        pairingURLInbox.clear(url)
                    }
                }
        }
    }
}
