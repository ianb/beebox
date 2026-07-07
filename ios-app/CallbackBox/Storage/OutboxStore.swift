import Combine
import Foundation

@MainActor
final class OutboxStore: ObservableObject {
    @Published private(set) var messages: [QueuedMessage] = []

    private let storageURL: URL

    init() {
        let supportDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        storageURL = supportDirectory.appendingPathComponent("outbox.json")
        load()
    }

    func messages(for box: PairedBox) -> [QueuedMessage] {
        messages
            .filter { $0.boxID == box.id }
            .sorted { $0.createdAt < $1.createdAt }
    }

    func enqueue(
        text: String,
        origin: QueuedMessage.Origin,
        diarized: Bool = false,
        images: [ChatImageAttachment],
        for box: PairedBox
    ) -> QueuedMessage {
        let message = QueuedMessage(boxID: box.id, origin: origin, text: text, diarized: diarized, images: images)
        messages.append(message)
        save()
        return message
    }

    func retryPending(for box: PairedBox) async {
        let candidates = messages(for: box).filter { $0.state != .sending }
        for message in candidates {
            await send(messageID: message.id, box: box)
        }
    }

    func send(messageID: QueuedMessage.ID, box: PairedBox) async {
        guard let index = messages.firstIndex(where: { $0.id == messageID }) else {
            return
        }
        guard messages[index].boxID == box.id else {
            return
        }

        messages[index].state = .sending
        messages[index].attemptCount += 1
        messages[index].lastError = nil
        save()

        let queuedMessage = messages[index]
        do {
            _ = try await ChatAPI(box: box).send(
                message: queuedMessage.text,
                messageId: queuedMessage.messageID,
                origin: queuedMessage.origin,
                diarized: queuedMessage.diarized,
                images: queuedMessage.images
            )
            messages.removeAll { $0.id == queuedMessage.id }
        } catch {
            guard let failedIndex = messages.firstIndex(where: { $0.id == queuedMessage.id }) else {
                return
            }
            messages[failedIndex].state = .failed
            messages[failedIndex].lastError = error.localizedDescription
        }
        save()
    }

    func discard(_ message: QueuedMessage) {
        messages.removeAll { $0.id == message.id }
        save()
    }

    private func load() {
        do {
            let data = try Data(contentsOf: storageURL)
            let snapshot = try JSONDecoder().decode(OutboxSnapshot.self, from: data)
            messages = snapshot.messages.map { message in
                var normalized = message
                if normalized.state == .sending {
                    normalized.state = .pending
                }
                return normalized
            }
        } catch {
            messages = []
        }
    }

    private func save() {
        do {
            try FileManager.default.createDirectory(
                at: storageURL.deletingLastPathComponent(),
                withIntermediateDirectories: true,
                attributes: nil
            )
            let snapshot = OutboxSnapshot(messages: messages)
            let data = try JSONEncoder().encode(snapshot)
            try data.write(to: storageURL, options: [.atomic])
        } catch {
            assertionFailure("Failed to save outbox: \(error)")
        }
    }
}

private struct OutboxSnapshot: Codable {
    var messages: [QueuedMessage]
}
