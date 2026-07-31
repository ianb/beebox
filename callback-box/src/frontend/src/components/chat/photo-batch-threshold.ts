/**
 * When a photo selection is too big to ride inline in a chat message
 * (`docs/plans/chat-photo-batch-upload.md`, Track 2).
 *
 * A few photos belong *in* the message: the agent sees them in the turn,
 * alongside whatever the boxholder typed. A camera roll does not — inlining it
 * base64-encodes tens of megabytes into one `/chat/send` request, which is the
 * bug this threshold exists to prevent (`issues/bugs/2026-07-30-many-photos-to-chat-fails-ios.md`:
 * 70 photos failed client-side with no server-side trace at all, because the
 * request never left the device). Above the limit the photos are uploaded and
 * referenced instead, via the bulk-upload pipeline.
 *
 * **This rule is duplicated in the iOS composer**, which cannot import it — the
 * shared statement of record is `docs/mobile-contract.md`. Change one, change
 * both, and change the doc.
 */

/**
 * The most photos allowed to ride inline in a single chat message.
 *
 * Deliberately well below where the payload actually breaks. There is no
 * documented size ceiling for a WKWebView script message — the failure is memory
 * pressure, not a published limit — so inlining "just under the cliff" is not a
 * thing that can be done safely. Keeping the inline payload categorically small
 * is the sound posture; the exact number is a product judgment (boxholder,
 * 2026-07-30), not a technical maximum.
 */
export const INLINE_PHOTO_LIMIT = 4;

/**
 * True when a newly-picked (or pasted, or dropped) set of photos should be
 * uploaded as a batch instead of inlined.
 *
 * Evaluated against the composer's *current* inline count as well as the new
 * selection, so the inline total can never exceed {@link INLINE_PHOTO_LIMIT}
 * however many separate selections a user makes.
 *
 * `existingInline` must count photos still *encoding*, not just finished ones.
 * Image processing is async: two four-photo pastes in quick succession would
 * both see zero finished images, both take the inline path, and land eight
 * inline photos — the bound broken by exactly the race it exists to prevent.
 */
export function shouldBatchPhotos(opts: { existingInline: number; incoming: number }): boolean {
  return opts.existingInline + opts.incoming > INLINE_PHOTO_LIMIT;
}
