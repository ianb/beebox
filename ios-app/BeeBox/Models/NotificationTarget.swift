import Foundation

/// Where tapping a notification lands: the Swift mirror of the box's
/// `src/core/notification/target.ts` (`parseTarget` + `targetUrl`).
///
/// The APNs payload carries the target string, not a URL (contract §5.10), so
/// the phone renders it against the paired box. `boxPath` is `targetUrl` with
/// the leading `/<slug>/` removed, because a paired box's `baseURL` already
/// ends in the slug. `NotificationTargetTests` runs the TypeScript doctest's
/// cases (`beebox/test/core/notification/target.doctest.md`); a change to the
/// rules there changes them here.
///
/// One rule is looser than the box's: a card path must normalize to a path
/// whose first segment starts with `_`, where the box checks the exact list of
/// underscore areas. The box already canonicalized the target before sending
/// it, and the browse route fences the path again when the page loads.
enum NotificationTarget: Equatable {
    case chat(sessionID: String)
    case chatNew
    case card(path: String)
    case question(path: String)
    case admin(section: String)
    case dashboard

    /// `target.ts` `MAX_TARGET_CHARS`, counted in UTF-16 units like JS `length`.
    static let maxCharacters = 1000
    /// `SYSTEM_CARD_PATHS.admin` in `src/shared/system-card-paths.ts`.
    static let adminCardPath = "_config/interface/admin.card"

    init?(_ value: String) {
        guard value.utf16.count <= Self.maxCharacters else {
            return nil
        }
        if value == "dashboard" {
            self = .dashboard
            return
        }
        if value == "chat:new" {
            self = .chatNew
            return
        }
        guard let colon = value.firstIndex(of: ":") else {
            return nil
        }
        let scheme = String(value[..<colon])
        let rest = String(value[value.index(after: colon)...])
        guard rest.isEmpty == false else {
            return nil
        }
        switch scheme {
        case "chat":
            let delimiters = CharacterSet(charactersIn: "#&/?").union(.whitespacesAndNewlines)
            guard rest.unicodeScalars.contains(where: { delimiters.contains($0) }) == false else {
                return nil
            }
            self = .chat(sessionID: rest)
        case "card":
            guard let path = Self.cardPath(rest) else { return nil }
            self = .card(path: path)
        case "question":
            guard let path = Self.cardPath(rest) else { return nil }
            self = .question(path: path)
        case "admin":
            guard Self.isAdminSectionID(rest) else { return nil }
            self = .admin(section: rest)
        default:
            return nil
        }
    }

    /// The box-relative deep link: `targetUrl` without its `/<slug>/` prefix.
    func boxPath(notificationID: String) -> String {
        switch self {
        case .chat(let sessionID):
            "chat?session=\(Self.encodeURIComponent(sessionID))"
        case .chatNew:
            "chat?new=1&notification=\(Self.encodeURIComponent(notificationID))"
        case .card(let path), .question(let path):
            "browse/\(path)"
        case .admin(let section):
            // JSON.stringify({ section }) — the section id is [0-9a-z-], so no escaping.
            "views/\(Self.adminCardPath)?viewState=\(Self.encodeURIComponent("{\"section\":\"\(section)\"}"))"
        case .dashboard:
            ""
        }
    }

    /// `resolveRefPath({ fromPath: undefined, ref, kind: "card" })`: resolved
    /// from the box root, `.` and empty segments dropped, `..` refused when it
    /// would climb out, and the result fenced to an underscore area.
    private static func cardPath(_ ref: String) -> String? {
        var out: [Substring] = []
        for part in ref.split(separator: "/", omittingEmptySubsequences: false) {
            if part.isEmpty || part == "." {
                continue
            }
            if part == ".." {
                guard out.isEmpty == false else { return nil }
                out.removeLast()
                continue
            }
            out.append(part)
        }
        guard let first = out.first, first.hasPrefix("_") else {
            return nil
        }
        return out.joined(separator: "/")
    }

    /// `/^[\da-z]+(-[\da-z]+)*$/`
    private static func isAdminSectionID(_ value: String) -> Bool {
        let words = value.split(separator: "-", omittingEmptySubsequences: false)
        return words.allSatisfy { word in
            word.isEmpty == false && word.unicodeScalars.allSatisfy { scalar in
                ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar)
            }
        }
    }

    /// JavaScript `encodeURIComponent`: everything but ASCII letters, digits,
    /// and `-_.!~*'()` is percent-encoded as UTF-8.
    static func encodeURIComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: uriComponentAllowed) ?? value
    }

    private static let uriComponentAllowed: CharacterSet = {
        var set = CharacterSet()
        set.insert(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!~*'()")
        return set
    }()
}

/// One tapped notification's custom keys (contract §5.10).
struct NotificationTap: Equatable {
    var target: String?
    var notificationID: String?
    /// The sending box's slug; absent from a box older than the `box` key.
    var box: String?

    init(target: String?, notificationID: String?, box: String? = nil) {
        self.target = target
        self.notificationID = notificationID
        self.box = box
    }

    init(userInfo: [AnyHashable: Any]) {
        target = userInfo["target"] as? String
        notificationID = userInfo["notificationId"] as? String
        box = (userInfo["box"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    }

    /// Which paired box a tap opens on, and why (the reason is logged).
    enum BoxChoice: Equatable {
        /// A paired box's slug (its `baseURL` last path component) is `box`.
        case matched(PairedBox)
        /// Several paired boxes share the slug (two hosts, or two dev
        /// checkouts); the selected one if it is among them, else the first.
        case ambiguous(PairedBox, matches: Int)
        /// `box` is absent or names no paired box: the only box, or the
        /// selected one when several are paired.
        case fallback(PairedBox, boxKeyPresent: Bool)
        case none
    }

    func pairedBox(in boxes: [PairedBox], selected: PairedBox?) -> BoxChoice {
        if let box {
            let matches = boxes.filter { $0.slug == box }
            if matches.count == 1, let only = matches.first {
                return .matched(only)
            }
            if let first = matches.first {
                let chosen = matches.first { $0.id == selected?.id } ?? first
                return .ambiguous(chosen, matches: matches.count)
            }
        }
        guard let fallback = boxes.count == 1 ? boxes.first : selected else {
            return .none
        }
        return .fallback(fallback, boxKeyPresent: box != nil)
    }

    /// The target's scheme alone, for logs: a target can carry a card path or
    /// session id, which stay out of forwarded diagnostics.
    var scheme: String {
        guard let target else { return "none" }
        return target.split(separator: ":", maxSplits: 1).first.map(String.init) ?? "none"
    }

    /// The box-relative path the tap opens, or nil when the target is missing
    /// or unreadable (the app then opens the box's chat as usual).
    var boxPath: String? {
        guard let target, let parsed = NotificationTarget(target) else {
            return nil
        }
        return parsed.boxPath(notificationID: notificationID ?? "")
    }
}

/// The `loudness` key of an APNs payload (contract §5.10). `dot` payloads omit
/// the key, so absence means `dot`.
enum NotificationLoudness: String, Equatable {
    case dot
    case quiet
    case loud

    init(userInfo: [AnyHashable: Any]) {
        guard let raw = userInfo["loudness"] as? String else {
            self = .dot
            return
        }
        // An unknown value from a newer box shows nothing while the app is open
        // (the webview shows its own banner), the same as `quiet`.
        self = NotificationLoudness(rawValue: raw) ?? .quiet
    }
}
