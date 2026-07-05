/**
 * List the `.card` files in a box.
 *
 * Replaces the cardworks `CardLoader.listCards()` — a plain glob for `*.card`
 * files, returning absolute paths, skipping the usual non-content directories.
 */

import * as path from "node:path";
import { glob } from "glob";
import { boxCodePaths, getBoxShapeOrLegacyFallback } from "../cli/lib/box-shape.js";

const CARD_GLOB_IGNORE = ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"];

export async function listBoxCardFiles(boxRoot: string): Promise<string[]> {
  return glob("**/*.card", {
    cwd: boxRoot,
    nodir: true,
    absolute: true,
    ignore: CARD_GLOB_IGNORE,
  });
}

// Path segments that never hold authored markdown — dependency/VCS/tooling dirs.
const MARKDOWN_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".pnpm",
  ".claude",
  ".callback-box",
]);

/**
 * The single source of truth for "is this an authored `.md` file cb lints/scans".
 * Shared by the box-wide walker below and by the staged/hook predicate
 * (`isLintableMarkdown` in validate-markdown.ts) so every entry point agrees.
 *
 * Excludes:
 *  - non-`.md` files;
 *  - anything under a dependency/VCS/tooling dir (`MARKDOWN_SKIP_DIRS`);
 *  - cb's own machine-generated docs — a `docs/generated/` segment pair at ANY
 *    depth (generated trees are nested per-area, e.g.
 *    `store/roadtrip/docs/generated/`, not just at box root; those docs are full
 *    of illustrative example links that never resolve and must not be linted);
 *  - `CLAUDE.md` (instructions, not linkable content).
 *
 * Accepts a box-relative or absolute path (only the segment sequence matters).
 */
export function isBuiltinLintableMarkdown(filePath: string): boolean {
  if (!filePath.endsWith(".md")) return false;
  const parts = filePath.split(path.sep);
  if (parts.some((seg) => MARKDOWN_SKIP_DIRS.has(seg))) return false;
  for (let i = 0; i + 1 < parts.length; i++) {
    if (parts[i] === "docs" && parts[i + 1] === "generated") return false;
  }
  return parts[parts.length - 1] !== "CLAUDE.md";
}

// Heavy dirs pruned during the walk itself (perf — never descend them). The
// authoritative include/exclude decision is `isBuiltinLintableMarkdown`; this
// list only spares glob from walking large trees it would discard anyway.
const MARKDOWN_WALK_PRUNE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.pnpm/**",
  "**/.claude/**",
  "**/.callback-box/**",
];

/** List the authored `.md` files in a box, absolute paths, sorted. */
export async function listBoxMarkdownFiles(boxRoot: string): Promise<string[]> {
  const files = await glob("**/*.md", {
    cwd: boxRoot,
    nodir: true,
    absolute: true,
    ignore: MARKDOWN_WALK_PRUNE,
  });
  return files
    .filter((abs) => isBuiltinLintableMarkdown(path.relative(boxRoot, abs)))
    .toSorted();
}

/**
 * List the box-authored view files, absolute paths, sorted. These carry
 * `cardRef="…"` refs that `cb validate`/`cb mv` track (see core/view-refs.ts).
 *
 * Shape-aware: a legacy box's views live at `boxRoot/views/`; a v2 box's live
 * at `packageRoot/src/views/` (`boxCodePaths` resolves either).
 */
export async function listBoxViewFiles(boxRoot: string): Promise<string[]> {
  const shape = await getBoxShapeOrLegacyFallback(boxRoot);
  const viewsDir = boxCodePaths(shape).viewsDir;
  const files = await glob("*.tsx", {
    cwd: viewsDir,
    nodir: true,
    absolute: true,
    ignore: CARD_GLOB_IGNORE,
  });
  return files.toSorted();
}
