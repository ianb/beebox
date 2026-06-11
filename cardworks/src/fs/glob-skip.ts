/**
 * Directory names glob() never descends into or matches within.
 *
 * VCS internals and package installs are never card content. `.claude`
 * holds agent-tooling state — settings, hooks, and (in callback boxes)
 * `.claude/worktrees/<agent>/` isolation checkouts whose card COPIES must
 * not surface as the project's own cards: they double-count in listings,
 * produce false validation errors, and would get spuriously rewritten by
 * ref-updating operations like mv.
 */
export const GLOB_SKIP_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".claude",
]);

/** True if any path segment of `relativePath` is a skipped directory. */
export function inSkippedDir(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => GLOB_SKIP_DIRS.has(segment));
}
