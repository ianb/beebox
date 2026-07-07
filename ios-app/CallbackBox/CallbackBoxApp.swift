import SwiftUI

@main
struct CallbackBoxApp: App {
    @UIApplicationDelegateAdaptor(CallbackBoxAppDelegate.self) private var appDelegate
    @StateObject private var store = PairedBoxStore()
    @StateObject private var outbox = OutboxStore()
    @StateObject private var pairingURLInbox = PairingURLInbox.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(outbox)
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
