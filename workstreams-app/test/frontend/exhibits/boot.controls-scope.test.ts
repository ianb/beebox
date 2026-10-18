// # The scope of a raw exhibit page
//
// A raw `index.html` exhibit that opts into the control bar has no boot
// payload; the bar learns which exhibit it is on from the page URL. The scope
// is the first two path segments, and a committed app under `apps/` is not a
// store exhibit, so it gets no bar.

import { test } from "tap";
import "agent-doctest/tap";
import { isStoreScope, scopeFromPath } from "../../../src/frontend/exhibits/controls/scope.js";

void test("line 12", async (t) => {
  // doctest:L13
  t.check(
    [
      scopeFromPath("/logo-bakeoff/round-3/"),
      scopeFromPath("/logo-bakeoff/round-3"),
      scopeFromPath("/logo-bakeoff/round-3/figures/a.png"),
      scopeFromPath("/logo-bakeoff/"),
      scopeFromPath("/"),
      scopeFromPath("/apps/instrument/"),
    ],
    [
    "logo-bakeoff/round-3",
    "logo-bakeoff/round-3",
    "logo-bakeoff/round-3",
    null,
    null,
    "apps/instrument",
  ],
  );
});

void test("line 24", async (t) => {
  // doctest:L25
  t.check([isStoreScope("logo-bakeoff/round-3"), isStoreScope("apps/instrument"), isStoreScope("main/x")], [
    true,
    false,
    true,
  ]);
});
