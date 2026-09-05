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
