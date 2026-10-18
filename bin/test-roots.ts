/**
 * Every directory that holds doctests or the tap tests converted from them,
 * the package that runs them, and the typecheck script whose program covers
 * them. The doctest conversion driver and its checks read this list
 * (beebox/docs/plans/retire-doctest.md, track 2). Other test runners
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
  /** Package directory and `pnpm` script whose program typechecks the tests. */
  typecheck: { dir: string; script: string };
}

export const TEST_ROOTS: readonly TestRoot[] = [
  { dir: "beebox/src/frontend/test/", runFrom: "beebox", typecheck: { dir: "beebox", script: "typecheck:frontend" } },
  { dir: "beebox/test/", runFrom: "beebox", typecheck: { dir: "beebox", script: "typecheck:backend" } },
  // Root tooling tests run under beebox's tap config, with its home and
  // secret isolation (bin/AGENTS.md, "Tests for bin/ tooling").
  { dir: "bin/test/", runFrom: "beebox", typecheck: { dir: ".", script: "typecheck" } },
  { dir: "workstreams-app/test/frontend/", runFrom: "workstreams-app", typecheck: { dir: "workstreams-app", script: "typecheck:frontend" } },
  { dir: "workstreams-app/test/", runFrom: "workstreams-app", typecheck: { dir: "workstreams-app", script: "typecheck:backend" } },
  { dir: "scan-uploader/test/", runFrom: "scan-uploader", typecheck: { dir: "scan-uploader", script: "typecheck" } },
  { dir: "browse/packages/agent-browser-typed/test/", runFrom: "browse", typecheck: { dir: "browse", script: "typecheck" } },
  { dir: "browse/test/", runFrom: "browse", typecheck: { dir: "browse", script: "typecheck" } },
  { dir: "agent-doctest/test/", runFrom: "agent-doctest", typecheck: { dir: "agent-doctest", script: "typecheck" } },
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
    for (const r of TEST_ROOTS) console.log(`${r.dir}\trun from ${r.runFrom}\ttypecheck: ${r.typecheck.dir} ${r.typecheck.script}`);
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
