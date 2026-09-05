/**
 * The one-root migration's CLAUDE.md merge, as a pure text transform.
 *
 * The naive merge (preserve the package-root CLAUDE.md verbatim, append the
 * content persona) shipped stale engine scaffold onto every migrated box:
 * the packageify-era "this is a box PACKAGE, the live box is content/" prose
 * — wrong under one root — plus dead `@`-includes of files the migration
 * relocated. Found by the boxholder on the migrated fleet (2026-09-05) and
 * repaired there by hand; this transform bakes the same rules into the
 * migrator for any box converted later. (The fleet repair also handled
 * residue from before the product rename; a box migrating on the current
 * engine cannot carry that, so it is not re-handled here.)
 *
 * Rules (mirroring the fleet repair):
 *  - The root text's scaffold block is DROPPED when it reads as engine
 *    scaffold (mentions a box "package" and `content/`); anything else the
 *    boxholder wrote there is kept.
 *  - Inside the merged persona, `@`-include lines are repaired through the
 *    v2→v3 mapping when their target moved. Unmappable includes are kept
 *    as-is — the post-migration validate surfaces them.
 */

import { mapV2Path } from "./one-root-mapping.js";

function isStaleScaffold(text: string): boolean {
  return text.toLowerCase().includes("box package") && text.includes("content/");
}

function repairPersonaInclude(line: string): string {
  const target = line.slice(1).trim();
  if (target.startsWith("_") || target.startsWith(".beebox/")) return line;
  const mapped = mapV2Path(target);
  return mapped.kind === "move" ? "@" + mapped.newPath : line;
}

/** Merge a v2 box's content CLAUDE.md into its root CLAUDE.md, one-root form. */
export function mergeClaudeMdText(rootText: string, contentText: string): string {
  const keptRoot = isStaleScaffold(rootText) ? "" : rootText.trimEnd();
  const persona = contentText
    .split("\n")
    .map((ln) => (ln.startsWith("@") ? repairPersonaInclude(ln) : ln))
    .join("\n");
  return (
    (keptRoot === "" ? "" : keptRoot + "\n\n") +
    "## Box persona\n\n" +
    "(Merged from the v2 operational-root CLAUDE.md by the one-root migration.)\n\n" +
    persona.trimEnd() +
    "\n"
  );
}
