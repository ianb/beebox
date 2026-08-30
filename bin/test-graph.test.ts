// Tests for the derived test->source import graph. Runs the real esbuild pass
// over a synthetic fixture tree, so the edge cases that matter (ambiguity,
// directory-vs-file candidates, dangling imports) are exercised for real
// rather than mocked. Run with:
//   node --import tsx --test bin/test-graph.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGraphFrom } from "./test-graph.js";
import { fixture } from "./test-graph-fixture.js";
import { scopedChanges, type TestGraph } from "./test-graph-query.js";

/** Dependencies of one entrypoint, as package-relative paths. */
function depsOf(graph: TestGraph, entry: string): string[] {
  const deps = graph.tests.get(`pkg/${entry}`);
  assert.ok(deps !== undefined, `no graph entry for ${entry}; have ${[...graph.tests.keys()].join(", ")}`);
  return [...deps].map((d) => d.replace(/^pkg\//, "")).toSorted();
}

async function withFixture(files: Record<string, string>, fn: (g: TestGraph) => void): Promise<void> {
  const fx = fixture(files);
  try {
    fn(await buildGraphFrom(fx.config));
  } finally {
    fx.cleanup();
  }
}

test("a doctest's transitive imports all become edges", async () => {
  await withFixture(
    {
      "test/a.doctest.md": [
        "# a", "", "```ts setup", 'import { top } from "../src/top.js";', "```", "",
        "```ts", "top()", "=> 1", "```", "",
      ].join("\n"),
      "src/top.ts": 'import { deep } from "./deep.js";\nexport const top = () => deep();\n',
      "src/deep.ts": "export const deep = () => 1;\n",
      "src/unrelated.ts": "export const unrelated = 2;\n",
    },
    (graph) => {
      assert.deepEqual(depsOf(graph, "test/a.doctest.md"), [
        "src/deep.ts",
        "src/top.ts",
        "test/a.doctest.md",
      ]);
      // The file nothing imports is absent from the universe: that is what
      // makes "no test imports this" a state the selector can detect.
      assert.equal(graph.universe.has("pkg/src/unrelated.ts"), false);
    },
  );
});

test("a NodeNext .js specifier resolves to its .tsx sibling", async () => {
  await withFixture(
    {
      "test/a.doctest.md": [
        "# a", "", "```ts setup", 'import { widget } from "../src/widget.js";', "```", "",
        "```ts", "widget()", "=> 1", "```", "",
      ].join("\n"),
      "src/widget.tsx": "export const widget = () => 1;\n",
    },
    (graph) => {
      assert.deepEqual(depsOf(graph, "test/a.doctest.md"), ["src/widget.tsx", "test/a.doctest.md"]);
    },
  );
});

test("a directory is never mistaken for a module — the index file wins", async () => {
  // Regression: `existsSync` alone matches the DIRECTORY `src/trpc` for the
  // specifier `../src/trpc`, and esbuild then fails with "is a directory".
  // This is the same directory-index shape as the loader's known TSX flake.
  await withFixture(
    {
      "test/a.doctest.md": [
        "# a", "", "```ts setup", 'import { client } from "../src/trpc";', "```", "",
        "```ts", "client()", "=> 1", "```", "",
      ].join("\n"),
      "src/trpc/index.ts": "export const client = () => 1;\n",
    },
    (graph) => {
      assert.deepEqual(depsOf(graph, "test/a.doctest.md"), ["src/trpc/index.ts", "test/a.doctest.md"]);
      assert.equal(graph.unresolved.size, 0);
    },
  );
});

test("an ambiguous specifier yields BOTH candidates as edges", async () => {
  // Over-approximating costs extra test runs; picking one silently loses an
  // edge, which is a shipped regression. Both must appear.
  await withFixture(
    {
      "test/a.doctest.md": [
        "# a", "", "```ts setup", 'import { pick } from "../src/pick.js";', "```", "",
        "```ts", "pick()", "=> 1", "```", "",
      ].join("\n"),
      "src/pick.ts": "export const pick = () => 1;\n",
      "src/pick.tsx": "export const pick = () => 2;\n",
    },
    (graph) => {
      assert.ok(graph.ambiguousEdges > 0, "expected the ambiguity to be counted");
      // Asserting only `universe` is what let a real bug through: extras were
      // in `universe` (so `isAccounted` said yes) but in no test's deps (so
      // `implicatedTests` selected nothing) — a change to the extra candidate
      // would have looked understood and run almost nothing. Assert BOTH, and
      // assert implication, which is what actually gets used.
      assert.deepEqual(depsOf(graph, "test/a.doctest.md"), [
        "src/pick.ts",
        "src/pick.tsx",
        "test/a.doctest.md",
      ]);
      assert.ok(graph.universe.has("pkg/src/pick.ts"));
      assert.ok(graph.universe.has("pkg/src/pick.tsx"));
    },
  );
});

test("a dangling import marks its entrypoint unresolved without failing the build", async () => {
  await withFixture(
    {
      "test/broken.doctest.md": [
        "# broken", "", "```ts setup", 'import { gone } from "../src/gone.js";', "```", "",
        "```ts", "gone()", "=> 1", "```", "",
      ].join("\n"),
      "test/fine.doctest.md": [
        "# fine", "", "```ts setup", 'import { ok } from "../src/ok.js";', "```", "",
        "```ts", "ok()", "=> 1", "```", "",
      ].join("\n"),
      "src/ok.ts": "export const ok = () => 1;\n",
    },
    (graph) => {
      assert.ok(
        graph.unresolved.has("pkg/test/broken.doctest.md"),
        `expected broken.doctest.md unresolved, got ${[...graph.unresolved].join(", ")}`,
      );
      // One broken import must not disable selection for everything else.
      assert.equal(graph.unresolved.has("pkg/test/fine.doctest.md"), false);
    },
  );
});

test("the @shared alias resolves, and only the configured prefix does", async () => {
  await withFixture(
    {
      "test/a.doctest.md": [
        "# a", "", "```ts setup", 'import { s } from "@shared/thing.js";', "```", "",
        "```ts", "s()", "=> 1", "```", "",
      ].join("\n"),
      "src/shared/thing.ts": "export const s = () => 1;\n",
    },
    (graph) => {
      assert.deepEqual(depsOf(graph, "test/a.doctest.md"), ["src/shared/thing.ts", "test/a.doctest.md"]);
    },
  );
});

// ── scope ───────────────────────────────────────────────────────────────────

test("paths outside beebox cannot make a change unaccounted", () => {
  // /finish routes bin/, issues/, ios-app/ etc. to their own verification.
  // Treating them as unaccounted here would send almost every branch to the
  // full suite for reasons that have nothing to do with this suite.
  assert.deepEqual(
    scopedChanges([
      "bin/test-graph.ts",
      "issues/bugs/x.md",
      "ios-app/App.swift",
      "research/notes.md",
      "beebox/src/core/box.ts",
    ]),
    ["beebox/src/core/box.ts"],
  );
});

test("prose markdown is out of scope, but a .doctest.md is not", () => {
  // Load-bearing: counting prose drops the accounted rate from 63% to 27%.
  // Safe only because no doctest reads the repo's own prose — doc-check does,
  // and it is a pre-commit hook outside tap.
  assert.deepEqual(
    scopedChanges([
      "beebox/docs/testing.md",
      "beebox/docs/security-overview.md",
      "beebox/src/services/CLAUDE.md",
      "beebox/test/core/box.doctest.md",
    ]),
    ["beebox/test/core/box.doctest.md"],
  );
});

test("dependency manifests stay in scope", () => {
  assert.deepEqual(scopedChanges(["package.json", "pnpm-lock.yaml"]), ["package.json", "pnpm-lock.yaml"]);
});

test("test/manual is excluded, mirroring .taprc", async () => {
  await withFixture(
    {
      "test/a.doctest.md": ["# a", "", "```ts", "1", "=> 1", "```", ""].join("\n"),
      "test/manual/slow.doctest.md": ["# slow", "", "```ts", "1", "=> 1", "```", ""].join("\n"),
    },
    (graph) => {
      assert.deepEqual([...graph.tests.keys()], ["pkg/test/a.doctest.md"]);
    },
  );
});
