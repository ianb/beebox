import Foundation

/// When a photo selection is too big to ride inline in a chat message.
///
/// **Mirrored constant.** The web composer holds the same rule in
/// `callback-box/src/frontend/src/components/chat/file-routing.ts`
/// (`INLINE_PHOTO_LIMIT` / `routeAddedFiles`). Swift cannot import it, so the
/// two are kept honest by `callback-box/docs/mobile-contract.md` §8 — change one,
/// change both, and change the doc.
///
/// A few photos belong *in* the message: the agent sees them in the turn with
/// whatever the boxholder typed. A camera roll does not — inlining it
/// base64-encodes tens of megabytes into a single `/chat/send`, and on iOS that
/// payload also has to cross the WKWebView bridge first. That is the reported
/// failure: 70 photos aborted client-side with no server-side trace at all,
/// because the request never left the device
/// (`issues/bugs/2026-07-30-many-photos-to-chat-fails-ios.md`).
enum BulkPhotoThreshold {
    /// The most photos allowed to ride inline in one chat message.
    ///
    /// Deliberately well below where the payload actually breaks. There is no
    /// documented size ceiling for a `WKScriptMessage` — the failure is memory
    /// pressure, not a published limit — so "inline just under the cliff" is not
    /// implementable. Keeping the inline payload categorically small is the sound
    /// posture; the number itself is a product judgment, not a technical maximum.
    static let inlineLimit = 3

    /// True when a newly-picked selection should be uploaded as a batch rather
    /// than inlined.
    ///
    /// Counts the photos already in the composer as well as the new ones, so the
    /// inline total can never exceed ``inlineLimit`` however many separate
    /// selections a user makes. Photos already inline stay inline — they go out
    /// with the next ordinary send.
    static func shouldBatch(existingInline: Int, incoming: Int) -> Bool {
        existingInline + incoming > inlineLimit
    }
}
