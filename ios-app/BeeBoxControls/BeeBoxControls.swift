import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// The extension opens a task in the app. It never owns an audio recorder or
/// pretends its process-local state is the app's recording state.
@available(iOS 18.0, *)
struct OpenVoiceNoteControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Record or Save Voice Note"
    static var openAppWhenRun: Bool { true }
    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "beebox://capture/voice?action=toggle")!))
    }
}

@available(iOS 18.0, *)
struct VoiceNoteControl: ControlWidget {
    static let kind = "app.beebox.ios.voice-note"
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenVoiceNoteControlIntent()) {
                Label("Record or Save", systemImage: "mic.fill")
            }
        }
        .displayName("Bee Box Voice Note")
        .description("Start a voice note, or stop and save the active recording.")
    }
}

struct VoiceNoteLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: VoiceNoteActivityAttributes.self) { context in
            HStack {
                Image(systemName: "waveform").foregroundStyle(.red)
                VStack(alignment: .leading) {
                    Text("Recording for \(context.attributes.boxLabel)")
                    Text(context.state.startedAt, style: .timer).monospacedDigit()
                }
                Spacer()
                Link("Stop and Save", destination: URL(string: "beebox://capture/voice?action=stop")!)
            }.padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Image(systemName: "waveform").foregroundStyle(.red) }
                DynamicIslandExpandedRegion(.trailing) { Text(context.state.startedAt, style: .timer) }
                DynamicIslandExpandedRegion(.bottom) {
                    Link("Stop and Save for \(context.attributes.boxLabel)", destination: URL(string: "beebox://capture/voice?action=stop")!)
                }
            } compactLeading: { Image(systemName: "mic.fill").foregroundStyle(.red) }
              compactTrailing: { Text(context.state.startedAt, style: .timer).monospacedDigit() }
              minimal: { Image(systemName: "mic.fill").foregroundStyle(.red) }
        }
    }
}

@main
struct BeeBoxControlsBundle: WidgetBundle {
    var body: some Widget {
        VoiceNoteLiveActivity()
        if #available(iOS 18.0, *) { VoiceNoteControl() }
    }
}
