// # Per-agent model carry
//
// A session's provider must not change mid-life: re-invocations that omit a
// model (the commit-nudge retry) resume the same session, so they must reuse
// the model of the invocation that created it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createModelCarrier } from "../../../../src/core/agent/invoke/model-carry.js";

// ## Omitted models ride the first explicit one
void test("Omitted models ride the first explicit one", async (t) => {
  // doctest:L14
  const carrier = createModelCarrier();
  carrier.resolve("glm-5.3");
  t.check(carrier.resolve(undefined), "glm-5.3");

  // ## An explicit model replaces the carried one
  //
  // A caller naming a model still wins — the carry only fills absences.

  // doctest:L25
  carrier.resolve("glm-5.3-flash");
  t.check(carrier.resolve(undefined), "glm-5.3-flash");
});

// ## Never-carried instances pass undefined through
//
// An agent whose callers never named a model keeps the harness default — the
// carry must not invent one.
void test("An agent whose callers never named a model keeps the harness default — the ca...", async (t) => {
  // doctest:L36
  const bare = createModelCarrier();
  t.check(bare.resolve(undefined), undefined);
});
