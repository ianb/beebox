import assert from "node:assert/strict";
import test from "node:test";
import { attributableLanding, unbisectedFiles } from "./attribution.js";

const deployed = { commit: "a".repeat(40), subject: "Merge branch 'worktree-code'" };
const docsOnly = { commit: "b".repeat(40), subject: "docs: report red" };

test("a docs-only landing is skipped as a culprit", () => {
  const attributable = new Set([deployed.commit]);
  assert.equal(attributableLanding({ found: docsOnly, attributableCommits: attributable }), null);
  assert.deepEqual(attributableLanding({ found: deployed, attributableCommits: attributable }), deployed);
});

test("a baseline run keeps every new red visible as unattributed", () => {
  assert.deepEqual(unbisectedFiles({ real: ["test/a.test.ts"], bisectable: [] }), ["test/a.test.ts"]);
});
