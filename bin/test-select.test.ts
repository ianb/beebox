// Tests for change-based test selection. A `.test.ts` rather than the
// doctest this directory's CLAUDE.md asks for, for the same reason
// bin/test-graph.test.ts is one: the thing under test decides which doctests
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
import { selectTests, spawnedSourceRefs, spawnerEdges } from "./test-select-lib.js";
import { emptyRunLines } from "./test-select.js";

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
    unresolved: new Set(input.unresolved ?? []),
    ambiguousEdges: 0,
    buildMs: 0,
  };
}

const BOX = "callback-box/";

test("the union rule: implicated tests, and only paths this suite could care about", () => {
  const graph = graphOf({
    tests: {
      [`${BOX}test/core/box.doctest.md`]: [`${BOX}src/core/box.ts`],
      [`${BOX}test/cli/init.doctest.md`]: [`${BOX}src/cli/init.ts`],
    },
  });
  const selection = selectTests({
    graph,
    changed: [
      `${BOX}src/core/box.ts`,
      // Out of scope entirely: another package, and prose inside this one.
      "bin/router.ts",
      "issues/bugs/x.md",
      `${BOX}docs/testing.md`,
    ],
    spawnEdges: new Map([[`${BOX}test/cli/init.doctest.md`, new Set(["src/core/box.ts"])]]),
  });
  assert.deepEqual(selection.selected, [
    `${BOX}test/cli/init.doctest.md`,
    `${BOX}test/core/box.doctest.md`,
  ]);
  assert.deepEqual(selection.scoped, [`${BOX}src/core/box.ts`]);
});

test("a spawner is selected by a change to what it spawns, and by nothing else", () => {
  // Until the 2026-08-25 revision every spawner ran on every selected run —
  // ~10 files and ~35s whatever the change was. The refs are edges now.
  const graph = graphOf({
    tests: {
      [`${BOX}test/cli/spawner.test.ts`]: [],
      [`${BOX}test/core/box.doctest.md`]: [`${BOX}src/core/box.ts`],
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
    [`${BOX}test/core/box.doctest.md`],
  );
});

test("a dist/cli.mjs spawner follows the bundle's real inputs", () => {
  // `scripts/build-cli.ts` bundles src/cli/index.ts TRANSITIVELY — 932 files
  // across nearly every src/ subtree, not src/cli/**. The caller computes the
  // set; a null one fails open on all of src/.
  const graph = graphOf({ tests: { [`${BOX}test/cli/cli.doctest.md`]: [] } });
  const spawnEdges = new Map([[`${BOX}test/cli/cli.doctest.md`, new Set(["dist/cli.mjs"])]]);
  const cliBundleInputs = new Set([`${BOX}src/core/box.ts`]);
  assert.deepEqual(
    selectTests({ graph, changed: [`${BOX}src/core/box.ts`], spawnEdges, cliBundleInputs }).selected,
    [`${BOX}test/cli/cli.doctest.md`],
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
    [`${BOX}test/cli/cli.doctest.md`],
  );
});

test("a change nothing imports selects nothing — there is no full-suite fallback", () => {
  // Three quarters of branches look like this. The honest description of a
  // change to untested code is "this code has no tests"; running 627 files
  // hides that rather than fixing it (plan revision 2026-08-25).
  const graph = graphOf({ tests: { [`${BOX}test/core/box.doctest.md`]: [`${BOX}src/core/box.ts`] } });
  const selection = selectTests({
    graph,
    changed: [`${BOX}src/frontend/src/components/Untested.tsx`],
  });
  assert.deepEqual(selection.selected, []);
  assert.deepEqual(selection.implicated, []);
});

test("nothing in scope means nothing selected, spawners included", () => {
  const graph = graphOf({ tests: { [`${BOX}test/a.doctest.md`]: [] } });
  const selection = selectTests({
    graph,
    changed: ["bin/test-select.ts", "issues/features/y.md"],
    spawnEdges: new Map([[`${BOX}test/a.doctest.md`, new Set(["src/a.ts", "dist/cli.mjs"])]]),
  });
  assert.deepEqual(selection.selected, []);
});

test("a changed doctest selects itself", () => {
  const graph = graphOf({ tests: { [`${BOX}test/core/box.doctest.md`]: [`${BOX}src/core/box.ts`] } });
  const selection = selectTests({ graph, changed: [`${BOX}test/core/box.doctest.md`] });
  assert.deepEqual(selection.selected, [`${BOX}test/core/box.doctest.md`]);
});

test("an unresolved entrypoint is always selected — a missing edge fails open", () => {
  const graph = graphOf({
    tests: { [`${BOX}test/core/box.doctest.md`]: [`${BOX}src/core/box.ts`] },
    unresolved: [`${BOX}test/broken.doctest.md`],
  });
  const selection = selectTests({ graph, changed: [`${BOX}src/core/box.ts`] });
  assert.deepEqual(selection.selected, [
    `${BOX}test/broken.doctest.md`,
    `${BOX}test/core/box.doctest.md`,
  ]);
});

test("an excluded (careful-tier) test is dropped unless it is what changed", () => {
  // The seam for mechanism C. The exclusion is about not paying for a flaky
  // neighbour, not about skipping the test you just edited.
  const graph = graphOf({
    tests: {
      [`${BOX}test/lib/git-lock.doctest.md`]: [`${BOX}src/lib/git.ts`],
      [`${BOX}test/lib/git.doctest.md`]: [`${BOX}src/lib/git.ts`],
    },
  });
  const exclude = [`${BOX}test/lib/git-lock.doctest.md`];
  assert.deepEqual(selectTests({ graph, changed: [`${BOX}src/lib/git.ts`], exclude }).selected, [
    `${BOX}test/lib/git.doctest.md`,
  ]);
  assert.deepEqual(
    selectTests({ graph, changed: [`${BOX}test/lib/git-lock.doctest.md`], exclude }).selected,
    [`${BOX}test/lib/git-lock.doctest.md`],
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

const doctest = (lines: string[]): string => [...lines, ""].join("\n");

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
    "test/cli.doctest.md": doctest([
      "# cli",
      "",
      "```ts setup",
      'import { spawnSync } from "node:child_process";',
      "```",
      "",
      "```ts",
      'spawnSync("node", ["dist/cli.mjs", "--help"]).status',
      "=> 0",
      "```",
    ]),
    "test/honest.doctest.md": doctest([
      "# honest",
      "",
      "```ts setup",
      'import { spawnSync } from "node:child_process";',
      'import { run } from "../src/run.js";',
      "```",
      "",
      "```ts",
      'spawnSync("node", ["../src/run.ts"]).status ?? run("x")',
      "=> 1",
      "```",
    ]),
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
    assert.deepEqual([...edges.keys()].sort(), [
      "pkg/test/cli.doctest.md",
      "pkg/test/spawner.test.ts",
    ]);
    assert.deepEqual([...(edges.get("pkg/test/cli.doctest.md") ?? [])], ["dist/cli.mjs"]);
    // The one that spawns a path it also imports is already reachable: the
    // graph selects it whenever src/run.ts changes.
    assert.equal(edges.has("pkg/test/honest.doctest.md"), false);
  } finally {
    fx.cleanup();
  }
});

// ── the shell ───────────────────────────────────────────────────────────────

test("an empty selection prints the reason and a summary line finish can parse", () => {
  assert.deepEqual(emptyRunLines(), [
    "no test imports the changed paths",
    "# { total: 0, pass: 0, selected: 0 }",
  ]);
});

test("an internal error exits non-zero — callers read that as 'run pnpm test'", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(REPO_ROOT, "bin/test-select.ts"), "--base", "no-such-ref-here"],
    { encoding: "utf-8", cwd: REPO_ROOT },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /test-select:/);
});
