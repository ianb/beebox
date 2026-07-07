import Foundation

struct QueuedMessage: Codable, Equatable, Identifiable {
    enum Origin: String, Codable {
        case typed
        case voice
    }

    enum State: String, Codable {
        case pending
        case sending
        case failed
    }

    var id: UUID
    var boxID: PairedBox.ID
    var messageID: String
    var origin: Origin
    var text: String
    var diarized: Bool
    var images: [ChatImageAttachment]
    var createdAt: Date
    var attemptCount: Int
    var lastError: String?
    var state: State

    init(boxID: PairedBox.ID, origin: Origin, text: String, diarized: Bool, images: [ChatImageAttachment]) {
        id = UUID()
        self.boxID = boxID
        messageID = "ios-\(id.uuidString)"
        self.origin = origin
        self.text = text
        self.diarized = diarized
        self.images = images
        createdAt = Date()
        attemptCount = 0
        lastError = nil
        state = .pending
    }
}
