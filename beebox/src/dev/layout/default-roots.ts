/**
 * Every package root in the repo that has a `src/` directory: the default
 * root list for `layout-check` and the set the move tool scans for import
 * edges. Shared so both stay in sync.
 */
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { dirOf } from "./graph.js";

function git(params: { repoRoot: string; args: string[] }): string[] {
  const out = execFileSync("git", params.args, { cwd: params.repoRoot, encoding: "utf8" });
  return out.split("\0").filter((s) => s.length > 0);
}

export function defaultRoots(repoRoot: string): string[] {
  return git({ repoRoot, args: ["ls-files", "-z", "--", "package.json", "*/package.json"] })
    .map((p) => dirOf(p))
    .filter((root) => root !== "" && !root.includes("node_modules"))
    .filter((root) => existsSync(join(repoRoot, root, "src")))
    .toSorted();
}
