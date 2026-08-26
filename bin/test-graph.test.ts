// Tests for the derived test->source import graph. Runs the real esbuild pass
// over a synthetic fixture tree, so the edge cases that matter (ambiguity,
// directory-vs-file candidates, dangling imports) are exercised for real
// rather than mocked. Run with:
//   node --import tsx --test bin/test-graph.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  buildGraphCached,
  buildGraphFrom,
  testEntrypoints,
  REPO_ROOT,
  type GraphConfig,
} from "./test-graph.js";
import { scopedChanges, type TestGraph } from "./test-graph-query.js";
import { changedBetween, keyOf, keyPaths, stampPaths } from "./test-graph-cache.js";

interface Fixture {
  root: string;
  config: GraphConfig;
  cleanup: () => void;
}

/** Write a fixture package: `files` maps package-relative path -> contents. */
function fixture(files: Record<string, string>): Fixture {
  const root = mkdtempSync(join(tmpdir(), "test-graph-"));
  const packageRoot = join(root, "pkg");
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(packageRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return {
    root,
    config: {
      repoRoot: root,
      packageRoot,
      aliases: { "@shared/": join(packageRoot, "src/shared") },
      entrypoints: testEntrypoints(packageRoot),
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Dependencies of one entrypoint, as package-relative paths. */
function depsOf(graph: TestGraph, entry: string): string[] {
  const deps = graph.tests.get(`pkg/${entry}`);
  assert.ok(deps !== undefined, `no graph entry for ${entry}; have ${[...graph.tests.keys()].join(", ")}`);
  return [...deps].map((d) => d.replace(/^pkg\//, "")).sort();
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

test("paths outside callback-box cannot make a change unaccounted", () => {
  // /finish routes bin/, issues/, ios-app/ etc. to their own verification.
  // Treating them as unaccounted here would send almost every branch to the
  // full suite for reasons that have nothing to do with this suite.
  assert.deepEqual(
    scopedChanges([
      "bin/test-graph.ts",
      "issues/bugs/x.md",
      "ios-app/App.swift",
      "research/notes.md",
      "callback-box/src/core/box.ts",
    ]),
    ["callback-box/src/core/box.ts"],
  );
});

test("prose markdown is out of scope, but a .doctest.md is not", () => {
  // Load-bearing: counting prose drops the accounted rate from 63% to 27%.
  // Safe only because no doctest reads the repo's own prose — doc-check does,
  // and it is a pre-commit hook outside tap.
  assert.deepEqual(
    scopedChanges([
      "callback-box/docs/testing.md",
      "callback-box/docs/security-overview.md",
      "callback-box/src/services/CLAUDE.md",
      "callback-box/test/core/box.doctest.md",
    ]),
    ["callback-box/test/core/box.doctest.md"],
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

// ── the content-keyed cache ─────────────────────────────────────────────────

/** A fixture plus a cache dir of its own, so runs cannot see each other's. */
async function withCache(
  files: Record<string, string>,
  fn: (input: {
    fx: Fixture;
    cacheDir: string;
    build: () => Promise<TestGraph>;
    touch: (rel: string) => void;
    write: (rel: string, contents: string) => void;
  }) => Promise<void>,
): Promise<void> {
  const fx = fixture(files);
  const cacheDir = join(fx.root, "cache");
  const packageRoot = join(fx.root, "pkg");
  try {
    await fn({
      fx,
      cacheDir,
      // Entrypoints are re-globbed per call, exactly as the real callers do.
      build: () =>
        buildGraphCached({ ...fx.config, entrypoints: testEntrypoints(packageRoot) }, { cacheDir }),
      touch: (rel) => {
        const now = new Date(Date.now() + 5000);
        utimesSync(join(packageRoot, rel), now, now);
      },
      write: (rel, contents) => {
        mkdirSync(dirname(join(packageRoot, rel)), { recursive: true });
        writeFileSync(join(packageRoot, rel), contents);
      },
    });
  } finally {
    fx.cleanup();
  }
}

/** Everything about a graph except where it came from and how long it took. */
function shape(graph: TestGraph): unknown {
  return {
    tests: [...graph.tests].map(([e, deps]) => [e, [...deps].sort()]).sort(),
    universe: [...graph.universe].sort(),
    unresolved: [...graph.unresolved].sort(),
    ambiguousEdges: graph.ambiguousEdges,
  };
}

const CACHE_FILES = {
  "test/a.doctest.md": [
    "# a", "", "```ts setup", 'import { top } from "../src/top.js";', "```", "",
    "```ts", "top()", "=> 1", "```", "",
  ].join("\n"),
  "src/top.ts": "export const top = () => 1;\n",
};

test("a second call reuses the cached graph rather than rebuilding", async () => {
  await withCache(CACHE_FILES, async ({ build }) => {
    const cold = await build();
    const warm = await build();
    assert.equal(cold.cached, false);
    assert.equal(warm.cached, true);
    assert.deepEqual(shape(warm), shape(cold));
  });
});

test("touching a file in the universe invalidates the cache", async () => {
  await withCache(CACHE_FILES, async ({ build, touch }) => {
    await build();
    touch("src/top.ts");
    assert.equal((await build()).cached, false);
  });
});

test("a new test entrypoint invalidates the cache", async () => {
  // The gap this closes: a new file is in no cached universe, so only the
  // re-globbed entrypoint list can notice it.
  await withCache(CACHE_FILES, async ({ build, write }) => {
    await build();
    write("test/b.doctest.md", ["# b", "", "```ts", "1", "=> 1", "```", ""].join("\n"));
    const rebuilt = await build();
    assert.equal(rebuilt.cached, false);
    assert.ok(rebuilt.tests.has("pkg/test/b.doctest.md"));
  });
});

test("a corrupt cache file is rebuilt, not thrown", async () => {
  await withCache(CACHE_FILES, async ({ build, cacheDir }) => {
    const cold = await build();
    const [name] = readdirSync(cacheDir);
    assert.ok(name !== undefined, "expected the cold build to have written a cache file");
    writeFileSync(join(cacheDir, name), "{not json");
    const rebuilt = await build();
    assert.equal(rebuilt.cached, false);
    assert.deepEqual(shape(rebuilt), shape(cold));
  });
});

test("--no-cache rebuilds even on a hit, and refreshes the cache", async () => {
  await withCache(CACHE_FILES, async ({ fx, cacheDir }) => {
    const config = { ...fx.config, entrypoints: testEntrypoints(join(fx.root, "pkg")) };
    await buildGraphCached(config, { cacheDir });
    assert.equal((await buildGraphCached(config, { cacheDir, cache: false })).cached, false);
    assert.equal((await buildGraphCached(config, { cacheDir })).cached, true);
  });
});

test("a file saved DURING the build is not cached against the old edges", async () => {
  // The key can only be computed after the build, so a mid-build write would
  // be stored as the stamp of edges that predate it — a hit that stays stale
  // until something else moves. The guard is a pre-build stamp of the same
  // set, which is only possible for a universe an earlier run established.
  await withCache(CACHE_FILES, async ({ build, touch }) => {
    await build();
    touch("test/a.doctest.md"); // force the next call to rebuild
    // Fires as soon as the event loop turns, well inside the esbuild pass.
    setTimeout(() => touch("src/top.ts"), 0);
    assert.equal((await build()).cached, false);
    // The guard refused to write, so the next call has to build again.
    assert.equal((await build()).cached, false);
    // And once nothing is moving, caching resumes.
    assert.equal((await build()).cached, true);
  });
});

test("changedBetween names exactly what moved between two sweeps", () => {
  assert.deepEqual(
    changedBetween({
      paths: ["a", "b", "c"],
      before: new Map([["a", "1 2"], ["b", "3 4"], ["c", "absent"]]),
      after: new Map([["a", "1 2"], ["b", "9 4"], ["c", "5 6"]]),
    }),
    ["b", "c"],
  );
});

test("the entrypoint list is keyed as membership, not only as stamps", () => {
  // Dropping an entrypoint whose file still exists changes no stamp in the
  // set, so only the list itself can carry the difference.
  const shared = {
    aliases: {},
    paths: ["/x/a.test.ts"],
    stamps: new Map([["/x/a.test.ts", "1 2"]]),
  };
  assert.notEqual(
    keyOf({ ...shared, entrypoints: ["/x/a.test.ts", "/x/b.test.ts"] }),
    keyOf({ ...shared, entrypoints: ["/x/a.test.ts"] }),
  );
  // Order is not membership.
  assert.equal(
    keyOf({ ...shared, entrypoints: ["/x/b.test.ts", "/x/a.test.ts"] }),
    keyOf({ ...shared, entrypoints: ["/x/a.test.ts", "/x/b.test.ts"] }),
  );
});

test("the key covers the config inputs, not just the graph's files", () => {
  const fx = fixture({ "tsconfig.json": "{}\n" });
  try {
    const paths = keyPaths({ ...fx.config, universe: [] });
    const packageRoot = join(fx.root, "pkg");
    for (const expected of [
      join(packageRoot, "tsconfig.json"),
      join(packageRoot, ".taprc"),
      join(REPO_ROOT, "agent-doctest/package.json"),
      join(REPO_ROOT, "node_modules/esbuild/package.json"),
      join(REPO_ROOT, "bin/test-graph.ts"),
    ]) {
      assert.ok(paths.includes(expected), `expected ${expected} in the keyed set`);
    }
  } finally {
    fx.cleanup();
  }
});

test("a stat that fails for a reason other than absence poisons the key", () => {
  // An absent file is a fact (it stamps as `absent`); an unreadable one is an
  // unknown, and guessing there is how a stale graph becomes permanent.
  assert.deepEqual(stampPaths(["/definitely/not/here.ts"]), new Map([["/definitely/not/here.ts", "absent"]]));
  assert.equal(stampPaths(["/bad\0path.ts"]), null);
});
