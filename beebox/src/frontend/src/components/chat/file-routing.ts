/**
 * How a set of files handed to the chat composer is *represented* in the
 * message being written: inline in the send payload, or uploaded and referenced
 * by token.
 *
 * The composer's Add menu asks one thing — "Add files…" — and this decides the
 * rest, so the user never has to know two representations exist (the menu used
 * to offer both, under labels that read as synonyms:
 * `issues/features/2026-08-03-attach-vs-upload-menu-confusing.md`). Every entry
 * point routes through here: the picker, paste, drop, and the screenshot grab.
 *
 * **Both outcomes land in the message the user is writing.** That is the whole
 * point of the split, and the thing an earlier version of this file got wrong:
 * merging the two menu entries also routed every non-image to the full-screen
 * bulk-upload overlay, which seals and sends a message *of its own* — so
 * attaching a PDF to a sentence you were in the middle of became impossible
 * (`issues/bugs/2026-09-06-add-files-cannot-attach-a-couple-of-files-inline.md`).
 * Routing chooses a representation, never a destination.
 *
 * The two representations:
 *
 * - **inline** — a photo, downscaled and base64-encoded into the `/chat/send`
 *   body, anchored by an `[image#N]` token. The agent sees the pixels in the
 *   turn. Bounded by {@link INLINE_PHOTO_LIMIT}, because this is the one thing
 *   that puts bytes in the send: inlining a camera roll encodes tens of
 *   megabytes into a single request, which is the reported failure
 *   (`issues/bugs/2026-07-30-many-photos-to-chat-fails-ios.md` — 70 photos
 *   failed client-side with no server-side trace at all, because the request
 *   never left the device).
 * - **upload** — everything else: any non-image, and photos over the inline
 *   limit. Uploaded to the box ahead of the send and anchored by a `[file#N]`
 *   token carrying only its path, so it adds nothing to the send payload
 *   however large it is. No count or size limit applies — the cost that would
 *   justify one isn't there.
 *
 * A selection accumulates rather than replacing: the counts are read off the
 * composer's current contents, so picking twice before sending builds one
 * message. (On iOS a pick is per-source — photos or files, not both at once —
 * which is why picking twice has to keep working.)
 */

/**
 * The most photos allowed to ride inline in a single chat message. Photos past
 * it aren't refused — they take the upload representation instead.
 *
 * Deliberately well below where the payload actually breaks. There is no
 * documented size ceiling for a WKWebView script message — the failure is memory
 * pressure, not a published limit — so inlining "just under the cliff" is not a
 * thing that can be done safely. Keeping the inline payload categorically small
 * is the sound posture; the exact number is a product judgment (boxholder,
 * 2026-08-22), not a technical maximum.
 */
export const INLINE_PHOTO_LIMIT = 3;

/** The one property routing reads off a file — the MIME type the browser gave it. */
export interface RoutableFile {
  readonly type: string;
}

/**
 * A selection split by representation. Both halves belong to the same message;
 * either may be empty.
 */
export interface RoutedFiles<T> {
  /** Photos to downscale, encode, and anchor with `[image#N]`. */
  readonly inline: T[];
  /** Files to upload ahead of the send and anchor with `[file#N]`. */
  readonly upload: T[];
}

function isPhoto(file: RoutableFile): boolean {
  return file.type.startsWith("image/");
}

/**
 * Split a newly-picked (or pasted, dropped, or captured) set of files by how
 * each should be represented in the message.
 *
 * Evaluated against the composer's *current* inline photo count as well as the
 * new selection, so the inline total can never exceed
 * {@link INLINE_PHOTO_LIMIT} however many separate selections a user makes.
 *
 * `existingInlinePhotos` must count photos still *encoding*, not just finished
 * ones. Image processing is async: two three-photo pastes in quick succession
 * would both see zero finished images, both inline, and land six inline photos
 * — the bound broken by exactly the race it exists to prevent.
 *
 * When the photos don't fit, the *whole* selection takes the upload
 * representation — the photos included. Inlining some of a selection and
 * uploading the rest would scatter one act across two representations for no
 * reason the user could predict.
 */
export function routeAddedFiles<T extends RoutableFile>(opts: {
  files: readonly T[];
  existingInlinePhotos: number;
}): RoutedFiles<T> {
  const { files, existingInlinePhotos } = opts;
  const photos = files.filter(isPhoto);
  if (existingInlinePhotos + photos.length > INLINE_PHOTO_LIMIT) {
    return { inline: [], upload: [...files] };
  }
  return { inline: photos, upload: files.filter((file) => !isPhoto(file)) };
}
