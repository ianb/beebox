/**
 * Which markdown image `src` is a card embed: `![alt](_content/figures/Foo.figure.card?p=v)`.
 * Shared by the card page's embed (`FigureEmbed`) and the view `<Markdown>`
 * (`ViewMarkdown`), so both decide the same way.
 */

import { isUrlRef } from "@shared/ref-path/core";
import { isImagePath } from "./binary-files";
import { resolveContentTarget, type ViewTarget } from "./view-url";

/**
 * The target an image `src` embeds, resolved against the Markdown's base path,
 * or `null` for an ordinary image (an image path, an external URL, or no src).
 * An embed path that escapes the box root is also `null`: it falls through to
 * the default image, whose empty src shows a visibly broken image instead of a
 * silently substituted card.
 */
export function embedTarget(basePath: string | undefined, src: string | undefined): ViewTarget | null {
  if (src === undefined || src === "" || isUrlRef(src) || isImagePath(src)) return null;
  return resolveContentTarget(basePath, src);
}
