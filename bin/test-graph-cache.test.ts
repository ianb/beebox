// Tests for the content-keyed cache over the derived import graph: what makes a
// hit, what makes a miss, and the guard against a file saved mid-build. Split
// from test-graph.test.ts, which covers the graph itself. Run with:
//   node --import tsx --test bin/test-graph-cache.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { buildGraphCached, testEntrypoints, REPO_ROOT } from "./test-graph.js";
import { fixture, type Fixture } from "./test-graph-fixture.js";
import type { TestGraph } from "./test-graph-query.js";
import { changedBetween, keyOf, keyPaths, stampPaths } from "./test-graph-cache.js";

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
    tests: [...graph.tests].map(([e, deps]) => [e, [...deps].toSorted()]).toSorted(),
    universe: [...graph.universe].toSorted(),
    unresolved: [...graph.unresolved].toSorted(),
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
