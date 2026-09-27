/**
 * The scan surface for the move tool: every default package root
 * (`layout-check`'s list) plus `bin/**\/*.ts`, which has no package root of
 * its own but imports beebox code directly, plus every other tracked
 * TypeScript/JavaScript file outside both (`otherFiles`) — e.g. `schedules/`,
 * `site/`, `dev/`, `research/`, and root config files like `knip.ts`.
 */
import { isWithin } from "../graph.js";
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

const CODE_FILE_PATTERNS = ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.mjs", "*.cjs"];

function isExcludedPath(path: string): boolean {
  return (
    path === "node_modules" ||
    path.startsWith("node_modules/") ||
    path.includes("/node_modules/") ||
    path === "dist" ||
    path.startsWith("dist/") ||
    path.includes("/dist/")
  );
}

/**
 * Every tracked TypeScript/JavaScript file not already covered by
 * `scanRoots` or `binFiles`: the importers the move tool otherwise misses.
 */
export function otherFiles(params: { repoRoot: string; roots: string[]; binFiles: string[] }): string[] {
  const covered = new Set(params.binFiles);
  const all = gitLines({ repoRoot: params.repoRoot, args: ["ls-files", "-z", "--", ...CODE_FILE_PATTERNS] });
  return [...new Set(all)]
    .filter((path) => !isExcludedPath(path))
    .filter((path) => !covered.has(path))
    .filter((path) => !params.roots.some((root) => isWithin(path, root)))
    .toSorted();
}
