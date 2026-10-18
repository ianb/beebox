import Foundation
import os

/// The app's one log. Every line goes to the unified system log (subsystem
/// `run.beebox.mac`, read with `log show --predicate 'subsystem ==
/// "run.beebox.mac"'`) and to the app's log file (`app.log` in the shared
/// data folder), so a person or an agent can read what happened afterward.
///
/// Log stable names and bounded metadata: states, counts, statuses, token
/// names, folder names. Never a token, a pairing link, file contents, or a
/// full URL with a query.
public struct MacLogger: Sendable {
    private let category: String
    private let logger: Logger

    public init(category: String) {
        self.category = category
        logger = Logger(subsystem: MacLog.subsystem, category: category)
    }

    public func info(_ message: String) {
        logger.info("\(message, privacy: .public)")
        MacLog.write(level: "info", category: category, message: message)
    }

    public func warning(_ message: String) {
        logger.warning("\(message, privacy: .public)")
        MacLog.write(level: "warn", category: category, message: message)
    }

    public func error(_ message: String) {
        logger.error("\(message, privacy: .public)")
        MacLog.write(level: "error", category: category, message: message)
    }
}

public enum MacLog {
    public static let subsystem = "run.beebox.mac"
    private static let state = OSAllocatedUnfairLock<(@Sendable (String) -> Void)?>(initialState: nil)

    /// Where file lines go; the app sets it once at launch. Tests leave it
    /// unset, so they write only to the unified log.
    public static func setFileSink(_ sink: @escaping @Sendable (String) -> Void) {
        state.withLock { $0 = sink }
    }

    static func write(level: String, category: String, message: String) {
        guard let sink = state.withLock({ $0 }) else { return }
        let stamp = Date().formatted(.iso8601)
        sink("\(stamp) \(level) \(category): \(message)\n")
    }
}
