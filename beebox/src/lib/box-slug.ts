/**
 * A box's URL slug, derived from where it lives on disk.
 *
 * shapeVersion 3 has one root, so `path.basename(shape.boxRoot)` is simply
 * the box's directory name — no "content dir" trap to work around (the v2
 * layout's `boxRoot` was a `content/` directory, so its basename was the
 * literal string "content" for EVERY box; that trap is gone with the
 * two-root layout — see `docs/implemented-plans/one-root-box-layout.md`).
 *
 * Prefer the authoritative slug when you have one: a served box carries
 * `box.slug` (honouring `bbx serve --slug`) through `BoxSpec` and the tRPC
 * context's `ctx.boxSlug`, and that is what the URL prefix, the webhook
 * mount and the push-subscription store are actually keyed by. Derive from
 * disk only where no such slug is threaded (CLI commands, background sweeps,
 * the connector's own startup).
 */

import * as path from "node:path";
import { getBoxShapeIfPresent, type BoxShape } from "./box-shape.js";

/** The slug of a box whose shape is already resolved. */
export function boxSlugFromShape(shape: BoxShape): string {
  return path.basename(shape.boxRoot);
}

/**
 * The slug of the box rooted at `boxRoot`. A marker-less directory (the
 * documented plain-directory serve mode) has no shape — fall back to its own
 * basename.
 */
export async function boxSlug(boxRoot: string): Promise<string> {
  const lookup = await getBoxShapeIfPresent(boxRoot);
  return lookup.found ? boxSlugFromShape(lookup.shape) : path.basename(boxRoot);
}
