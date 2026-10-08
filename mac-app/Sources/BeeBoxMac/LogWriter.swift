import Containerization
import Foundation

/// Appends the box's stdout/stderr to a log file and watches for the
/// first-run setup link the server prints once.
final class LogWriter: Writer, @unchecked Sendable {
    private let handle: FileHandle
    private let lock = NSLock()
    private var pending = ""
    private var setupPath: String?
    private var recoveryNeeded = false

    init(url: URL) throws {
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        handle = try FileHandle(forWritingTo: url)
        try handle.seekToEnd()
    }

    /// Path and query of the first-run setup link, e.g. `/auth/setup?token=…`.
    var firstRunSetupPath: String? {
        lock.withLock { setupPath }
    }

    /// The entrypoint stopped before serving because convergence (migrating
    /// the box to this engine) needs a human: a failed migration, or a box
    /// already migrated by a newer version than this one.
    var needsRecovery: Bool {
        lock.withLock { recoveryNeeded }
    }

    func write(_ data: Data) throws {
        try lock.withLock {
            try handle.write(contentsOf: data)
            pending += String(decoding: data, as: UTF8.self)
            while let newline = pending.firstIndex(of: "\n") {
                scan(line: String(pending[..<newline]))
                pending.removeSubrange(...newline)
            }
        }
    }

    func close() throws {
        try lock.withLock { try handle.close() }
    }

    private func scan(line: String) {
        if line.contains("convergence needs recovery") {
            recoveryNeeded = true
        }
        guard let range = line.range(of: "First-run setup: "),
              let url = URL(string: String(line[range.upperBound...]).trimmingCharacters(in: .whitespaces))
        else { return }
        setupPath = url.path + (url.query.map { "?\($0)" } ?? "")
    }
}
