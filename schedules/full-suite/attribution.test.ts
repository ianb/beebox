import assert from "node:assert/strict";
import test from "node:test";
import type { TestGraph } from "../../bin/test-graph-query.js";
import { landingReachesFile, unbisectedFiles } from "./attribution.js";

/** A graph with one resolved test importing one source file, and one unresolved. */
function graph(): TestGraph {
  return {
    tests: new Map([
      ["beebox/test/a.test.ts", new Set(["beebox/src/a.ts"])],
      ["beebox/test/unresolved.test.ts", new Set<string>()],
    ]),
    universe: new Set(["beebox/test/a.test.ts", "beebox/src/a.ts"]),
    unresolved: new Set(["beebox/test/unresolved.test.ts"]),
    ambiguousEdges: 0,
    buildMs: 0,
    cached: true,
  };
}

const reach = (changed: string[], file: string): boolean =>
  landingReachesFile({ graph: graph(), spawnEdges: new Map(), cliBundleInputs: new Set(), changed, file });

test("a landing that imports into the failing test is reachable; an unrelated one is not", () => {
  assert.equal(reach(["beebox/src/a.ts"], "test/a.test.ts"), true);
  assert.equal(reach(["beebox/src/other.ts"], "test/a.test.ts"), false);
});

test("a landing outside the suite's scope reaches nothing — even an unresolved test", () => {
  // The 2026-08-31 false reds: `bin/`-only landings blamed for `src/core` and
  // `src/frontend` tests. `bin/` is out of scope for the beebox suite entirely.
  assert.equal(reach(["bin/router-config.ts", "issues/bugs/x.md"], "test/a.test.ts"), false);
  assert.equal(reach(["bin/router-config.ts"], "test/unresolved.test.ts"), false);
});

test("an unresolved entrypoint is reachable by any in-scope change", () => {
  assert.equal(reach(["beebox/src/other.ts"], "test/unresolved.test.ts"), true);
});

test("a baseline run keeps every new red visible as unattributed", () => {
  assert.deepEqual(unbisectedFiles({ real: ["test/a.test.ts"], bisectable: [] }), ["test/a.test.ts"]);
});

test("a failing file named the way tap reports it maps back to its graph path", () => {
  // TAP reports `src/frontend/test/...` relative to beebox and a root doctest
  // as `../bin/test/...`; the graph keys are repo-relative.
  const g = graph();
  g.tests.set("beebox/src/frontend/test/f.doctest.md", new Set(["beebox/src/frontend/x.ts"]));
  g.tests.set("bin/test/b.doctest.md", new Set(["beebox/src/a.ts"]));
  const frontend = (changed: string[]): boolean =>
    landingReachesFile({ graph: g, spawnEdges: new Map(), cliBundleInputs: new Set(), changed, file: "src/frontend/test/f.doctest.md" });
  assert.equal(frontend(["beebox/src/frontend/x.ts"]), true);
  assert.equal(frontend(["beebox/src/a.ts"]), false);
  const root = landingReachesFile({ graph: g, spawnEdges: new Map(), cliBundleInputs: new Set(), changed: ["beebox/src/a.ts"], file: "../bin/test/b.doctest.md" });
  assert.equal(root, true);
});

test("a bin/ landing reaches a test that spawns that script, but not unresolved or unrelated ones", () => {
  const g = graph();
  g.tests.set("bin/test/ws.doctest.md", new Set<string>());
  const spawnEdges = new Map([["bin/test/ws.doctest.md", new Set(["bin/workstreams"])]]);
  const bin = (changed: string[], file: string): boolean =>
    landingReachesFile({ graph: g, spawnEdges, cliBundleInputs: new Set(), changed, file });
  assert.equal(bin(["bin/lib/session-registry.sh"], "../bin/test/ws.doctest.md"), true);
  assert.equal(bin(["bin/workstreams"], "../bin/test/ws.doctest.md"), true);
  assert.equal(bin(["bin/land"], "../bin/test/ws.doctest.md"), false);
  assert.equal(bin(["bin/workstreams"], "test/unresolved.test.ts"), false);
});
