import AppIntents
import Foundation

struct StartVoiceNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Voice Note"
    static let description = IntentDescription("Start recording a voice note for your capture destination.")
    @available(iOS 26.0, *) static let supportedModes: IntentModes = [.foreground]
    @available(iOS, deprecated: 26.0, message: "iOS 26 uses supportedModes") static var openAppWhenRun: Bool { true }
    @Parameter(title: "Box") var box: CaptureBoxEntity?
    @Dependency private var pairedBoxStore: PairedBoxStore

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        do {
            let target = try CaptureDestinationStore().resolve(boxes: pairedBoxStore.boxes, pinnedBoxID: box?.id)
            if #available(iOS 18.0, *) { try await VoiceNoteCoordinator.shared.start(box: target) }
            else { try await VoiceNoteCoordinator.shared.start(box: target, requireLiveActivity: false) }
            QuickCaptureURLInbox.shared.accept(URL(string: "beebox://capture/voice?action=show")!)
            return .result(dialog: "Recording a voice note for \(target.label). Say Stop and Save my voice note in Bee Box when finished.")
        } catch { return .result(dialog: IntentDialog(stringLiteral: "Recording did not start. \(error.localizedDescription)")) }
    }
}
@available(iOS 18.0, *)
extension StartVoiceNoteIntent: AudioRecordingIntent {}

struct StopVoiceNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "Stop and Save Voice Note"
    @available(iOS 26.0, *) static let supportedModes: IntentModes = [.foreground]
    @available(iOS, deprecated: 26.0, message: "iOS 26 uses supportedModes") static var openAppWhenRun: Bool { true }
    @Dependency private var pairedBoxStore: PairedBoxStore
    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        do {
            if VoiceNoteCoordinator.shared.draft?.requiresDeviceUnlock == true {
                throw CaptureDestinationStore.DestinationError.protected
            }
            if let id = VoiceNoteCoordinator.shared.draft?.boxID {
                _ = try CaptureDestinationStore().resolve(boxes: pairedBoxStore.boxes, pinnedBoxID: id)
            }
            let label = try await VoiceNoteCoordinator.shared.stopAndSave(boxes: pairedBoxStore.boxes)
            return .result(dialog: "Saved on your phone for \(label).")
        } catch { return .result(dialog: IntentDialog(stringLiteral: "Not saved. \(error.localizedDescription)")) }
    }
}
@available(iOS 18.0, *)
extension StopVoiceNoteIntent: AudioRecordingIntent {}
