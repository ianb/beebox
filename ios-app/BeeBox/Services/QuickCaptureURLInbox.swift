import Combine
import Foundation

/// Native task URLs are distinct from pairing URLs and never select the browsed box.
@MainActor
final class QuickCaptureURLInbox: ObservableObject {
    static let shared = QuickCaptureURLInbox()
    @Published private(set) var pendingURL: URL?
    static func handles(_ url: URL) -> Bool { url.scheme == "beebox" && url.host == "capture" && url.path == "/voice" }
    func accept(_ url: URL) { if Self.handles(url) { pendingURL = url } }
    func clear(_ url: URL) { if pendingURL == url { pendingURL = nil } }
}
