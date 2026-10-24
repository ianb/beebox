// # Landmark groups keep their contracts in the shared row layout
//
// The Landmarks page and the place page render a group through
// `LandmarkGroupRows`. A group still starts collapsed unless told otherwise,
// shows each link's detail and path, opens external links in a new tab, marks
// a missing link without linking it, navigates in the pane when asked, turns
// "+N more" into an action only with `onMore`, and says "None yet" when empty.
// On a material (the place page, on a themed card) the rows take the card's
// ink; in a white panel they keep app ink.

// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, type ReactElement } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { LandmarkGroup, type ResolvedGroup } from "../../../src/components/landmarks/LandmarkSection.js";
import { MaterialContext } from "../../../src/components/ui/material.js";
import type { ViewTarget } from "../../../src/lib/view-url.js";

const group: ResolvedGroup = {
  label: "Recipes",
  count: 5,
  children: [
    { ref: "_content/Soup.recipe.card", label: null, title: "Soup", exists: true, detail: "Serves four" },
    { ref: "https://example.com/pie", label: "Pie site", title: "Pie", exists: true },
    { ref: "_content/Gone.recipe.card", label: null, title: "Gone", exists: false },
  ],
};

async function render(element: ReactElement) {
  const root = createRootRoute({ staticData: { title: null } });
  const route = createRoute({ getParentRoute: () => root, path: "/$boxSlug", staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ["/test1"] }) });
  await router.load();
  return mount(h(RouterProvider, { router }));
}

const text = (el: Element | null) => el?.textContent ?? null;

void test("a group starts collapsed and the header toggles it", async (t) => {
  const view = await render(h(LandmarkGroup, { group, boxSlug: "test1" }));
  t.teardown(() => view.unmount());
  const header = () => view.container.querySelector("button[aria-expanded]");
  t.check({ expanded: header()?.getAttribute("aria-expanded"), label: text(header()), rows: view.container.querySelectorAll("a").length }, {
    expanded: "false",
    label: "Recipes5",
    rows: 0,
  });
  await view.act(() => { header()?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  t.check({ expanded: header()?.getAttribute("aria-expanded"), rows: view.container.querySelectorAll("a").length }, {
    expanded: "true",
    rows: 2,
  });
});

void test("defaultOpen shows the links with detail, path, external target and missing mark", async (t) => {
  const view = await render(h(LandmarkGroup, { group, boxSlug: "test1", defaultOpen: true }));
  t.teardown(() => view.unmount());
  const links = [...view.container.querySelectorAll("a")].map((a) => ({
    href: a.getAttribute("href"),
    target: a.getAttribute("target"),
    rel: a.getAttribute("rel"),
    text: a.textContent,
  }));
  t.check(links, [
    { href: "/test1/views/_content/Soup.recipe.card", target: null, rel: null, text: "SoupServes four_content/Soup.recipe.card" },
    { href: "https://example.com/pie", target: "_blank", rel: "noopener noreferrer", text: "Pie sitehttps://example.com/pie" },
  ]);
  const missing = view.container.querySelector("s");
  t.check({ struck: text(missing), marked: text(missing?.parentElement ?? null), inLink: missing?.closest("a") ?? null }, {
    struck: "Gone",
    marked: "GoneMissing",
    inLink: null,
  });
});

void test("hidePath leaves out the path but keeps the detail", async (t) => {
  const view = await render(h(LandmarkGroup, { group, boxSlug: "test1", defaultOpen: true, hidePath: true }));
  t.teardown(() => view.unmount());
  t.check(text(view.container.querySelector("a")), "SoupServes four");
});

void test("with onNavigate a link opens in the pane instead of navigating", async (t) => {
  const targets: ViewTarget[] = [];
  const view = await render(h(LandmarkGroup, { group, boxSlug: "test1", defaultOpen: true, onNavigate: (target) => { targets.push(target); } }));
  t.teardown(() => view.unmount());
  const soup = [...view.container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Soup"));
  await view.act(() => { soup?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  t.check({ clicked: targets.length, internalAnchors: view.container.querySelectorAll('a[href^="/test1"]').length }, {
    clicked: 1,
    internalAnchors: 0,
  });
});

void test("+N more is text without onMore and an action with it", async (t) => {
  const plain = await render(h(LandmarkGroup, { group, boxSlug: "test1", defaultOpen: true }));
  t.teardown(() => plain.unmount());
  const moreButtons = (c: HTMLElement) => [...c.querySelectorAll("button")].filter((b) => b.textContent === "+2 more").length;
  t.check({ buttons: moreButtons(plain.container), shown: plain.container.textContent?.includes("+2 more") }, { buttons: 0, shown: true });

  let more = 0;
  const live = await render(h(LandmarkGroup, { group, boxSlug: "test1", defaultOpen: true, onMore: () => { more += 1; } }));
  t.teardown(() => live.unmount());
  const button = [...live.container.querySelectorAll("button")].find((b) => b.textContent === "+2 more");
  await live.act(() => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  t.check(more, 1);
});

void test("an empty group says None yet", async (t) => {
  const view = await render(h(LandmarkGroup, { group: { label: "Empty", count: 0, children: [] }, boxSlug: "test1", defaultOpen: true }));
  t.teardown(() => view.unmount());
  t.check(text(view.container), "Empty0None yet");
});

/** The text-colour classes on the open group's header, count, an external member's title and URL line, and a missing member's label. */
function inkClasses(container: Element) {
  const colour = (el: Element | null) => (el?.getAttribute("class") ?? "").split(" ").filter((c) => c.startsWith("text-") && !/^text-(xs|sm|left)$/.test(c));
  return {
    header: colour(container.querySelector("button[aria-expanded]")),
    count: colour(container.querySelector("button[aria-expanded] span:last-child")),
    title: colour(container.querySelector('a[target="_blank"] div')),
    path: colour(container.querySelector('a[target="_blank"] div:last-child')),
    missing: colour([...container.querySelectorAll("span")].find((el) => el.textContent === "Missing") ?? null),
  };
}

void test("rows on a material take the card's ink; in a white panel they keep app ink", async (t) => {
  const onCard = await render(h(MaterialContext.Provider, { value: true }, h(LandmarkGroup, { group, boxSlug: "test1", defaultOpen: true })));
  t.teardown(() => onCard.unmount());
  t.check(inkClasses(onCard.container), {
    header: ["text-card-ink"],
    count: ["text-card-soft"],
    title: ["text-card-ink"],
    path: ["text-card-soft"],
    missing: ["text-card-ink"],
  });
  const inPanel = await render(h(LandmarkGroup, { group, boxSlug: "test1", defaultOpen: true }));
  t.teardown(() => inPanel.unmount());
  t.check(inkClasses(inPanel.container), {
    header: ["text-warm-800"],
    count: ["text-warm-700"],
    title: ["text-warm-900"],
    path: ["text-warm-700"],
    missing: ["text-danger"],
  });
});
