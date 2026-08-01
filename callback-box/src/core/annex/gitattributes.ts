/**
 * The `.gitattributes` half of the git-annex migration, as a pure function.
 *
 * Two callers need the exact same transform and must not drift: the migration
 * (`to-annex.ts`, which strips the filters off the box's existing file) and
 * `cb init` (`core/box/index.ts`, which regenerates that file from a template
 * on every run and would otherwise reinstate the Git LFS filters the migration
 * removed). A second, hand-rolled strip in the init path is precisely how a box
 * gets re-LFS-ified one `cb init` at a time.
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
