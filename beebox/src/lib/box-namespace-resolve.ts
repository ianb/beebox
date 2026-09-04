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
 * Deliberately does NOT `fs.realpath` the result — several fenced routes
 * serve annex symlinks (a pointer file's target lives outside the working
 * tree), and resolving symlinks here would break that. This is the same
 * containment floor as `containWithinBox` (`box-containment.ts`), plus the
 * namespace check on top; it is not a substitute for that file's async
 * symlink-hardening layer where a sink needs it.
 */
import * as path from "node:path";
import { isInBoxNamespace } from "./box-namespace.js";

export interface BoxNamespacePath {
  /** Absolute, normalized filesystem path (symlinks unresolved). */
  resolved: string;
  /** The canonical box-relative form of `resolved` (forward slashes, no leading slash). */
  relativePath: string;
}

/**
 * Resolve `rawPath` against `boxRoot` and check the RESOLVED path against
 * both the box-containment floor and the box namespace fence. Returns `null`
 * when the resolved path escapes `boxRoot` entirely, or lands outside the
 * underscore-area namespace (including the box root itself — the empty
 * relative path is never in-namespace; a caller that must allow the root,
 * e.g. a directory-listing route, special-cases `rawPath === ""` itself
 * before calling in).
 */
export function resolveBoxNamespacePath(boxRoot: string, rawPath: string): BoxNamespacePath | null {
  const root = path.resolve(boxRoot);
  const resolved = path.resolve(path.join(root, rawPath));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  const relativePath = path.relative(root, resolved).split(path.sep).join("/");
  if (!isInBoxNamespace(relativePath)) return null;
  return { resolved, relativePath };
}
