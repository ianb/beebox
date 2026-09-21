/**
 * Stage 1 of a collection: which cards are in scope.
 *
 * A scope is a glob relative to the box root, and the one hard rule is that
 * it cannot reach outside it. That is checked twice — on the PATTERN before
 * anything is globbed, and on each RESOLVED match before anything is read —
 * because a pattern that looks contained can still match through a symlinked
 * directory.
 *
 * Lived in `core/todo/collect.ts` until the collection runner needed the same
 * card set (`docs/plans/todo-collection.md`, Track 3); it was never
 * todo-specific.
 */

import * as path from "node:path";
import { glob } from "glob";

// Same non-content dirs `list-cards.ts` prunes; kept local rather than
// importing that module's private constant (a one-line list, not worth a
// cross-module dependency for).
const CARD_GLOB_IGNORE = ["node_modules/**", ".git/**", "_tmp/**", ".beebox/**"];

/**
 * A `glob`/`here` input that could resolve outside the box root: an
 * OS-absolute pattern (the `glob` package honors these verbatim, ignoring
 * `cwd`) or any `..` path segment. Every consumer (`collections.query`'s zod input,
 * `bbx todos --glob`, the collection runner) shares this one guard rather
 * than each re-deriving it, so the box-root boundary can't drift out of sync
 * between them.
 */
class UnsafeGlobError extends Error {
  constructor(pattern: string) {
    super(`glob must stay within the box root — no absolute paths or ".." segments (got "${pattern}")`);
    this.name = "UnsafeGlobError";
  }
}

/** True when `pattern` is an OS-absolute path or contains a `..` segment — see {@link UnsafeGlobError}. */
export function isUnsafeGlobPattern(pattern: string): boolean {
  return path.isAbsolute(pattern) || pattern.split("/").includes("..");
}

/**
 * Every card path a scan would visit, sorted, guaranteed inside the box.
 * Throws {@link UnsafeGlobError} if `pattern` could resolve outside it.
 */
export async function listScopedCardPaths(boxRoot: string, pattern: string): Promise<string[]> {
  if (isUnsafeGlobPattern(pattern)) throw new UnsafeGlobError(pattern);
  const boxRootResolved = path.resolve(boxRoot);
  const globbed = await glob(pattern, {
    cwd: boxRoot,
    nodir: true,
    absolute: true,
    ignore: CARD_GLOB_IGNORE,
  });
  // A todo-view's glob is a *scope*, not a file filter: the box-wide plate
  // ships `glob: "**"` and project plates use bare directory globs
  // (`store/projects/foo/**`), so those patterns match every file under the
  // scope — briefing.md, config JSON, generated docs. Only card files are
  // candidates; scope every pattern to them here, centrally, exactly as the
  // absent-glob default `**/*.card` does. Without this, each non-card match
  // fell through to card classification and rendered in the todo view as a
  // "card couldn't be read" issue — a box-wide plate dumped every non-card
  // file in the box as an error.
  const rawAbsPaths = globbed.filter((absPath) => absPath.endsWith(".card"));
  // Defense-in-depth: even a pattern that passed the guard above shouldn't be
  // able to produce a match outside the box root (e.g. a symlinked card
  // directory) — verify containment on the resolved paths before anything is
  // read, rather than trusting the pattern alone.
  const absPaths = rawAbsPaths.filter((absPath) => {
    const resolved = path.resolve(absPath);
    const rel = path.relative(boxRootResolved, resolved);
    const contained = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    if (!contained) {
      console.warn(`[card-scope] dropping out-of-box glob match for pattern "${pattern}": ${absPath}`);
    }
    return contained;
  });
  return absPaths.toSorted();
}
