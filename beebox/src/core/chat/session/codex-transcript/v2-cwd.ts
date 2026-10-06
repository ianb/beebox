/**
 * Codex thread cwds recorded under a box's retired v2 layout.
 *
 * Codex stores the cwd a thread started in, outside the box, so the one-root
 * migration never rewrote it: a thread from before the migration still names
 * `<boxRoot>/content[/…]`. Reading one thread translates that cwd forward
 * (`realpathThreadCwd`); listing threads asks for the old cwds by name
 * (`retiredV2ContentCwds`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { errnoCode } from "../../../../shared/error-guards.js";
import { mapV2Path, v2ContentPathsFor } from "../../../migrations/one-root-mapping.js";

/**
 * Finding 4 (round 5 hardening): a Codex thread recorded BEFORE the one-root
 * migration carries a `cwd` under the retired v2 operational root
 * (`<boxRoot>/content[/…]`) — Codex's own session storage is external to the
 * box's own repo (a subprocess-managed history the migration never touches),
 * so that `cwd` is frozen exactly as the session recorded it. Once `content/`
 * is gone, `fs.realpathSync(threadCwd)` throws ENOENT and every such thread
 * becomes permanently unreadable.
 *
 * A narrow READ-time fallback: when `threadCwd` doesn't exist AND sits under
 * `<boxRoot>/content`, translate it through the same v2 → v3 mapping table
 * the migration itself used (`one-root-mapping.ts`'s `mapV2Path` — the
 * content root itself maps to the box root; a nested `content/<sub>` maps to
 * whatever area `<sub>` landed in) and retry the ownership check against the
 * translated path. A `threadCwd` this can't translate (outside `content/`
 * entirely, or naming something `mapV2Path` doesn't recognize) falls through
 * to the original ENOENT, unchanged.
 */
function translateRetiredV2ContentCwd(boxRoot: string, threadCwd: string): string | null {
  // Compared against the RAW `boxRoot` (as passed in, not realpath'd) — it's
  // the same value a v2-era session recorded its cwd relative to, so the
  // prefix match holds even when `boxRoot` itself sits behind a symlink
  // (e.g. macOS's `/var` -> `/private/var`); the result is realpath'd by the
  // caller once it's built.
  const v2ContentRoot = path.join(boxRoot, "content");
  if (threadCwd !== v2ContentRoot && !threadCwd.startsWith(v2ContentRoot + path.sep)) return null;
  if (threadCwd === v2ContentRoot) return boxRoot;
  const contentRelPath = path.relative(v2ContentRoot, threadCwd).split(path.sep).join("/");
  const mapped = mapV2Path(contentRelPath);
  return mapped.kind === "move" ? path.join(boxRoot, mapped.newPath) : null;
}

/** Realpath `threadCwd` for the ownership check below, falling back to the
 * v2→v3 translation above when the raw path is a retired content-root path
 * that no longer exists. Any other `realpathSync` failure (a session whose
 * cwd never existed, or was removed for an unrelated reason) propagates
 * unchanged — this fallback covers exactly the one-root migration's own
 * retired layout, nothing else. */
export function realpathThreadCwd(boxRoot: string, threadCwd: string): string {
  try {
    return fs.realpathSync(threadCwd);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    const translated = translateRetiredV2ContentCwd(boxRoot, threadCwd);
    if (translated === null) throw e;
    return fs.realpathSync(translated);
  }
}

/**
 * The retired v2 cwds a session bound to `cwd` may have recorded: the inverse
 * of `translateRetiredV2ContentCwd`. Codex keeps the cwd a thread started in,
 * and its listing filters on exact cwd, so a thread started before the
 * one-root migration lists only under its old `content/...` path.
 */
export function retiredV2ContentCwds(boxRoot: string, cwd: string): string[] {
  const relative = path.relative(boxRoot, cwd);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return [];
  const v2ContentRoot = path.join(boxRoot, "content");
  if (relative === "") return [v2ContentRoot];
  const v3RelPath = relative.split(path.sep).join("/");
  return v2ContentPathsFor(v3RelPath).map((v2Path) => path.join(v2ContentRoot, ...v2Path.split("/")));
}
