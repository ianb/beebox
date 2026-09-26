/**
 * The one line a map-bearing directory's `CLAUDE.md` carries so Claude Code
 * loads `MAP.md` when an agent works there. Shared by the maps finalizer,
 * which writes it, and the guidance sync, which strips it off a tracked guide
 * that an earlier finalizer prepended it to (see
 * `docs/box-guidance.md`, "Maps and tracked guides").
 */
export const MAP_INCLUDE_LINE = "@MAP.md";

/**
 * Remove a leading map include line (and the blank line after it) from a
 * file's content. Returns the content unchanged when it does not start with
 * the line.
 */
export function stripLeadingMapInclude(content: string): string {
  if (!content.startsWith(`${MAP_INCLUDE_LINE}\n`)) return content;
  const rest = content.slice(MAP_INCLUDE_LINE.length + 1);
  return rest.startsWith("\n") ? rest.slice(1) : rest;
}
