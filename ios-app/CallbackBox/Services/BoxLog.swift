import Foundation
import os

/// The subsystem every logger in the app shares (`AudioSessionRouting` set the
/// precedent). Categories below join it rather than inventing subsystems.
enum BoxLogCategory: String, Codable, CaseIterable, Sendable {
    case capture
    case upload
    case net
    case pairing
    case composer
    case webview
    case lifecycle
    case audio
}

/// Native logging facade: unified logging always, plus forwarding to the paired
/// box's `client-debug.log` for all three levels.
///
/// **Message discipline — metadata only.** A forwarded message leaves the
/// device, so it may carry only what a diagnosis needs: session/item ids,
/// counts, byte sizes, HTTP status codes, `URLError.Code` values, attempt
/// numbers, elapsed times, filenames that are already destined for the box, and
/// error text that originates from the box server or from Foundation. It must
/// NEVER carry media bytes, transcript or composer text, auth tokens or
/// `Authorization` values, or full request bodies. The forwarder redacts known
/// device tokens as a backstop, but that backstop cannot see prose the caller
/// chose to interpolate — the discipline lives at the call site.
///
/// **Two durability tiers.**
/// - `BoxLog.error` / `BoxLog.warn` are synchronous fire-and-forget: they hand
///   the entry to `LogForwarder` inside a `Task`, so a crash in the same
///   instant can lose that one entry. This is the general-purpose tier.
/// - `await LogForwarder.shared.record(...)` is the awaitable tier: it returns
///   only once the entry has been enqueued and its write attempted (the write
///   is best-effort — a filesystem failure is visible in unified logging only).
///   Critical failure boundaries — capture
///   upload completion/failure, the background-session completion path — use
///   that tier directly, because those are exactly the failures a suspension or
///   crash would otherwise erase.
///
enum BoxLog {
    static func error(_ message: String, category: BoxLogCategory) {
        logger(for: category).error("\(message, privacy: .public)")
        forward(.error, message: message, category: category)
    }

    static func warn(_ message: String, category: BoxLogCategory) {
        logger(for: category).warning("\(message, privacy: .public)")
        forward(.warn, message: message, category: category)
    }

    static func info(_ message: String, category: BoxLogCategory) {
        logger(for: category).info("\(message, privacy: .public)")
        forward(.info, message: message, category: category)
    }

    /// Fire-and-forget an info line for a known box. UI callbacks already carry
    /// this identity, so preserve it instead of resolving the selected box
    /// later when the actor happens to service the task.
    static func info(_ message: String, category: BoxLogCategory, targetBoxID: UUID) {
        logger(for: category).info("\(message, privacy: .public)")
        Task {
            await LogForwarder.shared.record(
                level: .info,
                category: category,
                message: message,
                boxID: targetBoxID
            )
        }
    }

    /// Fire-and-forget a warning for a known box. Same identity reasoning as the
    /// targeted `info` overload: a warning about a wedged state is worthless if a
    /// box switch reattributes it.
    static func warn(_ message: String, category: BoxLogCategory, targetBoxID: UUID) {
        logger(for: category).warning("\(message, privacy: .public)")
        Task {
            await LogForwarder.shared.record(
                level: .warn,
                category: category,
                message: message,
                boxID: targetBoxID
            )
        }
    }

    static func logger(for category: BoxLogCategory) -> Logger {
        loggers[category] ?? Logger(subsystem: subsystem, category: category.rawValue)
    }

    static let subsystem = "app.callbackbox.ios"

    private static let loggers: [BoxLogCategory: Logger] = Dictionary(
        uniqueKeysWithValues: BoxLogCategory.allCases.map { category in
            (category, Logger(subsystem: subsystem, category: category.rawValue))
        }
    )

    private static func forward(_ level: BoxLogLevel, message: String, category: BoxLogCategory) {
        Task {
            await LogForwarder.shared.record(level: level, category: category, message: message)
        }
    }
}
