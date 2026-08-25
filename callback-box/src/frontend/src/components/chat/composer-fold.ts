/**
 * Folding the composer's inline photos into a bulk batch, and putting them back.
 *
 * When a file set routes to the batch path (`file-routing.ts`), the photos
 * already sitting in the composer go with it, so one selection act has one
 * destination and the composer text describes the whole batch rather than half
 * of it. That is a destructive edit made on an optimistic assumption: that the
 * batch will be delivered. When it isn't — the user cancels, discards, or hits
 * Escape — the assumption has to be undone. Cancelling an upload is not a
 * request to discard photos you had already attached
 * (`issues/bugs/2026-08-22-batch-cancel-loses-folded-composer-photos.md`).
 *
 * So the fold is written as a pair: {@link foldComposerImages} returns
 * everything needed to reverse itself, and {@link restoreFoldedImages} reverses
 * it. `use-bulk-upload-launch.ts` holds the value in between and decides which
 * exit gets the restore. Kept out of that hook so the round trip is a plain
 * function of the store and can be tested as one.
 */

import type { EmissionStore, ImageItem } from "../../input/emission-store";
import { extensionForImageType } from "../../lib/image-paste";

/** A fold, and everything needed to undo it. */
export interface ComposerFold {
  /** The folded photos, ready to re-add — object URLs still live. */
  images: readonly ImageItem[];
  /** Composer text as it stood BEFORE the fold stripped the `[image#N]` tokens. */
  text: string;
  /** The same photos as `File`s, to seed the batch with. */
  files: File[];
}

/**
 * Turn an already-encoded composer image back into a `File` so it can join a
 * batch. The store holds the downscaled bytes as base64 (that is what an inline
 * send transmits), so this decodes rather than re-reading the original pick.
 */
function composerImageToFile(image: ImageItem): File {
  // `atob` yields one latin-1 char per byte, so each code point IS the byte.
  const bytes = Uint8Array.from(atob(image.dataBase64), (char) => char.codePointAt(0) ?? 0);
  const name = `pasted-image-${String(image.id)}.${extensionForImageType(image.mimeType)}`;
  return new File([bytes], name, { type: image.mimeType });
}

/**
 * Take the composer's inline photos out and hand them back as batch files.
 * Returns null when there were none — there is then nothing to restore later.
 *
 * Photos still ENCODING are not folded (there are no bytes yet) and are
 * deliberately left alone: they finish and land inline, going out with the next
 * ordinary send.
 *
 * Removed one at a time by id — NOT via `reset("attachments")`, which also
 * clears `files` and would silently drop an unrelated attachment (a PDF the
 * user attached alongside) that isn't joining the batch. `removeImage` also
 * strips each `[image#N]` token from the text, so the note doesn't ship
 * references to photos that are no longer described by it.
 *
 * Object URLs are NOT revoked. They were, and a cancelled batch then had no way
 * back — the bytes survived but every preview was dead. They cost nothing while
 * one overlay is open; the caller releases them once the photos have actually
 * landed somewhere else.
 */
export function foldComposerImages(emissionStore: EmissionStore): ComposerFold | null {
  const draft = emissionStore.get();
  const images = draft.images;
  if (images.length === 0) return null;
  const fold: ComposerFold = { images, text: draft.text, files: images.map(composerImageToFile) };
  for (const image of images) emissionStore.editor.removeImage(image.id);
  return fold;
}

/**
 * Put a fold back: the photos, and the text with its `[image#N]` tokens.
 *
 * The text is restored as a snapshot rather than by re-inserting each token,
 * which is sound only because the composer is unreachable while the overlay is
 * open (it is a full-screen modal) — there is nothing newer to clobber.
 *
 * `restoreImages` rather than `addImage`: nothing here is a pending encode
 * landing, and decrementing that counter would strand a placeholder tile the
 * composer is still showing for a photo that is genuinely mid-encode.
 */
export function restoreFoldedImages(emissionStore: EmissionStore, fold: ComposerFold): void {
  emissionStore.editor.restoreImages(fold.images);
  emissionStore.editor.setText(fold.text);
}

/** Release a fold's previews, once its photos have landed somewhere else. */
export function releaseFoldedImages(fold: ComposerFold): void {
  for (const image of fold.images) {
    try { URL.revokeObjectURL(image.objectUrl); } catch (_e) { /* already revoked — harmless */ }
  }
}
