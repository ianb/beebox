/**
 * A box's mark, rendered as a PNG at whatever size a surface asks for.
 *
 * Several places need a real raster rather than the emoji the browser draws
 * for itself: a notification icon must be a PNG (Chrome will not render an SVG
 * one), and so must anything an OS draws for an installed app. Those are
 * exactly the surfaces where a box is identified with no other context around
 * it, which is why they are worth serving per box at all.
 *
 * Nothing is stored. The mark comes from the box's root landmark card, the
 * same one that names the box, and is rendered on demand:
 *
 *   - a **text symbol** renders from Twemoji's artwork for that emoji
 *     (`lib/twemoji.ts`), which is shapes rather than glyphs — no font on the
 *     server, and full colour;
 *   - an **image symbol** (`symbol: { src }`) is the box's own file, resized.
 *
 * There is no per-box asset, no build step, and nothing to regenerate when the
 * boxholder edits the card: the next request renders the new mark.
 *
 * A box whose symbol has no artwork — a word, a letter, an emoji newer than
 * the bundled set — resolves to null, and callers fall back to the app's own
 * icon. That is an ordinary outcome of a free-text field, not a failure.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readBoxIdentity } from "../landmark/box-identity.js";
import { twemojiSvgPath } from "../../lib/twemoji.js";
import { resolveRefPath } from "../../shared/ref-path.js";

/** A rendered mark: the PNG bytes plus an ETag identifying what produced it. */
export interface BoxIconPng {
  png: Buffer;
  /** Strong ETag over (source bytes, size) — a card edit changes it. */
  etag: string;
}

/**
 * Rendered marks, keyed by source identity and size.
 *
 * A box's mark changes only when its landmark card changes, and the sizes are
 * a fixed handful, so this settles at a few entries per box. Keyed by a hash
 * of the *source bytes* rather than the box, so an edit misses rather than
 * needing invalidation, and two boxes with the same emoji share one render.
 */
const rendered = new Map<string, BoxIconPng>();

/** Bound on remembered renders; cleared wholesale rather than evicted one by
 *  one, since the working set is tiny and a box past this is pathological. */
const MAX_ENTRIES = 256;

/**
 * The box's mark as a `size`x`size` PNG, or null when it has no renderable
 * symbol.
 *
 * `size` is the pixel edge — 180 for an Apple touch icon, 192/512 for a
 * manifest, 192 for a notification.
 */
export async function renderBoxIcon({
  boxRoot,
  slug,
  size,
}: {
  boxRoot: string;
  slug: string;
  size: number;
}): Promise<BoxIconPng | null> {
  const identity = await readBoxIdentity({ boxRoot, slug });

  const source = await readIconSource({ boxRoot, identity });
  if (source === null) return null;

  const etag = `"${createHash("sha256").update(source).update(`:${size}`).digest("hex").slice(0, 32)}"`;
  const hit = rendered.get(etag);
  if (hit !== undefined) return hit;

  // Dynamic import keeps sharp's native binding off the startup path, the
  // convention every other sharp caller here follows.
  const sharp = (await import("sharp")).default;
  let png: Buffer;
  try {
    png = await sharp(source)
      // `contain` rather than `cover`: a mark is not a photograph, and
      // cropping one to a square would cut the glyph. Transparent padding
      // keeps a non-square image symbol whole.
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch (e) {
    // An unreadable or non-image symbol is the boxholder's data, not a broken
    // server: log it and let the caller serve the app's own icon.
    console.warn(`box icon: could not render the mark for box ${slug}:`, e);
    return null;
  }

  if (rendered.size >= MAX_ENTRIES) rendered.clear();
  const result = { png, etag };
  rendered.set(etag, result);
  return result;
}

/**
 * The bytes to render: Twemoji artwork for a text symbol, or the box's own
 * image file for an image symbol.
 */
async function readIconSource({
  boxRoot,
  identity,
}: {
  boxRoot: string;
  identity: { symbol: string; symbolSrc: string | null };
}): Promise<Buffer | null> {
  if (identity.symbolSrc !== null) {
    // Already resolved inside the box by `readLandmarkSymbol`; re-resolving
    // through the same ref algebra is what keeps that guarantee true here
    // rather than assumed.
    const resolved = resolveRefPath({ fromPath: "", ref: identity.symbolSrc, kind: "card" });
    if (resolved === null) return null;
    try {
      return await readFile(`${boxRoot}/${resolved}`);
    } catch (e) {
      console.warn(`box icon: could not read the image symbol ${identity.symbolSrc}:`, e);
      return null;
    }
  }

  const artwork = twemojiSvgPath(identity.symbol);
  if (artwork === null) return null;
  try {
    return await readFile(artwork);
  } catch (e) {
    console.warn(`box icon: could not read Twemoji artwork ${artwork}:`, e);
    return null;
  }
}
