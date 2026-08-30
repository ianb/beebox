/**
 * The one place a Drive mount operation turns a target someone typed into a
 * path inside the box.
 *
 * Every mount surface — `bbx drive mount/link/unmount`, the tRPC procedures the
 * settings page and chat call, the legacy `folders` config conversion — takes a
 * path from outside. `shared/ref-path.ts` is the box's path algebra and it
 * fails CLOSED: a `..` that climbs out, an absolute-looking `/etc/passwd`, or a
 * ref naming the box root itself resolves to `null` rather than being clamped.
 * Doing that here rather than in each caller is what makes containment a
 * property of the operation instead of a property of whichever surface
 * remembered to check — the tRPC router no longer checks at all.
 *
 * A leading `/` is box-root-absolute, not filesystem-absolute. That is the
 * whole reason a filesystem-absolute target is refused: the two spellings are
 * indistinguishable to a caller, so only one of them can be legal.
 */

import * as path from "node:path";
import { parseRef, resolveRefPath } from "../shared/ref-path.js";
import { PathOutsideBoxError } from "./drive-mount-errors.js";

/**
 * The absolute path a mount target names, or a refusal naming what was typed.
 *
 * `label` is how the refusal introduces the input ("The target directory must
 * be a path inside the box: …"), so it reads as a sentence on every surface.
 */
export function resolveMountTarget(boxRoot: string, target: { raw: string; label: string }): string {
  const parsed = parseRef(target.raw);
  // `write-target`: the path is one a command is about to create, so the
  // `attach/` virtual prefix has no meaning here and containment is the point.
  const resolved = resolveRefPath({ fromPath: undefined, ref: parsed.path, kind: "write-target" });
  if (resolved === null) throw new PathOutsideBoxError(target);
  return path.join(boxRoot, resolved);
}
