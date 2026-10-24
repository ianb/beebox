/**
 * A link to an image card opens the image in the lightbox instead of the
 * card page (the card stays one click away through the lightbox's "Open
 * card"). This is the image URL such a link carries as its `data-image-src`.
 *
 * It is the same `/api/image/<path>` URL an embed of that card gets
 * (`resolveImageSrc`), so the lightbox, which dedupes by `src`, counts a
 * card linked and embedded in one document once.
 */

import { cardTypeFromName } from "@shared/card-name";
import { apiImageUrl } from "./view-url";

/** The lightbox `src` for a link to `path`, or `null` when `path` is not an image card. */
export function imageLinkSrc(boxSlug: string, path: string): string | null {
  return cardTypeFromName(path) === "image" ? apiImageUrl(boxSlug, path) : null;
}
