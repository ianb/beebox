import ActivityKit
import Foundation

struct VoiceNoteActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var startedAt: Date
        var isRecording: Bool
    }
    var recordingID: UUID
    var boxLabel: String
}
