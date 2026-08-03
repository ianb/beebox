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
}

/// Native logging facade: unified logging always, plus forwarding to the paired
/// box's `client-debug.log` for `error` and `warn`.
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
/// `info` is on-device only; it is never forwarded (mirroring the web
/// forwarder's always-forward-error/warn, never-forward-info split).
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
