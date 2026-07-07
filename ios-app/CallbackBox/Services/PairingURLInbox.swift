import Combine
import Foundation

@MainActor
final class PairingURLInbox: ObservableObject {
    static let shared = PairingURLInbox()

    @Published private(set) var pendingURL: URL?

    private init() {}

    func accept(_ url: URL) {
        pendingURL = url
    }

    func clear(_ url: URL) {
        guard pendingURL == url else {
            return
        }
        pendingURL = nil
    }
}
