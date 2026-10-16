/**
 * Typecheck the staged `.doctest.md` files, each through the package that
 * owns it (pre-commit; agent-doctest/README.md, "Typechecking").
 *
 *   node --import tsx bin/doctest-typecheck-staged.ts
 *
 * The owner is the nearest package whose package.json has a
 * `typecheck:doctest` script; its `--project` groups say which tsconfig a
 * doctest is checked under, and `--only` narrows them to the staged files.
 * `bin/test/` doctests belong to beebox: its .taprc runs them, and its script
 * checks them under the root tsconfig. A staged doctest no package covers
 * fails the commit, so a new package cannot add doctests nobody checks.
 *
 * Only staged doctests are checked. A source change that breaks an unstaged
 * doctest is caught by `pnpm test:changed` and the hourly full suite.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { git } from "./test-git.js";

const REPO_ROOT = join(import.meta.dirname, "..");

/** Doctests outside any package, and the package that runs and checks them. */
const RUN_ELSEWHERE: Record<string, string> = { "bin/test/": "beebox" };

function hasDoctestTypecheck(dir: string): boolean {
  const manifest = join(REPO_ROOT, dir, "package.json");
  if (!existsSync(manifest)) return false;
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("scripts" in parsed)) return false;
  const { scripts } = parsed;
  return typeof scripts === "object" && scripts !== null && "typecheck:doctest" in scripts;
}

/** The repo-relative package directory that checks a doctest, or null. */
export function ownerOf(file: string, hasScript: (dir: string) => boolean): string | null {
  for (const [prefix, owner] of Object.entries(RUN_ELSEWHERE)) {
    if (file.startsWith(prefix)) return owner;
  }
  for (let dir = dirname(file); dir !== "." && dir !== "/"; dir = dirname(dir)) {
    if (hasScript(dir)) return dir;
  }
  return null;
}

function main(): number {
  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    .split("\n")
    .filter((file) => file.endsWith(".doctest.md"));
  const byOwner = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const file of staged) {
    const owner = ownerOf(file, hasDoctestTypecheck);
    if (owner === null) orphans.push(file);
    else byOwner.set(owner, [...(byOwner.get(owner) ?? []), file]);
  }
  if (orphans.length > 0) {
    process.stderr.write(
      `doctest typecheck: no package with a typecheck:doctest script covers ${orphans.join(", ")}.\n` +
        "  Add one to the package that runs these doctests (see agent-doctest/README.md, Typechecking).\n",
    );
    return 1;
  }
  let status = 0;
  for (const [owner, files] of byOwner) {
    const cwd = join(REPO_ROOT, owner);
    const only = files.map((file) => relative(cwd, join(REPO_ROOT, file)));
    const result = spawnSync("pnpm", ["--silent", "typecheck:doctest", "--only", ...only], { cwd, stdio: "inherit" });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) status = 1;
  }
  return status;
}

if (process.argv[1] === import.meta.filename) process.exitCode = main();
