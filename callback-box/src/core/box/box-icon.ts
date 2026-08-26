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
 * same one that names the box, and is rendered on demand.
 *
 * **Only a text symbol renders here**, from Twemoji's artwork for that emoji
 * (`lib/twemoji.ts`) — shapes rather than glyphs, so no font on the server and
 * full colour. An image symbol (`symbol: { src }`) deliberately does NOT
 * render: the box child's auth hook waves through any URL ending in an asset
 * extension, so this is reachable unauthenticated on a standalone server, and
 * a route in that position must not turn box files into bytes it hands out.
 * The caller sends an image symbol to the box's own authenticated file route
 * instead (`routes/box-identity-assets.ts`).
 *
 * That also bounds the work: the only thing ever decoded is one of a few
 * thousand small bundled SVGs at one of three sizes, rather than whatever
 * dimensions a file in the box happens to have.
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

  const source = await readIconSource({ identity });
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
      // `contain` on a transparent ground: Twemoji artwork is already square,
      // so this is a scale, and padding rather than cropping keeps any
      // future non-square source whole instead of trimming the glyph.
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch (e) {
    // Bundled artwork that will not rasterize means a broken or mismatched
    // dependency, not bad box data — worth saying loudly, but not worth
    // failing the request over when a shared icon will do.
    console.warn(`box icon: could not render the mark for box ${slug}:`, e);
    return null;
  }

  if (rendered.size >= MAX_ENTRIES) rendered.clear();
  const result = { png, etag };
  rendered.set(etag, result);
  return result;
}

/** Twemoji artwork for the box's emoji, or null when there is none to draw. */
async function readIconSource({
  identity,
}: {
  identity: { symbol: string; symbolSrc: string | null };
}): Promise<Buffer | null> {
  // An image symbol is box content; see the file header for why it does not
  // render here.
  if (identity.symbolSrc !== null) return null;

  const artwork = twemojiSvgPath(identity.symbol);
  if (artwork === null) return null;
  try {
    return await readFile(artwork);
  } catch (e) {
    console.warn(`box icon: could not read Twemoji artwork ${artwork}:`, e);
    return null;
  }
}
