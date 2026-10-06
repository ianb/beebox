import Foundation

/// The app's own log (start, stop, image, and failure lines), in the state
/// folder beside the box's log. A bundled app's NSLog output is hard to find,
/// and these lines are what a failed start is diagnosed from.
func appLog(_ message: String) {
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
    FileHandle.standardError.write(Data(line.utf8))
    AppLogFile.shared.append(line)
}

private final class AppLogFile: @unchecked Sendable {
    static let shared = AppLogFile()
    private let lock = NSLock()

    func append(_ line: String) {
        lock.withLock {
            let url = Paths.appLog
            if !FileManager.default.fileExists(atPath: url.path) {
                try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                FileManager.default.createFile(atPath: url.path, contents: nil)
            }
            guard let handle = try? FileHandle(forWritingTo: url) else { return }
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(line.utf8))
        }
    }
}
