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
import { onUnitHost } from "./unit-host.js";

/**
 * The slug a root's path names. On a unit host every box lives at
 * `<home>/box` (`docs/implemented-plans/per-box-units.md`: `/var/lib/beebox/<slug>/box`),
 * so the directory's own name is `box` for all of them and the slug is its
 * parent's. Found on production the day of the migration (2026-10-25): every
 * box resolved its grants under the name `box` and found none.
 */
export function slugOfBoxRoot(boxRoot: string): string {
  const base = path.basename(boxRoot);
  if (base === "box" && onUnitHost()) return path.basename(path.dirname(boxRoot));
  return base;
}

/** The slug of a box whose shape is already resolved. */
export function boxSlugFromShape(shape: BoxShape): string {
  return slugOfBoxRoot(shape.boxRoot);
}

/**
 * The slug of the box rooted at `boxRoot`. A marker-less directory (the
 * documented plain-directory serve mode) has no shape — fall back to its own
 * path's name.
 */
export async function boxSlug(boxRoot: string): Promise<string> {
  const lookup = await getBoxShapeIfPresent(boxRoot);
  return lookup.found ? boxSlugFromShape(lookup.shape) : slugOfBoxRoot(boxRoot);
}
