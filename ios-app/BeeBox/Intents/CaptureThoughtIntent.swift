import AppIntents
import Foundation

struct CaptureThoughtIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a Thought to Bee Box"
    static let description = IntentDescription("Save a text thought in the selected Bee Box.")
    @available(iOS 26.0, *)
    static let supportedModes: IntentModes = [.background]
    @available(iOS, deprecated: 26.0, message: "iOS 26 uses supportedModes")
    static var openAppWhenRun: Bool { false }

    @Parameter(title: "Thought") var thought: String
    @Dependency private var pairedBoxStore: PairedBoxStore
    @Dependency private var boxScreenStore: BoxScreenStore

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = thought.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.isEmpty == false else {
            BoxLog.warn("external quick chat refused reason=empty-thought", category: .composer)
            return .result(dialog: "Tell me what thought to save.")
        }
        guard let box = pairedBoxStore.selectedBox else {
            BoxLog.warn("external quick chat refused reason=no-selected-box", category: .composer)
            return .result(dialog: "No Bee Box is paired. Pair a box in the Bee Box app first.")
        }
        guard box.requiresDeviceUnlock == false else {
            BoxLog.warn("external quick chat refused reason=requires-device-unlock", category: .composer, targetBoxID: box.id)
            return .result(dialog: "\(box.label) requires device unlock and is unavailable through Siri. Unlock it in the Bee Box app.")
        }
        guard box.authToken?.isEmpty == false else {
            BoxLog.warn("external quick chat refused reason=missing-credential", category: .composer, targetBoxID: box.id)
            return .result(dialog: "Bee Box could not access the selected box. Open the app and reconnect it.")
        }

        boxScreenStore.updateBoxes(pairedBoxStore.boxes)
        switch await boxScreenStore.captureExternalThought(text, box: box) {
        case .persistenceFailed:
            return .result(dialog: "The thought was not saved. Open Bee Box and try again.")
        case .savedLocally:
            return .result(dialog: "The thought is saved on this phone, but Bee Box could not confirm delivery.")
        case .submitted(let view):
            switch view.state {
            case .sent:
                return .result(dialog: "Sent to \(box.label).")
            case .needsChoice:
                return .result(dialog: "Saved for \(box.label). Choose a destination in the Bee Box app.")
            case .sending:
                return .result(dialog: "Bee Box has the thought but could not confirm delivery. Open Bee Box to check it.")
            case .discarded:
                return .result(dialog: "The thought was not sent. Open Bee Box to review it.")
            }
        }
    }
}

struct BeeBoxAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureThoughtIntent(),
            phrases: ["Add a thought to \(.applicationName)", "Save a thought in \(.applicationName)"],
            shortTitle: "Add a Thought",
            systemImageName: "tray.and.arrow.down"
        )
    }
}
