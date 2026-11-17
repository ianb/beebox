// The playground lists every example, by its file name, and nothing else.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { REGISTRY } from "../../../src/browser/app/registry.js";

test("the playground registry holds exactly the examples in src/examples/", () => {
  const dir = new URL("../../../src/examples/", import.meta.url);
  const examples = readdirSync(dir).filter((f) => f.endsWith("-tea.ts")).map((f) => f.slice(0, -"-tea.ts".length));
  assert.deepEqual(REGISTRY.map((entry) => entry.id).toSorted(), examples.toSorted());
});
