// Tests for change-based test selection. A `node:test` file rather than
// a tap test, for the same reason
// bin/test-graph.test.ts is one: the thing under test decides which tests
// run, so exercising it from inside that suite is circular.
//
//   node --import tsx --test bin/test-select.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { buildGraphFrom, testEntrypoints, REPO_ROOT } from "./test-graph.js";
import type { TestGraph } from "./test-graph-query.js";
import { reasonSummary, selectTests, spawnedSourceRefs, spawnerEdges } from "./test-select-lib.js";
import { packageRelative } from "./test-ledger-lib.js";
import { emptyRunLines } from "./test-select.js";
import { binTsArgs } from "./lib/bin-ts.js";

/** A graph stated directly, so the rule is tested without an esbuild pass. */
function graphOf(input: {
  tests: Record<string, string[]>;
  unresolved?: string[];
}): TestGraph {
  const tests = new Map(Object.entries(input.tests).map(([k, v]) => [k, new Set(v)]));
  const universe = new Set<string>();
  for (const deps of tests.values()) for (const dep of deps) universe.add(dep);
  return {
    tests,
    universe,
    unresolved: new Set(input.unresolved),
    ambiguousEdges: 0,
    buildMs: 0,
    cached: false,
  };
}

const BOX = "beebox/";

test("the union rule: implicated tests, and only paths this suite could care about", () => {
  const graph = graphOf({
    tests: {
      [`${BOX}test/core/box.test.ts`]: [`${BOX}src/core/box.ts`],
      [`${BOX}test/cli/init.test.ts`]: [`${BOX}src/cli/init.ts`],
    },
  });
  const selection = selectTests({
    graph,
    changed: [
      `${BOX}src/core/box.ts`,
      // Out of scope entirely: another package, and prose inside this one.
      "bin/doctor.ts",
      "issues/bugs/x.md",
      `${BOX}docs/testing.md`,
    ],
    spawnEdges: new Map([[`${BOX}test/cli/init.test.ts`, new Set(["src/core/box.ts"])]]),
  });
  assert.deepEqual(selection.selected, [
    `${BOX}test/cli/init.test.ts`,
    `${BOX}test/core/box.test.ts`,
  ]);
  assert.deepEqual(selection.scoped, [`${BOX}src/core/box.ts`]);
});

test("a spawner is selected by a change to what it spawns, and by nothing else", () => {
  // Until the 2026-08-25 revision every spawner ran on every selected run —
  // ~10 files and ~35s whatever the change was. The refs are edges now.
  const graph = graphOf({
    tests: {
      [`${BOX}test/cli/spawner.test.ts`]: [],
      [`${BOX}test/core/box.test.ts`]: [`${BOX}src/core/box.ts`],
    },
  });
  const spawnEdges = new Map([
    [`${BOX}test/cli/spawner.test.ts`, new Set(["../../src/cli/child.js"])],
  ]);
  // A NodeNext specifier says `.js` where the file on disk says `.ts`.
  assert.deepEqual(
    selectTests({ graph, changed: [`${BOX}src/cli/child.ts`], spawnEdges }).selected,
    [`${BOX}test/cli/spawner.test.ts`],
  );
  assert.deepEqual(
    selectTests({ graph, changed: [`${BOX}src/core/box.ts`], spawnEdges }).selected,
    [`${BOX}test/core/box.test.ts`],
  );
});

test("a dist/cli.mjs spawner follows the bundle's real inputs", () => {
  // `scripts/build-cli.ts` bundles src/cli/entry/run.ts TRANSITIVELY — 932 files
  // across nearly every src/ subtree, not src/cli/**. The caller computes the
  // set; a null one fails open on all of src/.
  const graph = graphOf({ tests: { [`${BOX}test/cli/cli.test.ts`]: [] } });
  const spawnEdges = new Map([[`${BOX}test/cli/cli.test.ts`, new Set(["dist/cli.mjs"])]]);
  const cliBundleInputs = new Set([`${BOX}src/core/box.ts`]);
  assert.deepEqual(
    selectTests({ graph, changed: [`${BOX}src/core/box.ts`], spawnEdges, cliBundleInputs }).selected,
    [`${BOX}test/cli/cli.test.ts`],
  );
  assert.deepEqual(
    selectTests({
      graph,
      changed: [`${BOX}src/frontend/src/App.tsx`],
      spawnEdges,
      cliBundleInputs,
    }).selected,
    [],
  );
  assert.deepEqual(
    selectTests({
      graph,
      changed: [`${BOX}src/frontend/src/App.tsx`],
      spawnEdges,
      cliBundleInputs: null,
    }).selected,
    [`${BOX}test/cli/cli.test.ts`],
  );
});

test("a change nothing imports selects nothing — there is no full-suite fallback", () => {
  // Three quarters of branches look like this. The honest description of a
  // change to untested code is "this code has no tests"; running 627 files
  // hides that rather than fixing it (plan revision 2026-08-25).
  const graph = graphOf({ tests: { [`${BOX}test/core/box.test.ts`]: [`${BOX}src/core/box.ts`] } });
  const selection = selectTests({
    graph,
    changed: [`${BOX}src/frontend/src/components/Untested.tsx`],
  });
  assert.deepEqual(selection.selected, []);
  assert.deepEqual(selection.implicated, []);
});

test("nothing in scope means nothing selected, spawners included", () => {
  const graph = graphOf({ tests: { [`${BOX}test/a.test.ts`]: [] } });
  const selection = selectTests({
    graph,
    changed: ["bin/test-select.ts", "issues/features/y.md"],
    spawnEdges: new Map([[`${BOX}test/a.test.ts`, new Set(["src/a.ts", "dist/cli.mjs"])]]),
  });
  assert.deepEqual(selection.selected, []);
});

test("a changed test selects itself", () => {
  const graph = graphOf({ tests: { [`${BOX}test/core/box.test.ts`]: [`${BOX}src/core/box.ts`] } });
  const selection = selectTests({ graph, changed: [`${BOX}test/core/box.test.ts`] });
  assert.deepEqual(selection.selected, [`${BOX}test/core/box.test.ts`]);
});

test("an unresolved entrypoint is always selected — a missing edge fails open", () => {
  const graph = graphOf({
    tests: { [`${BOX}test/core/box.test.ts`]: [`${BOX}src/core/box.ts`] },
    unresolved: [`${BOX}test/broken.test.ts`],
  });
  const selection = selectTests({ graph, changed: [`${BOX}src/core/box.ts`] });
  assert.deepEqual(selection.selected, [
    `${BOX}test/broken.test.ts`,
    `${BOX}test/core/box.test.ts`,
  ]);
});

test("an excluded (careful-tier) test is dropped unless it is what changed", () => {
  // The seam for mechanism C. The exclusion is about not paying for a flaky
  // neighbour, not about skipping the test you just edited.
  const graph = graphOf({
    tests: {
      [`${BOX}test/lib/git-lock.test.ts`]: [`${BOX}src/lib/git.ts`],
      [`${BOX}test/lib/git.test.ts`]: [`${BOX}src/lib/git.ts`],
    },
  });
  const exclude = [`${BOX}test/lib/git-lock.test.ts`];
  assert.deepEqual(selectTests({ graph, changed: [`${BOX}src/lib/git.ts`], exclude }).selected, [
    `${BOX}test/lib/git.test.ts`,
  ]);
  assert.deepEqual(
    selectTests({ graph, changed: [`${BOX}test/lib/git-lock.test.ts`], exclude }).selected,
    [`${BOX}test/lib/git-lock.test.ts`],
  );
});

test("reasons group the selection by the changed path that reached each test, largest first", () => {
  const graph = graphOf({
    tests: {
      [`${BOX}test/a.test.ts`]: [`${BOX}src/theme.ts`, `${BOX}src/a.ts`],
      [`${BOX}test/b.test.ts`]: [`${BOX}src/theme.ts`],
      [`${BOX}test/c.test.ts`]: [`${BOX}src/theme.ts`],
      [`${BOX}test/lib/git-lock.test.ts`]: [`${BOX}src/theme.ts`],
      "bin/test/x.test.ts": ["bin/lib/x.ts"],
    },
    unresolved: [`${BOX}test/broken.test.ts`],
  });
  const selection = selectTests({
    graph,
    changed: [`${BOX}src/theme.ts`, `${BOX}src/a.ts`, `${BOX}test/c.test.ts`, "bin/lib/x.ts"],
    spawnEdges: new Map([[`${BOX}test/spawn.test.ts`, new Set(["src/a.ts"])]]),
    exclude: [`${BOX}test/lib/git-lock.test.ts`],
  });
  assert.deepEqual(
    selection.reasons.map((group) => [group.tests.length, group.reason]),
    [
      // The excluded careful test is not counted: it is not selected.
      [3, `imports ${BOX}src/theme.ts`],
      [1, "graph cannot resolve its imports (always runs)"],
      [1, `imports ${BOX}src/a.ts`],
      [1, "imports bin/lib/x.ts"],
      [1, `spawns a child that runs ${BOX}src/a.ts`],
      [1, "the test itself changed"],
    ],
  );
  // Every selected test has at least one reason.
  const explained = new Set(selection.reasons.flatMap((group) => group.tests));
  assert.deepEqual([...explained].toSorted(), selection.selected);
  assert.equal(
    reasonSummary(selection.reasons, 2),
    `3 imports ${BOX}src/theme.ts; 1 graph cannot resolve its imports (always runs); 4 more reasons`,
  );
});

// ── spawner-edge detection ──────────────────────────────────────────────────

test("an import specifier is not a spawn target", () => {
  const source = ['import { box } from "../src/core/box.js";', "spawnSync('echo', ['hi']);"].join("\n");
  assert.deepEqual(spawnedSourceRefs(source), []);
});

test("a file with a source literal but no spawn is not a spawner", () => {
  assert.deepEqual(spawnedSourceRefs('const path = "./src/core/box.ts";'), []);
});

/** Write a fixture package: `files` maps package-relative path -> contents. */
function fixture(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "test-select-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, "pkg", rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("spawnerEdges catches a test whose CHILD imports source the parent does not", async () => {
  // Track 3c. The regression test for the TSX loader flake spawns twelve
  // children importing frontend source; no import edge reaches it, so no
  // change to that source would ever select it.
  const fx = fixture({
    "test/spawner.test.ts": [
      'import { execFile } from "node:child_process";',
      "const args = ['--eval', `await import('./src/child-only.ts')`];",
      "execFile(process.execPath, args);",
    ].join("\n"),
    "test/cli.test.ts": [
      'import { spawnSync } from "node:child_process";',
      'spawnSync("node", ["dist/cli.mjs", "--help"]);',
    ].join("\n"),
    "test/honest.test.ts": [
      'import { spawnSync } from "node:child_process";',
      'import { run } from "../src/run.js";',
      'spawnSync("node", ["../src/run.ts"]).status ?? run("x");',
    ].join("\n"),
    "src/child-only.ts": "export const childOnly = () => 1;\n",
    "src/run.ts": "export const run = (_p: string) => 1;\n",
  });
  try {
    const packageRoot = join(fx.root, "pkg");
    const graph = await buildGraphFrom({
      repoRoot: fx.root,
      packageRoot,
      aliases: {},
      entrypoints: testEntrypoints(packageRoot),
    });
    const edges = spawnerEdges({
      graph,
      readFile: (path) => readFileSync(join(fx.root, path), "utf-8"),
    });
    assert.deepEqual([...edges.keys()].toSorted(), [
      "pkg/test/cli.test.ts",
      "pkg/test/spawner.test.ts",
    ]);
    assert.deepEqual([...(edges.get("pkg/test/cli.test.ts") ?? [])], ["dist/cli.mjs"]);
    // The one that spawns a path it also imports is already reachable: the
    // graph selects it whenever src/run.ts changes.
    assert.equal(edges.has("pkg/test/honest.test.ts"), false);
  } finally {
    fx.cleanup();
  }
});

// ── the shell ───────────────────────────────────────────────────────────────

test("selected paths are relative to the beebox package, including root bin/ tests", () => {
  // A bin/ test runs from the package as ../bin/test/…; passed through
  // bare, the runner found no such file and refused the whole selection.
  assert.deepEqual(
    ["beebox/test/a.test.ts", "beebox/src/frontend/test/b.test.ts", "bin/test/lib/c.test.ts"].map(packageRelative),
    ["test/a.test.ts", "src/frontend/test/b.test.ts", "../bin/test/lib/c.test.ts"],
  );
});

test("an empty selection prints the reason and a summary line finish can parse", () => {
  assert.deepEqual(emptyRunLines(), [
    "no test imports the changed paths",
    "# { total: 0, pass: 0, selected: 0 }",
  ]);
});

test("an internal error exits non-zero — callers read that as 'run pnpm test'", () => {
  const result = spawnSync(
    process.execPath,
    binTsArgs("bin/test-select.ts", ["--base", "no-such-ref-here"]),
    { encoding: "utf-8", cwd: REPO_ROOT },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /test-select:/);
});
