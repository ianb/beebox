import assert from "node:assert/strict";
import { test } from "node:test";
import { CANONICAL_ORIGIN, docsOrigin } from "./docs-origin.js";

test("docsOrigin: the canonical base resolves to the canonical host", () => {
  assert.equal(docsOrigin("/"), CANONICAL_ORIGIN);
  assert.equal(CANONICAL_ORIGIN, "https://beebox.run");
});

test("docsOrigin: any other base resolves to the local dev router", () => {
  assert.equal(docsOrigin("/main/site/"), "http://localhost:3210");
  assert.equal(docsOrigin("/some-worktree/site/"), "http://localhost:3210");
});
