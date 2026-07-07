import SwiftUI

@main
struct CallbackBoxApp: App {
    @StateObject private var store = PairedBoxStore()
    @StateObject private var outbox = OutboxStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(outbox)
        }
    }
}
