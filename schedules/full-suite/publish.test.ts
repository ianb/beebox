import assert from "node:assert/strict";
import test from "node:test";
import { imagePublishDue } from "./publish.js";

const last = { commit: "a".repeat(40), dispatchedAt: "2026-10-24T06:00:00.000Z" };

test("the first green run publishes", () => {
  assert.equal(imagePublishDue({ last: null, commit: "b".repeat(40), now: new Date("2026-10-24T07:00:00Z") }), true);
});

test("the same commit is never sent twice", () => {
  assert.equal(imagePublishDue({ last, commit: last.commit, now: new Date("2026-10-26T07:00:00Z") }), false);
});

test("a new commit waits for the next UTC day", () => {
  assert.equal(imagePublishDue({ last, commit: "b".repeat(40), now: new Date("2026-10-24T23:59:00Z") }), false);
  assert.equal(imagePublishDue({ last, commit: "b".repeat(40), now: new Date("2026-10-25T00:01:00Z") }), true);
});
