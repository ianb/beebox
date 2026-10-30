import assert from "node:assert/strict";
import test from "node:test";
import type { TestGraph } from "./test-graph-query.js";
import { binUnit, changedBinUnits, selectTests, spawnedSourceRefs, spawnerEdges } from "./test-select-lib.js";

const SPAWNS_WORKSTREAMS = 'const ws = join(root, "bin/workstreams");\nawait execFileAsync(ws, ["list"]);';
const SPAWNS_SCHEDULES_DIR = 'spawnSync("node", ["bin/schedules/run.ts"]);';
const SPAWNS_ONLY_SRC = 'spawnSync("node", ["src/cli/child.ts"]);';

const sources: Record<string, string> = {
  "bin/test/ws.test.ts": SPAWNS_WORKSTREAMS,
  "beebox/test/sched.test.ts": SPAWNS_SCHEDULES_DIR,
  "beebox/test/child.test.ts": SPAWNS_ONLY_SRC,
};

function graphOf(entries: string[]): TestGraph {
  return {
    tests: new Map(entries.map((entry) => [entry, new Set<string>()])),
    universe: new Set(),
    unresolved: new Set(),
    ambiguousEdges: 0,
    buildMs: 0,
    cached: false,
  };
}

const graph = graphOf(Object.keys(sources));
const spawnEdges = spawnerEdges({ graph, readFile: (path) => sources[path] ?? null });
const select = (...changed: string[]): string[] => selectTests({ graph, changed, spawnEdges }).selected;

test("a spawn literal naming bin/<script> becomes a ref, with any extension or none", () => {
  assert.deepEqual(spawnedSourceRefs(SPAWNS_WORKSTREAMS), ["bin/workstreams"]);
  assert.deepEqual(spawnedSourceRefs(SPAWNS_SCHEDULES_DIR), ["bin/schedules/run.ts"]);
});

test("system and package-local bin paths are not refs", () => {
  const source = 'spawnSync("/bin/sh", ["-c", "#!/bin/sh"]); spawn("/usr/bin/env"); spawn("node_modules/.bin/tsx"); spawn("beebox/bin/other");';
  assert.deepEqual(spawnedSourceRefs(source), []);
});

test("a bin/ unit is the first segment under bin/, without its extension", () => {
  assert.equal(binUnit("bin/workstreams"), "workstreams");
  assert.equal(binUnit("bin/schedules/run.ts"), "schedules");
  assert.equal(binUnit("bin/test-select.ts"), "test-select");
  assert.equal(binUnit("beebox/bin/other"), null);
  assert.deepEqual([...changedBinUnits(["bin/test/ws.test.ts", "bin/land", "x.ts"])], ["land"]);
});

test("a change to bin/workstreams selects the test that spawns it, and no other", () => {
  assert.deepEqual(select("bin/workstreams"), ["bin/test/ws.test.ts"]);
});

test("a change inside a spawned directory selects that spawner", () => {
  assert.deepEqual(select("bin/schedules/other.ts"), ["beebox/test/sched.test.ts"]);
});

test("a change to shared bin/lib code selects every bin spawner", () => {
  assert.deepEqual(select("bin/lib/session-registry.sh"), ["beebox/test/sched.test.ts", "bin/test/ws.test.ts"]);
  // The reason says the match is a guess; a direct ref match says what the child runs.
  const reasons = (changed: string) =>
    selectTests({ graph, changed: [changed], spawnEdges }).reasons.map((group) => group.reason);
  assert.deepEqual(reasons("bin/lib/session-registry.sh"), ["spawns a bin/ script, which may source bin/lib/session-registry.sh"]);
  assert.deepEqual(reasons("bin/workstreams"), ["spawns a child that runs bin/workstreams"]);
  // The child runs bin/schedules/run.ts; the changed file only shares its unit.
  assert.deepEqual(reasons("bin/schedules/other.ts"), ["spawns a bin/schedules script; bin/schedules/other.ts is in that unit"]);
});

test("a change to an unrelated bin script selects nothing", () => {
  assert.deepEqual(select("bin/land"), []);
});

test("a changed root test under bin/test selects itself", () => {
  assert.deepEqual(select("bin/test/ws.test.ts"), ["bin/test/ws.test.ts"]);
});

test("a root test that imports a changed bin file is selected", () => {
  const importing = graphOf(["bin/test/lib/x.test.ts"]);
  importing.tests.set("bin/test/lib/x.test.ts", new Set(["bin/lib/x.ts"]));
  assert.deepEqual(selectTests({ graph: importing, changed: ["bin/lib/x.ts"] }).selected, ["bin/test/lib/x.test.ts"]);
});

test("src and dist behaviour is unchanged by bin edges", () => {
  assert.deepEqual(spawnedSourceRefs(SPAWNS_ONLY_SRC), ["src/cli/child.ts"]);
  assert.deepEqual(select("beebox/src/cli/child.ts"), ["beebox/test/child.test.ts"]);
  assert.deepEqual(select("beebox/src/other.ts"), []);
});
