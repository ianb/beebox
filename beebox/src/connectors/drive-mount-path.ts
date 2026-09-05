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
import { resolveBoxNamespacePathOnDisk } from "../lib/box-namespace-resolve.js";
import { PathOutsideBoxError, SymlinkedMountTargetError } from "./drive-mount-errors.js";

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

/**
 * Round-7 hardening finding 3: `resolveMountTarget` above is lexical only —
 * with `_content/code -> ../src` on disk, a lexically-legal target under
 * `_content/code` actually resolves outside the box entirely.
 * `resolveBoxNamespacePathOnDisk` re-verifies the RESOLVED path (walking any
 * symlink, including the final path component — the card filename after
 * suffix expansion) in WRITE mode, which allows no leaf-symlink exception.
 * Every Drive filesystem operation (mount, link, unmount) calls this right
 * before its write, so a symlinked-away directory fails the operation
 * cleanly instead of silently writing through it.
 */
export async function assertMountTargetWritable(
  boxRoot: string,
  target: { absTarget: string; label: string },
): Promise<void> {
  const rawPath = path.relative(boxRoot, target.absTarget).split(path.sep).join("/");
  const ns = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath, mode: "write" });
  if (ns === null) throw new SymlinkedMountTargetError({ raw: rawPath, label: target.label });
}
