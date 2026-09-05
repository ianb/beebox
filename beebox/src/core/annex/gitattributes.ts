/**
 * The `.gitattributes` half of the git-annex migration, as a pure function.
 *
 * Used by the migration (`to-annex.ts`) to strip the filters off a box's
 * existing file. `bbx init` used to need the same transform, because it
 * regenerated `.gitattributes` from an LFS-bearing template on every run and
 * would otherwise reinstate the filters the migration removed — a box could get
 * re-LFS-ified one `bbx init` at a time. That template no longer carries LFS
 * rules at all (`core/box/index.ts`), so this is the migration's tool only, for
 * boxes created before that change.
 */

/**
 * Drop every `filter=lfs` line, leaving everything else exactly as it was.
 *
 * Other attributes (`!text !filter` rules for test fixtures, say) are
 * load-bearing and must survive — hence a line filter rather than a rewrite.
 *
 * @param text - Current `.gitattributes` contents
 * @returns The contents with LFS filter lines removed
 */
export function stripLfsFilters(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.includes("filter=lfs"))
    .join("\n");
}
