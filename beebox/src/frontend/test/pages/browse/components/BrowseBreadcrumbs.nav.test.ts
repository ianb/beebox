// Breadcrumbs are a labelled ordered list with the current page marked.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { BrowseBreadcrumbs } from "../../../../src/pages/browse/components/BrowseBreadcrumbs.js";

void test("breadcrumbs are a labelled ordered list with the current page marked", async (t) => {
  const view = await mount(h(BrowseBreadcrumbs, { dirPath: "_content/recipes/soup", rootPath: "_content", onNavigate: () => {} }));
  const nav = view.container.querySelector("nav");
  const items = [...view.container.querySelectorAll("ol > li")];
  t.check({
    label: nav?.getAttribute("aria-label"),
    items: items.map((li) => ({
      text: li.textContent,
      current: li.querySelector("[aria-current]")?.getAttribute("aria-current") ?? null,
      hiddenSeparators: [...li.querySelectorAll("[aria-hidden='true']")].map((s) => s.textContent),
    })),
  }, {
    label: "Breadcrumbs",
    items: [
      { text: "/", current: null, hiddenSeparators: [] },
      { text: "recipes", current: null, hiddenSeparators: [] },
      { text: "/soup", current: "page", hiddenSeparators: ["/"] },
    ],
  });
  await view.unmount();
});

