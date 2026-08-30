import Foundation

/// The composer's attachment tokens, native half.
///
/// An attachment the user adds to a message is anchored *in the text* by a
/// token: `[image#1]`, `[file#2]`, `[selection#3]`. The web composer holds the
/// same grammar in `beebox/src/shared/composer-tokens.ts`, which this
/// cannot import; `beebox/docs/mobile-contract.md` is the shared
/// statement of record. Change one, change both, change the doc.
///
/// **Write the current form; read both.** The `#` was added 2026-08-25. Drafts
/// persisted on this device before the update, and every message already in a
/// box's transcript, still carry the older `[image1]` form.
enum ComposerToken {
    enum Kind: String {
        case image
        case file
        case selection
    }

    /// The token for `id`, in the current form: `write(.image, 1)` → `[image#1]`.
    static func write(_ kind: Kind, _ id: Int) -> String {
        "[\(kind.rawValue)#\(id)]"
    }

    /// Every spelling of this token, current form first — for matching text
    /// that may predate the rename.
    static func forms(_ kind: Kind, _ id: Int) -> [String] {
        ["[\(kind.rawValue)#\(id)]", "[\(kind.rawValue)\(id)]"]
    }
}
