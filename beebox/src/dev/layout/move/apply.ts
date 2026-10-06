/**
 * Applies a validated move list: `git mv` each pair, then rewrites the
 * collected import specifiers at each importer's new location.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rewriteDoctestFile } from "./doctest-edit.js";
import { gitMove } from "./git-ops.js";
import type { PlannedMove } from "./list.js";
import { rewriteTsFile } from "./ts-edit.js";

export function moveFiles(params: { repoRoot: string; moves: PlannedMove[] }): void {
  for (const move of params.moves) gitMove({ repoRoot: params.repoRoot, from: move.from, to: move.to });
}

export function applyRewrites(params: { repoRoot: string; byImporter: ReadonlyMap<string, ReadonlyMap<string, string>> }): void {
  for (const [path, rewrites] of params.byImporter) {
    const full = join(params.repoRoot, path);
    const original = readFileSync(full, "utf8");
    const updated = path.endsWith(".doctest.md")
      ? rewriteDoctestFile({ text: original, rewrites })
      : rewriteTsFile({ path, text: original, rewrites });
    if (updated !== original) writeFileSync(full, updated, "utf8");
  }
}
