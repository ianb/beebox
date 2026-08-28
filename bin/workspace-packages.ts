/**
 * Which package owns a repo path — one answer, shared by the two tools that
 * ask: `finish-preflight` (what a change must verify) and `lint-changed`
 * (which package's lint to dispatch).
 *
 * Both used to derive their own list from `pnpm-workspace.yaml`, and they
 * disagreed: lint-changed matched the longest package directory while
 * finish-preflight matched the first path segment, so a change under
 * `callback-box/pub-worker` — its own workspace package, with its own `test`,
 * `typecheck` and `lint` — was verified as if it were callback-box source and
 * got none of its own checks. See
 * issues/closed/code-quality/2026-08-25-nested-workspace-packages-misclassified.md.
 *
 * Tests: bin/lint-changed.test.ts and bin/finish-preflight.test.ts exercise the
 * matching; this module is the (filesystem) source of the list it matches over.
 */

import { existsSync, globSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { parse } from "yaml";

/**
 * A workspace package whose verification a parent package owns, so it never
 * owns a path of its own.
 *
 * `callback-box/src/frontend` is its own package, but callback-box runs its
 * checks: `lint:frontend` and `typecheck:frontend` shell into it, and its tests
 * are callback-box doctests under `callback-box/test/frontend/`. Attributing a
 * frontend path to it would run its (nonexistent) `test` script and skip all
 * three.
 */
const PARENT_OWNED = new Set(["callback-box/src/frontend"]);

/** The scripts that make a package able to verify a change of its own. */
const VERIFICATION_SCRIPTS = ["test", "typecheck", "lint"];

/**
 * Does `<dir>` define any verification script?
 *
 * A package that defines none cannot own a path: `browse/packages/agent-browser-typed`
 * is a workspace package with no scripts at all, and what checks it is
 * `browse`'s own whole-tree `tsc --noEmit` and `eslint .`. Attributing a path
 * to it would run nothing.
 */
function verifiesItself(root: string, dir: string): boolean {
  const file = join(root, dir, "package.json");
  if (!existsSync(file)) return false;
  const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
  const scripts: unknown =
    typeof parsed === "object" && parsed !== null && "scripts" in parsed ? parsed.scripts : undefined;
  if (typeof scripts !== "object" || scripts === null) return false;
  return VERIFICATION_SCRIPTS.some((script) => Object.hasOwn(scripts, script));
}

/** The `packages:` entries of `pnpm-workspace.yaml`, as written. */
function workspaceEntries(root: string): string[] {
  const parsed: unknown = parse(readFileSync(join(root, "pnpm-workspace.yaml"), "utf-8"));
  const packages: unknown =
    typeof parsed === "object" && parsed !== null && "packages" in parsed ? parsed.packages : undefined;
  return (Array.isArray(packages) ? packages : []).map((entry) => String(entry));
}

/**
 * Every workspace package directory that can own a path, repo-root-relative
 * and slash-separated.
 *
 * Entries are globs (`packages/*` as much as a literal directory), so they are
 * expanded rather than read as names, and a match only counts if it holds a
 * `package.json` with verification scripts of its own.
 */
export function packageOwnerDirs(root: string): string[] {
  const dirs = new Set<string>();
  const excluded = new Set<string>();
  for (const entry of workspaceEntries(root)) {
    // pnpm reads a leading `!` as "exclude what this matches".
    const negated = entry.startsWith("!");
    for (const match of globSync(negated ? entry.slice(1) : entry, { cwd: root })) {
      const dir = match.split(sep).join("/");
      if (negated) {
        excluded.add(dir);
        continue;
      }
      if (PARENT_OWNED.has(dir)) continue;
      if (verifiesItself(root, dir)) dirs.add(dir);
    }
  }
  return [...dirs].filter((dir) => !excluded.has(dir)).toSorted();
}
