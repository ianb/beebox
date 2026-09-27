/**
 * Fillers for the box-shape sections of `guide.md`: the DIRECTORY_LAYOUT
 * table rows (`{{directory_layout}}`) and the BOX_CODE table rows
 * (`{{box_code_dirs}}`).
 *
 * The directory table is a curated subset of directories, some collapsed
 * together (all of `_bookkeeping/archive/*` reads as one row here). Canonical
 * directory paths and descriptions come from the single `BOX_LAYOUT` spec
 * (`src/lib/box-layout-spec.ts`); this file owns which rows appear and in what
 * order, plus the `_bookkeeping/archive/` rollup the spec does not model. The
 * `_tmp/` row is the document's own text.
 */

import { boxLayoutEntry, type BoxDirs } from "../../../lib/paths/core.js";
import { boxCodePathsRelativeToBoxRoot, type BoxShape } from "../../../lib/box-shape.js";

/** One row of the agent-facing directory table: its spec path (unless `path` overrides it) and description. */
function row(boxDirsKey: keyof BoxDirs, options?: { path: string }): string {
  const entry = boxLayoutEntry(boxDirsKey);
  const description = entry.agentDescription ?? entry.description;
  const path = options ? options.path : entry.path;
  return `| \`${path}/\` | ${description} |`;
}

/** The DIRECTORY_LAYOUT table's rows, from the layout spec. */
export function directoryLayoutRows(): string {
  return [
    row("inbox"),
    row("inboxIntake"),
    row("inboxStaged"),
    row("inboxTriaged", { path: "_content/inbox/triaged/<category>" }),
    row("inboxTriagedUnsure"),
    row("inboxUnhandled"),
    row("jobs"),
    row("questions"),
    row("resources"),
    row("output"),
    "| `_bookkeeping/archive/` | Processed/completed items |",
    row("calendar"),
    row("drive"),
    row("recipes"),
    row("retroReports"),
    row("todos"),
    row("trash"),
    row("people"),
    row("places"),
    row("config"),
  ].join("\n");
}

/**
 * The BOX_CODE table's rows: where box-authored code lives for a
 * (shapeVersion 3, one-root) box, under `src/` at this same box root.
 */
export function boxCodeRows(shape: BoxShape): string {
  const { schemasDir, viewsDir, tricksDir } = boxCodePathsRelativeToBoxRoot(shape);
  return [
    `| Schemas | \`${schemasDir}/\` |`,
    `| Views | \`${viewsDir}/\` |`,
    `| Tricks | \`${tricksDir}/\` |`,
  ].join("\n");
}
