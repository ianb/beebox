/**
 * `bin/doc-move <from> <to> [--dry-run]` — move one tracked Markdown doc with
 * `git mv` and rewrite every reference to it, printing each rewritten line.
 * Finish uses it to move a landed plan into `docs/implemented-plans/`;
 * `bin/issues close` runs the same move. The logic lives in
 * `bin/lib/doc-move.ts`.
 */

import * as path from "node:path";
import { parseArgs } from "node:util";

import { DocMoveError, formatDocMove, moveDoc } from "./lib/doc-move.js";

const USAGE = `usage: bin/doc-move <from> <to> [--dry-run]

Moves one tracked .md file (git mv) and rewrites the references that resolve
to it: Markdown links and frontmatter paths, backticked repo paths, and .md
mentions in code and YAML, tests included. <to> ending in / or naming a
directory keeps the basename. Paths are relative to the repository root.
--dry-run prints the rewrites without changing anything.
`;

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

class DocMoveUsageError extends Error {
  constructor() {
    super(USAGE.trimEnd());
    this.name = "DocMoveUsageError";
  }
}

function main(): void {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { "dry-run": { type: "boolean" }, help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });
  if (values.help === true) {
    process.stdout.write(USAGE);
    return;
  }
  const [from, to, ...extra] = positionals;
  if (from === undefined || to === undefined || extra.length > 0) throw new DocMoveUsageError();
  const dryRun = values["dry-run"] === true;
  const report = formatDocMove(moveDoc({ repoRoot: REPO_ROOT, from, to, dryRun }), { dryRun });
  process.stdout.write(report.stdout);
  process.stderr.write(report.stderr);
}

try {
  main();
} catch (error) {
  if (!(error instanceof DocMoveError || error instanceof DocMoveUsageError)) throw error;
  process.stderr.write(`doc-move: ${error.message}\n`);
  process.exitCode = 2;
}
