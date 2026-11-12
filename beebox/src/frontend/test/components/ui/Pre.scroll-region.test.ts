// A scrolling `Pre` is a named, keyboard-focusable region (Safari does not
// focus scrollers by itself).
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Pre } from "../../../src/components/ui/Pre.js";

void test("a scrolling Pre is a focusable named region; a plain Pre is not", async (t) => {
  const view = await mount(h("div", null,
    h(Pre, { scroll: "md", title: "Build log", children: "line" }),
    h(Pre, { scroll: "sm", children: "line" }),
    h(Pre, { children: "line" })));
  const pres = [...view.container.querySelectorAll("pre")];
  t.check(pres.map((pre) => ({
    tabindex: pre.getAttribute("tabindex"),
    role: pre.getAttribute("role"),
    name: pre.getAttribute("aria-label"),
  })), [
    { tabindex: "0", role: "region", name: "Build log" },
    { tabindex: "0", role: "region", name: "Scrollable text" },
    { tabindex: null, role: null, name: null },
  ]);
  await view.unmount();
});

