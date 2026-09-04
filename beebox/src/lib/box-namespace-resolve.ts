/**
 * The node-only counterpart to `box-namespace.ts`'s `isInBoxNamespace`: takes
 * an as-received request path (may contain `..`, `.`, or other traversal
 * forms) and checks the box namespace fence against the RESOLVED filesystem
 * path, not the raw string.
 *
 * Split out of `box-namespace.ts` rather than added there because that file
 * is dependency-free and mirrored at `src/shared/box-namespace.ts` for the
 * frontend bundle (`docs/module-map.md`'s "frontend-consumed leaf helper"
 * pattern) — it must never import `node:path`.
 *
 * Every HTTP/tRPC surface that serves, writes, lists, or deletes a
 * box-relative path taken from a request must resolve through this, not
 * through a per-route copy of `path.resolve` + `isInBoxNamespace(rawPath)`.
 * Checking the raw string is a traversal bypass: `_content/../package.json`
 * starts with `_content` (passes a raw-string check) but *resolves* to
 * `package.json` (outside the namespace) — `docs/plans/one-root-box-layout.md`
 * Track B.
 *
 * `resolveBoxNamespacePath` itself deliberately does NOT `fs.realpath` the
 * result — it's a pure lexical check, cheap to call from anywhere. The
 * one-root layout (the box's own npm package root and its box data sharing
 * one directory) adds a second hazard on top of raw-string traversal: an
 * in-namespace path can be a SYMLINK — a directory symlink partway down (e.g.
 * `_content/pkg` pointing back at the box root) or a leaf symlink — whose
 * resolved target lands outside the namespace even though every lexical
 * segment looked fine. `verifyBoxNamespaceOnDisk` (and the convenience
 * wrapper `resolveBoxNamespacePathOnDisk`) is the async filesystem-sink layer
 * that catches that: every consuming route MUST call it (not just the
 * lexical check) before reading, writing, listing, or deleting. It plays the
 * same role here that `realpathContained` plays for `containWithinBox` in
 * `box-containment.ts`, except it also re-checks the box NAMESPACE (not just
 * box-root containment) on the resolved real path, and treats a leaf
 * symlink specially for reads (annex-style asset serving depends on it).
 */
import { lstat, realpath } from "node:fs/promises";
import type { Stats } from "node:fs";
import * as path from "node:path";
import { isInBoxNamespace } from "./box-namespace.js";
import { errnoCode } from "./error-guards.js";
import { invariant } from "./invariant.js";

export interface BoxNamespacePath {
  /** Absolute, normalized filesystem path (symlinks unresolved). */
  resolved: string;
  /** The canonical box-relative form of `resolved` (forward slashes, no leading slash). */
  relativePath: string;
}

/**
 * `"read"` — serving/listing a path back to a client. A leaf that is itself a
 * symlink is allowed to resolve outside the box entirely (annex-style asset
 * serving: git-annex stores real bytes under `.git/annex/objects/...`, and
 * the visible box path is a symlink pointing there) as long as the symlink's
 * target is not itself a directory — a directory-valued leaf (e.g. browsing
 * straight into a symlinked directory) gets the full strict check instead, so
 * this mode is safe for directory-listing routes too, not just file reads.
 *
 * `"write"` — creating, overwriting, or deleting a path. No leaf-symlink
 * allowance: an existing leaf that is a symlink is walked and must itself
 * resolve inside the namespace (a same-directory relative symlink still
 * passes; one resolving outside the box does not).
 */
export type BoxNamespaceAccessMode = "read" | "write";

/**
 * Resolve `rawPath` against `boxRoot` and check the RESOLVED path against
 * both the box-containment floor and the box namespace fence. Returns `null`
 * when the resolved path escapes `boxRoot` entirely, or lands outside the
 * underscore-area namespace (including the box root itself — the empty
 * relative path is never in-namespace; a caller that must allow the root,
 * e.g. a directory-listing route, special-cases `rawPath === ""` itself
 * before calling in).
 *
 * Lexical only — see the module doc comment. A consuming route must also
 * call {@link verifyBoxNamespaceOnDisk} (or use
 * {@link resolveBoxNamespacePathOnDisk}, which does both in one call) before
 * touching the filesystem.
 */
export function resolveBoxNamespacePath(boxRoot: string, rawPath: string): BoxNamespacePath | null {
  const root = path.resolve(boxRoot);
  const resolved = path.resolve(path.join(root, rawPath));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  const relativePath = path.relative(root, resolved).split(path.sep).join("/");
  if (!isInBoxNamespace(relativePath)) return null;
  return { resolved, relativePath };
}

/** `path.relative`, canonicalized to the ref form (forward slashes). */
function toRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

/** Deepest existing ancestor of `absPath` (itself, if it already exists). */
async function deepestExistingAncestor(absPath: string): Promise<string> {
  let current = absPath;
  for (;;) {
    try {
      await lstat(current);
      return current;
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
    }
    const parent = path.dirname(current);
    if (parent === current) return current; // hit the filesystem root — give up here
    current = parent;
  }
}

/**
 * Realpath `lexicalTarget` (or, if it doesn't exist yet, its deepest existing
 * ancestor plus the still-literal remainder) and require the result to land
 * both inside `realRoot` AND inside the box namespace. This is the "walk"
 * check: it catches a directory symlink anywhere along the path — including
 * the case where the symlink resolves back to the box root itself (still
 * "inside boxRoot" by plain containment, but no longer inside any
 * underscore area once re-checked against the namespace).
 */
async function checkRealNamespace(lexicalTarget: string, realRoot: string): Promise<boolean> {
  const ancestorLexical = await deepestExistingAncestor(lexicalTarget);
  let realAncestor: string;
  try {
    realAncestor = await realpath(ancestorLexical);
  } catch (_e) {
    return false; // fail closed
  }
  const remainder = path.relative(ancestorLexical, lexicalTarget);
  const realFull = remainder === "" ? realAncestor : path.join(realAncestor, remainder);
  if (!(realFull === realRoot || realFull.startsWith(realRoot + path.sep))) return false;
  return isInBoxNamespace(toRelative(realRoot, realFull));
}

/**
 * The async filesystem-sink layer for a path already passed through
 * {@link resolveBoxNamespacePath}: `realpath`s the target (or its containing
 * walk) and re-verifies both box-root containment and box-namespace
 * membership against the RESOLVED path, so a symlink anywhere along the way
 * — the area segment itself, a directory partway down, or the leaf — can't
 * walk the fence into the package internals (`src/`, `node_modules/`,
 * `.git/`) or out of the box root entirely.
 *
 * Fails closed: any unexpected `realpath`/`lstat` error (permission denied,
 * ELOOP, etc. — anything but a plain missing path) is treated as an escape,
 * never as "allowed".
 */
export async function verifyBoxNamespaceOnDisk({
  boxRoot,
  ns,
  mode,
}: {
  boxRoot: string;
  ns: BoxNamespacePath;
  mode: BoxNamespaceAccessMode;
}): Promise<boolean> {
  const root = path.resolve(boxRoot);
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch (_e) {
    return false; // fail closed
  }

  // The area segment itself (e.g. `_content`) must not be a symlink — refused
  // even before walking any deeper.
  const firstSegment = ns.relativePath.split("/", 1)[0];
  invariant(
    firstSegment !== undefined && firstSegment !== "",
    "an in-namespace relativePath always has a non-empty first segment"
  );
  try {
    const areaStat = await lstat(path.join(root, firstSegment));
    if (areaStat.isSymbolicLink()) return false;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") return false; // fail closed; a missing area is handled below
  }

  let leafStat: Stats | null;
  try {
    leafStat = await lstat(ns.resolved);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") return false; // fail closed
    leafStat = null;
  }

  if (mode === "read" && leafStat !== null && leafStat.isSymbolicLink()) {
    // Annex-style leaf symlink: its OWN target may point anywhere (including
    // outside the box entirely) as long as it resolves to a non-directory —
    // a directory-valued leaf falls through to the strict check below, so
    // this stays safe for directory-listing routes (browse) too.
    let leafTargetIsDirectory = false;
    try {
      const realLeaf = await realpath(ns.resolved);
      leafTargetIsDirectory = (await lstat(realLeaf)).isDirectory();
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") return false; // fail closed
      // A dangling symlink target isn't a directory — fine, bypass applies;
      // the downstream read will 404 on the missing file.
    }
    if (!leafTargetIsDirectory) {
      // Only the WALK to the leaf's containing directory needs to stay
      // in-namespace; the leaf's own symlink target is exempt.
      return checkRealNamespace(path.dirname(ns.resolved), realRoot);
    }
  }

  // Every other case: the leaf is missing, is a real file/directory, or (on
  // a write/delete) is itself a symlink — realpath the target itself (or its
  // deepest existing ancestor, for a not-yet-created write target) and
  // require the result inside both the box root and the namespace. This is
  // also what refuses a write/delete through an existing leaf symlink that
  // resolves outside the box.
  return checkRealNamespace(ns.resolved, realRoot);
}

/**
 * Convenience wrapper: {@link resolveBoxNamespacePath} followed by
 * {@link verifyBoxNamespaceOnDisk}. What every consuming route should call.
 */
export async function resolveBoxNamespacePathOnDisk({
  boxRoot,
  rawPath,
  mode,
}: {
  boxRoot: string;
  rawPath: string;
  mode: BoxNamespaceAccessMode;
}): Promise<BoxNamespacePath | null> {
  const ns = resolveBoxNamespacePath(boxRoot, rawPath);
  if (ns === null) return null;
  return (await verifyBoxNamespaceOnDisk({ boxRoot, ns, mode })) ? ns : null;
}
