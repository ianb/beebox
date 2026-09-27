/**
 * The scan surface for the move tool: every default package root
 * (`layout-check`'s list) plus `bin/**\/*.ts`, which has no package root of
 * its own but imports beebox code directly.
 */
import { defaultRoots } from "../default-roots.js";
import { gitLines } from "./git-ops.js";

export function scanRoots(repoRoot: string): string[] {
  return defaultRoots(repoRoot);
}

export function binFiles(repoRoot: string): string[] {
  return [
    ...new Set(gitLines({ repoRoot, args: ["ls-files", "-z", "--", "bin/*.ts", "bin/**/*.ts"] })),
  ].toSorted();
}
