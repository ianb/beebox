// An open accordion body is not an unlabeled region.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Accordion } from "../../../src/components/ui/Accordion.js";

void test("an open accordion body is not an unlabeled region", async (t) => {
  const view = await mount(h(Accordion, { title: "More", defaultOpen: true, children: "body" }));
  t.check([...view.container.querySelectorAll("[role='region']")].map((r) => r.id), []);
  await view.unmount();
});
