import SwiftUI
import AppIntents

@MainActor
enum AppRuntime {
    static let pairedBoxStore = PairedBoxStore()
    static let boxScreenStore = BoxScreenStore()
}

@main
struct BeeBoxApp: App {
    @UIApplicationDelegateAdaptor(BeeBoxAppDelegate.self) private var appDelegate
    @StateObject private var store = AppRuntime.pairedBoxStore
    @StateObject private var boxScreenStore = AppRuntime.boxScreenStore
    @StateObject private var boxLockManager = BoxLockManager()
    @State private var captureLogStates: [UUID: String] = [:]
    @StateObject private var pairingURLInbox = PairingURLInbox.shared
    @State private var pairingFailureMessage: String?

    private var captureFixtureActive: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains { $0.hasPrefix("--quick-capture-fixture=") }
        #else
        false
        #endif
    }

    init() {
        AppDependencyManager.shared.add(dependency: { await AppRuntime.pairedBoxStore })
        BeeBoxAppShortcuts.updateAppShortcutParameters()
        QuickCaptureUploadCoordinator.shared.setReceiptHandler {
            let boxes = await MainActor.run { AppRuntime.pairedBoxStore.boxes }
            await QuickCaptureUploadCoordinator.shared.resumeWaitingContexts(boxes: boxes)
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(boxScreenStore)
                .environmentObject(boxLockManager)
                .task {
                    guard !captureFixtureActive else { return }
                    // The registrar observes pairings from here on; the app
                    // delegate supplies the APNs token (contract §5.9).
                    PushRegistrar.shared.attach(store: store)
                }
                .onReceive(NotificationCenter.default.publisher(for: QuickCaptureStore.didChange).receive(on: DispatchQueue.main)) { _ in
                    guard !captureFixtureActive else { return }
                    do {
                        for record in try QuickCaptureStore.shared.records() {
                            guard captureLogStates[record.id] != record.status.state else { continue }
                            captureLogStates[record.id] = record.status.state
                            BoxLog.info("quick capture state id=\(record.id) state=\(record.status.state)", category: .capture, targetBoxID: record.boxID)
                        }
                    } catch { BoxLog.error("quick capture state read failed error=\(type(of: error))", category: .capture) }
                }
                .onReceive(store.$boxes) { boxes in
                    guard !captureFixtureActive else { return }
                    VoiceNoteCoordinator.shared.updatePairedBoxes(boxes)
                    if UIApplication.shared.isProtectedDataAvailable {
                        do { try QuickCaptureStore.shared.preserveProtection(boxes: boxes) }
                        catch { BoxLog.warn("quick capture protection update failed error=\(type(of: error))", category: .capture) }
                    }
                    let runtime = CaptureUploadRuntime.shared
                    runtime.updateBoxes(boxes)
                    BeeBoxAppShortcuts.updateAppShortcutParameters()
                    Task { await QuickCaptureUploadCoordinator.shared.recover(boxes: boxes) }
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
                    guard !captureFixtureActive else { return }
                    let boxes = store.boxes
                    let effectiveBoxID = selectedBoxID ?? boxes.first?.id
                    Task {
                        await LogForwarder.shared.updateBoxes(
                            boxes,
                            selectedBoxID: effectiveBoxID
                        )
                    }
                }
                // Both URL callbacks (this one and the app delegate's) feed the
                // inbox, so the inbox handler below is the only place a link
                // is paired.
                .onOpenURL { url in
                    pairingURLInbox.accept(url)
                }
                .onReceive(pairingURLInbox.$pendingURL.compactMap(\.self)) { url in
                    // @Published delivers before it stores the new value, so the
                    // clear runs in the task, after `accept` has finished.
                    Task {
                        pairingURLInbox.clear(url)
                        if QuickCaptureURLInbox.handles(url) {
                            QuickCaptureURLInbox.shared.accept(url)
                            return
                        }
                        guard url.scheme == "beebox", url.host == "pair" else {
                            BoxLog.info("open url ignored reason=unhandled-link", category: .lifecycle)
                            return
                        }
                        let outcome = await store.pair(from: url)
                        if let message = outcome.failureMessage {
                            pairingFailureMessage = message
                        }
                    }
                }
                .alert(
                    "Pairing Failed",
                    isPresented: Binding(
                        get: { pairingFailureMessage != nil },
                        set: { if !$0 { pairingFailureMessage = nil } }
                    )
                ) {
                    Button("OK", role: .cancel) { pairingFailureMessage = nil }
                } message: {
                    Text(pairingFailureMessage ?? "")
                }
        }
    }
}
