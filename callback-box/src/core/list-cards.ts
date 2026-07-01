/**
 * List the `.card` files in a box.
 *
 * Replaces the cardworks `CardLoader.listCards()` — a plain glob for `*.card`
 * files, returning absolute paths, skipping the usual non-content directories.
 */

import { glob } from "glob";

const CARD_GLOB_IGNORE = ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"];

export async function listBoxCardFiles(boxRoot: string): Promise<string[]> {
  return glob("**/*.card", {
    cwd: boxRoot,
    nodir: true,
    absolute: true,
    ignore: CARD_GLOB_IGNORE,
  });
}

// Authored markdown only: skip dependency/VCS dirs, the box's generated agent
// docs (`docs/generated/`, regenerated and full of placeholder example links),
// and CLAUDE.md (instructions, not linkable content).
const MARKDOWN_GLOB_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.pnpm/**",
  "**/.claude/**",
  "**/.callback-box/**",
  "docs/generated/**",
  "**/CLAUDE.md",
];

/** List the authored `.md` files in a box, absolute paths, sorted. */
export async function listBoxMarkdownFiles(boxRoot: string): Promise<string[]> {
  const files = await glob("**/*.md", {
    cwd: boxRoot,
    nodir: true,
    absolute: true,
    ignore: MARKDOWN_GLOB_IGNORE,
  });
  return files.toSorted();
}

/**
 * List the box-authored view files (`views/*.tsx`), absolute paths, sorted.
 * These carry `cardRef="…"` refs that `cb validate`/`cb mv` track (see
 * core/view-refs.ts).
 */
export async function listBoxViewFiles(boxRoot: string): Promise<string[]> {
  const files = await glob("views/*.tsx", {
    cwd: boxRoot,
    nodir: true,
    absolute: true,
    ignore: CARD_GLOB_IGNORE,
  });
  return files.toSorted();
}
