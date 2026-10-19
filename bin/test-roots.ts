/**
 * Every directory that holds tests or the tap tests converted from them,
 * the package that runs them, and the typecheck script whose program covers
 * them. The test conversion driver and its checks read this list
 * (beebox/docs/implemented-plans/retire-doctest.md, track 2). Other test runners
 * (node:test files, beebox-clerk) are not listed.
 *
 *   node --import tsx bin/test-roots.ts           # print the list
 *   node --import tsx bin/test-roots.ts <file>    # print the root owning a file
 */

import { relative, resolve } from "node:path";

export interface TestRoot {
  /** Repo-relative directory holding the tests, with a trailing slash. */
  dir: string;
  /** Repo-relative package directory whose tap config runs the tests. */
  runFrom: string;
  /**
   * Package directory and `pnpm` script whose program typechecks the tests.
   * `printsFrom` is the directory the script's compiler runs in, which its
   * diagnostic paths are relative to, when that is not `dir`.
   */
  typecheck: { dir: string; script: string; printsFrom?: string };
  /**
   * Directory whose eslint config lints the tests. Run eslint from here: a
   * frontend test linted from beebox/ is ignored with only a warning.
   */
  lintFrom: string;
}

export const TEST_ROOTS: readonly TestRoot[] = [
  { dir: "beebox/src/frontend/test/", runFrom: "beebox", typecheck: { dir: "beebox", script: "typecheck:frontend", printsFrom: "beebox/src/frontend" }, lintFrom: "beebox/src/frontend" },
  { dir: "beebox/test/", runFrom: "beebox", typecheck: { dir: "beebox", script: "typecheck:backend" }, lintFrom: "beebox" },
  // Root tooling tests run under beebox's tap config, with its home and
  // secret isolation (bin/AGENTS.md, "Tests for bin/ tooling").
  { dir: "bin/test/", runFrom: "beebox", typecheck: { dir: ".", script: "typecheck" }, lintFrom: "." },
  { dir: "workstreams-app/test/frontend/", runFrom: "workstreams-app", typecheck: { dir: "workstreams-app", script: "typecheck:frontend" }, lintFrom: "workstreams-app" },
  { dir: "workstreams-app/test/", runFrom: "workstreams-app", typecheck: { dir: "workstreams-app", script: "typecheck:backend" }, lintFrom: "workstreams-app" },
  { dir: "scan-uploader/test/", runFrom: "scan-uploader", typecheck: { dir: "scan-uploader", script: "typecheck" }, lintFrom: "scan-uploader" },
  { dir: "browse/packages/agent-browser-typed/test/", runFrom: "browse", typecheck: { dir: "browse", script: "typecheck" }, lintFrom: "browse" },
  { dir: "browse/test/", runFrom: "browse", typecheck: { dir: "browse", script: "typecheck" }, lintFrom: "browse" },
  { dir: "agent-doctest/test/", runFrom: "agent-doctest", typecheck: { dir: "agent-doctest", script: "typecheck" }, lintFrom: "agent-doctest" },
];

/** The root owning a repo-relative file: the longest `dir` that contains it. */
export function rootOf(file: string): TestRoot | null {
  let best: TestRoot | null = null;
  for (const root of TEST_ROOTS) {
    if (file.startsWith(root.dir) && (best === null || root.dir.length > best.dir.length)) best = root;
  }
  return best;
}

if (import.meta.main) {
  const repo = resolve(import.meta.dirname, "..");
  const [file] = process.argv.slice(2);
  if (file === undefined) {
    for (const r of TEST_ROOTS) console.log(`${r.dir}\trun from ${r.runFrom}\ttypecheck: ${r.typecheck.dir} ${r.typecheck.script}\tlint from ${r.lintFrom}`);
  } else {
    const root = rootOf(relative(repo, resolve(file)));
    if (root === null) {
      console.error(`${file}: no test root contains it`);
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(root));
    }
  }
}
