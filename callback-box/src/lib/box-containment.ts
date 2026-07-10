/**
 * Path containment for card refs — the security floor that keeps a ref
 * (a card-field value written by a human, an agent, or injected content)
 * from resolving to a file outside its box.
 *
 * No CVE-clean maintained library exists (`resolve-path` had CVE-2018-3732;
 * `@fastify/static`'s own containment shipped a traversal bug in 2026,
 * GHSA-pr96-94w5-mx2h), so this is hand-rolled and exhaustively doctested
 * (`test/box-containment.doctest.md`). Every line here is security-review
 * surface — keep it small.
 *
 * Two layers:
 *  - `containWithinBox` — the SYNC string floor: `path.resolve` (which
 *    normalizes away `..`, `.`, and trailing separators) then an explicit
 *    `=== root || startsWith(root + sep)` check. NEVER a bare `startsWith`,
 *    which admits a prefix-collision sibling (`/box` vs `/box-evil`). Safe in
 *    pure/sync contexts (the canonical ref resolver, `cb mv` rewriting) where
 *    `fs.realpath` cannot be awaited.
 *  - `readContainedFile` — the ASYNC read wrapper: re-verifies containment via
 *    `fs.realpath` on BOTH sides before reading, defeating an in-box symlink
 *    pointing outside (and canonicalizing macOS `/var`→`/private/var` on both
 *    sides so a legitimately-placed box still resolves). Used at the sink that
 *    feeds file bytes into an agent prompt.
 *
 * Encoding: refs are filesystem-style paths (YAML `ref:` scalars, Markdoc
 * `ref="…"` attributes), never percent-encoded, so decoding is N/A here — and
 * decoding would be a BUG, turning a literal `%2e%2e` filename into traversal.
 * A boundary that ever introduces URL-encoded refs must decode upstream, once,
 * before calling in.
 */

import { realpath, readFile } from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "./error-guards.js";

/**
 * A box-relative path (forward slashes, no leading slash, `..`-free) proven to
 * resolve inside its box. Produced ONLY by {@link containWithinBox} — a bare
 * `as BoxRelativePath` is scrutiny-worthy under the `as` convention.
 */
declare const boxRelativeBrand: unique symbol;
export type BoxRelativePath = string & { readonly [boxRelativeBrand]: true };

/** Raised when a contained ref resolves — via symlink — outside its box at read time. */
export class RefEscapesBoxError extends Error {
  override readonly name = "RefEscapesBoxError";
  constructor(readonly relPath: string) {
    super(`ref resolved outside the box after symlink resolution: ${relPath}`);
  }
}

/**
 * Confirm `absPath` stays within `boxRoot`; return its box-relative form
 * (branded) or `null` on escape. The string-level containment floor.
 */
export function containWithinBox(boxRoot: string, absPath: string): BoxRelativePath | null {
  const root = path.resolve(boxRoot);
  const resolved = path.resolve(absPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return path.relative(root, resolved).split(path.sep).join("/") as BoxRelativePath;
}

/**
 * Resolve a box-root-relative ref (`box/inbox/x`, or the equivalent
 * leading-slash `/box/inbox/x`) against `boxRoot` and contain it. For sites
 * whose refs are always box-relative (reactor jobs, nav, stale-job cleanup) —
 * NOT for document-relative or `attach/` refs (that's `resolveContainedRef`).
 */
export function resolveBoxRelativeRef(boxRoot: string, ref: string): BoxRelativePath | null {
  return containWithinBox(boxRoot, path.join(boxRoot, ref));
}

/**
 * Re-verify a string-contained path via `fs.realpath` (both sides): follow
 * symlinks and confirm the target STILL resolves inside the box. Returns the
 * same branded path when contained (or when the target does not exist yet — a
 * missing file is the caller's to handle, not an escape), `null` when a symlink
 * makes it escape. The async symlink-hardening layer every read/stat sink
 * should apply on top of the sync string floor. (Caveat: a missing leaf behind
 * a symlinked *parent* directory can't be realpath'd and is reported as
 * contained; the common leaf-symlink escape IS caught.)
 */
export async function realpathContained(
  boxRoot: string,
  contained: BoxRelativePath,
): Promise<BoxRelativePath | null> {
  const root = path.resolve(boxRoot);
  const abs = path.join(root, contained);
  let realAbs: string;
  try {
    realAbs = await realpath(abs);
  } catch (e) {
    // A target that doesn't exist yet is a missing ref, not an escape — let the
    // caller's own missing-file path handle it.
    if (errnoCode(e) === "ENOENT") return contained;
    throw e;
  }
  const realRoot = await realpath(root);
  return realAbs === realRoot || realAbs.startsWith(realRoot + path.sep) ? contained : null;
}

/**
 * Read a contained ref's UTF-8 bytes, re-verifying containment after symlink
 * resolution. Throws {@link RefEscapesBoxError} on a symlink escape; lets
 * `ENOENT` propagate (a missing ref is the caller's to tolerate).
 */
export async function readContainedFile(boxRoot: string, contained: BoxRelativePath): Promise<string> {
  const safe = await realpathContained(boxRoot, contained);
  if (safe === null) throw new RefEscapesBoxError(contained);
  return readFile(path.join(path.resolve(boxRoot), safe), "utf-8");
}
