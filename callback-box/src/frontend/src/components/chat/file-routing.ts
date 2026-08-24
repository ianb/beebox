/**
 * Where a set of files handed to the chat composer goes: inline in the message
 * being composed, or up as a bulk batch
 * (`docs/plans/chat-photo-batch-upload.md`, Track 2).
 *
 * The composer's Add menu asks one thing — "Add files…" — and this decides the
 * rest, so the user never has to know the two paths exist (the menu used to
 * offer both, under labels that read as synonyms:
 * `issues/features/2026-08-03-attach-vs-upload-menu-confusing.md`). Every entry
 * point routes through here: the picker, paste, drop, and the screenshot grab.
 *
 * A few photos belong *in* the message: the agent sees them in the turn,
 * alongside whatever the boxholder typed. A camera roll does not — inlining it
 * base64-encodes tens of megabytes into one `/chat/send` request, which is the
 * bug this threshold exists to prevent (`issues/bugs/2026-07-30-many-photos-to-chat-fails-ios.md`:
 * 70 photos failed client-side with no server-side trace at all, because the
 * request never left the device). Above the limit the photos are uploaded and
 * referenced instead, via the bulk-upload pipeline.
 *
 * Anything that is not an image batches regardless of count: only images have
 * an inline in-message representation at all, and a document is something to
 * file rather than something for the model to look at mid-sentence.
 *
 * **The photo-limit half of this rule is duplicated in the iOS composer**, which
 * cannot import it — the shared statement of record is `docs/mobile-contract.md`.
 * Change one, change both, and change the doc.
 */

/**
 * The most photos allowed to ride inline in a single chat message.
 *
 * Deliberately well below where the payload actually breaks. There is no
 * documented size ceiling for a WKWebView script message — the failure is memory
 * pressure, not a published limit — so inlining "just under the cliff" is not a
 * thing that can be done safely. Keeping the inline payload categorically small
 * is the sound posture; the exact number is a product judgment (boxholder,
 * 2026-08-22), not a technical maximum.
 */
export const INLINE_PHOTO_LIMIT = 3;

/** Where a newly-added set of files should go. */
export type FileRoute = "inline" | "batch";

/** The one property routing reads off a file — the MIME type the browser gave it. */
export interface RoutableFile {
  readonly type: string;
}

/**
 * Decide where a newly-picked (or pasted, dropped, or captured) set of files
 * goes.
 *
 * Evaluated against the composer's *current* inline count as well as the new
 * selection, so the inline total can never exceed {@link INLINE_PHOTO_LIMIT}
 * however many separate selections a user makes.
 *
 * `existingInline` must count photos still *encoding*, not just finished ones.
 * Image processing is async: two three-photo pastes in quick succession would
 * both see zero finished images, both take the inline path, and land six
 * inline photos — the bound broken by exactly the race it exists to prevent.
 */
export function routeAddedFiles(opts: {
  files: readonly RoutableFile[];
  existingInline: number;
}): FileRoute {
  const { files, existingInline } = opts;
  // Nothing to route. Callers return early on an empty set anyway; saying
  // "inline" here keeps the empty case from opening an empty batch overlay.
  if (files.length === 0) return "inline";
  if (files.some((file) => !file.type.startsWith("image/"))) return "batch";
  return existingInline + files.length > INLINE_PHOTO_LIMIT ? "batch" : "inline";
}
