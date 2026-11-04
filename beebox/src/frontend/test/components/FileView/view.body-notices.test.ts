// A card body stays mounted while an "out of date" or "section not found"
// marker comes and goes above it. A failed re-read (the file briefly missing,
// the box restarting) must not reset the body under the reader. Issue:
// issues/bugs/2026-11-03-card-contents-menu-collapses-and-reappears.md
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, useEffect } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { withBodyNotices } from "../../../src/components/FileView/view.js";

let mounts = 0;
function Body() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return h("p", { id: "body" }, "The card's text.");
}

function render({ stale, sectionMissed }: { stale: boolean; sectionMissed: boolean }) {
  const failure = stale ? { headline: "Card not found: x.doc.card", detail: "" } : null;
  return h("div", null, withBodyNotices({ stale: failure, onRefresh: () => {}, sectionMissed }, h(Body)));
}

void test("the body keeps its node while the markers come and go", async (t) => {
  mounts = 0;
  const view = await mount(render({ stale: false, sectionMissed: false }));
  t.teardown(() => view.unmount());
  const body = view.container.querySelector("#body");
  for (const state of [{ stale: true, sectionMissed: false }, { stale: true, sectionMissed: true }, { stale: false, sectionMissed: false }]) {
    await view.rerender(render(state));
    t.check({ state, same: view.container.querySelector("#body") === body, mounts }, { state, same: true, mounts: 1 });
  }
  t.check(view.container.textContent, "The card's text.");
});
