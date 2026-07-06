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
 * Read a contained ref's UTF-8 bytes, re-verifying containment after symlink
 * resolution. Throws {@link RefEscapesBoxError} on a symlink escape; lets
 * `ENOENT` propagate (a missing ref is the caller's to tolerate).
 */
export async function readContainedFile(boxRoot: string, contained: BoxRelativePath): Promise<string> {
  const root = path.resolve(boxRoot);
  const abs = path.join(root, contained);
  const [realRoot, realAbs] = await Promise.all([realpath(root), realpath(abs)]);
  if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
    throw new RefEscapesBoxError(contained);
  }
  return readFile(abs, "utf-8");
}
