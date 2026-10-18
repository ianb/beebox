import BeeBoxMacCore
import Foundation

private let appLogger = MacLogger(category: "app")

/// App-level events (start, stop, image, hosting, sweeps, windows). Goes to the
/// unified log and to `app.log`; see `MacLog`.
func appLog(_ message: String) {
    appLogger.info(message)
}

/// The log file behind `MacLog`: `logs/app.log` in the shared data folder.
/// Kept to about 2 MB: past that the file becomes `app.log.1` (replacing the
/// previous one) and a new one starts.
final class AppLogFile: @unchecked Sendable {
    static let shared = AppLogFile()
    private static let limit: UInt64 = 2_000_000
    private let lock = NSLock()

    func append(_ line: String) {
        lock.withLock {
            let url = Paths.appLog
            let fm = FileManager.default
            if let size = (try? fm.attributesOfItem(atPath: url.path))?[.size] as? UInt64, size > Self.limit {
                let previous = url.appendingPathExtension("1")
                try? fm.removeItem(at: previous)
                try? fm.moveItem(at: url, to: previous)
            }
            if !fm.fileExists(atPath: url.path) {
                try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                fm.createFile(atPath: url.path, contents: nil)
            }
            guard let handle = try? FileHandle(forWritingTo: url) else { return }
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(line.utf8))
        }
    }
}
