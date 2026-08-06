import SwiftUI

@main
struct CallbackBoxApp: App {
    @UIApplicationDelegateAdaptor(CallbackBoxAppDelegate.self) private var appDelegate
    @StateObject private var store = PairedBoxStore()
    @StateObject private var boxLockManager = BoxLockManager()
    @StateObject private var pairingURLInbox = PairingURLInbox.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(boxLockManager)
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
