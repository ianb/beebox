/**
 * An emoji's Twemoji artwork, as a file on disk.
 *
 * A box's mark is usually an emoji, and several surfaces need it as a real
 * raster: a notification icon must be a PNG (Chrome will not render an SVG
 * one), and so must anything an OS draws for an installed app. Rendering the
 * character as *text* was measured and rejected — librsvg draws emoji as
 * monochrome line art even where a colour emoji font is installed, and the
 * deployed server installs no emoji font at all, so text rendering there would
 * produce a blank square.
 *
 * Twemoji ships one SVG per emoji as pure *shapes*. Rasterizing a shape needs
 * no font and comes out in full colour at any size, which is why the artwork
 * is a dependency rather than a font being one.
 *
 * Artwork is CC-BY 4.0 (Twitter/X) — see `docs/attribution.md`. The package is
 * a normal runtime dependency, and the deploy installs the full tree, so
 * resolving it through `createRequire` works on the server as it does here.
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import * as path from "node:path";

const require_ = createRequire(import.meta.url);

/** Directory holding Twemoji's flat `<codepoints>.svg` files. */
const assetDir = path.dirname(require_.resolve("@twemoji/svg/package.json"));

/** Zero-width joiner. Its presence changes how VS16 is treated — see below. */
const ZWJ = "‍";
/** Variation selector 16, the "render the previous character as emoji" mark. */
const VS16 = /️/g;

/**
 * The codepoint sequence Twemoji names a file after, e.g. `1f4e6`,
 * `2697`, `1f469-200d-1f373`.
 *
 * VS16 is dropped, because Twemoji's filenames omit it — `⚗️` (U+2697 U+FE0F)
 * is `2697.svg`. The exception is a ZWJ sequence, where the selector is part
 * of how the sequence is spelled and Twemoji keeps it. This is Twemoji's own
 * rule, and getting it backwards silently resolves to a missing file.
 */
export function twemojiCodePoints(emoji: string): string {
  const normalized = emoji.includes(ZWJ) ? emoji : emoji.replace(VS16, "");
  return [...normalized].map((ch) => ch.codePointAt(0)?.toString(16) ?? "").join("-");
}

/**
 * Absolute path to `emoji`'s Twemoji SVG, or null when there is no artwork for
 * it.
 *
 * Null is an ordinary answer, not a failure: a box's symbol is free text from
 * a card, so it can be a letter, a word, or an emoji newer than the bundled
 * set. Callers fall back to the app's own icon rather than serving nothing.
 */
export function twemojiSvgPath(emoji: string): string | null {
  const trimmed = emoji.trim();
  if (trimmed === "") return null;

  // Both spellings, because Twemoji's own filenames are not consistent about
  // VS16 inside ZWJ sequences: `1f3f3-fe0f-200d-1f308` (rainbow flag) keeps
  // it, `1f469-200d-1f373` (cook) does not. One rule therefore cannot be
  // right for both, and picking one silently drops the other to the generic
  // icon — so try the sequence as typed, then with VS16 stripped.
  const asTyped = twemojiCodePoints(trimmed);
  const stripped = [...trimmed.replace(VS16, "")]
    .map((ch) => ch.codePointAt(0)?.toString(16) ?? "")
    .join("-");

  for (const codePoints of asTyped === stripped ? [asTyped] : [asTyped, stripped]) {
    // Every character becomes hex digits, so the filename cannot traverse and
    // a symbol like "Kitchen" or "../../etc/passwd" is simply a name no
    // artwork answers to. Containment is a property of the encoding.
    const file = path.join(assetDir, `${codePoints}.svg`);
    // Existence is part of the answer rather than the caller's problem: a
    // symbol is free text, so "there is no artwork for this" is an ordinary
    // outcome, and every caller would otherwise repeat this check.
    if (existsSync(file)) return file;
  }
  return null;
}
