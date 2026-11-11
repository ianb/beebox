// A command menu moves focus with the arrow keys; a list of links is a plain
// disclosure with no menu roles; a panel that holds a text field keeps its keys.

// First, and bare: React DOM must load after the happy-dom window exists.
import { byId, mount } from "../../helpers/dom-harness.js";
import { createElement as h, type ReactNode } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Menu } from "../../../src/components/ui/Menu.js";
import { MenuItem } from "../../../src/components/ui/menu-item.js";

const noop = (): void => undefined;

async function openMenu(kind: "menu" | "navigation", children: ReactNode) {
  const view = await mount(h(Menu, {
    kind,
    trigger: ({ toggle, ariaProps }) => h("button", { id: "bbx-t-trigger", type: "button", onClick: toggle, ...ariaProps }, "Open"),
    children,
  }));
  await view.act(() => { byId(view.container, "bbx-t-trigger").click(); });
  return view;
}

function press(target: Element, key: string): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

void test("arrow keys, Home, and End move focus among a command menu's rows", async (t) => {
  const view = await openMenu("menu", [
    h(MenuItem, { key: "a", id: "bbx-t-a", onClick: noop, children: "A" }),
    h(MenuItem, { key: "b", id: "bbx-t-b", disabled: true, onClick: noop, children: "B" }),
    h(MenuItem, { key: "c", id: "bbx-t-c", onClick: noop, children: "C" }),
    h(MenuItem, { key: "d", id: "bbx-t-d", onClick: noop, children: "D" }),
  ]);
  t.teardown(() => view.unmount());
  const focused: string[] = [];
  byId(document.body, "bbx-t-a").focus();
  for (const key of ["ArrowDown", "ArrowDown", "End", "ArrowDown", "ArrowUp", "Home"]) {
    press(document.activeElement ?? document.body, key);
    focused.push(`${key} → ${document.activeElement?.id}`);
  }
  t.check(focused, [
    "ArrowDown → bbx-t-c",
    "ArrowDown → bbx-t-d",
    "End → bbx-t-d",
    "ArrowDown → bbx-t-a",
    "ArrowUp → bbx-t-d",
    "Home → bbx-t-a",
  ]);
});

void test("a command menu declares menu roles on the panel, the trigger, and its rows", async (t) => {
  const view = await openMenu("menu", h(MenuItem, { id: "bbx-t-a", onClick: noop, children: "A" }));
  t.teardown(() => view.unmount());
  t.check(
    {
      panel: document.body.querySelectorAll("[role=menu]").length,
      row: byId(document.body, "bbx-t-a").getAttribute("role"),
      popup: byId(view.container, "bbx-t-trigger").getAttribute("aria-haspopup"),
    },
    { panel: 1, row: "menuitem", popup: "menu" },
  );
});

void test("a text field in a command menu keeps its arrow keys", async (t) => {
  const view = await openMenu("menu", [
    h("input", { key: "i", id: "bbx-t-input", "aria-label": "Search" }),
    h(MenuItem, { key: "a", id: "bbx-t-a", onClick: noop, children: "A" }),
  ]);
  t.teardown(() => view.unmount());
  const input = byId(document.body, "bbx-t-input");
  input.focus();
  const prevented = press(input, "ArrowDown");
  t.check({ prevented, active: document.activeElement?.id }, { prevented: false, active: "bbx-t-input" });
});

void test("a list of links has no menu roles and no arrow-key handling", async (t) => {
  const view = await openMenu("navigation", [
    h(MenuItem, { key: "a", id: "bbx-t-a", href: "/a", children: "A" }),
    h(MenuItem, { key: "b", id: "bbx-t-b", href: "/b", children: "B" }),
  ]);
  t.teardown(() => view.unmount());
  byId(document.body, "bbx-t-a").focus();
  const prevented = press(byId(document.body, "bbx-t-a"), "ArrowDown");
  t.check(
    {
      menus: document.body.querySelectorAll("[role=menu]").length,
      items: document.body.querySelectorAll("[role=menuitem]").length,
      popup: byId(view.container, "bbx-t-trigger").getAttribute("aria-haspopup"),
      expanded: byId(view.container, "bbx-t-trigger").getAttribute("aria-expanded"),
      prevented,
      active: document.activeElement?.id,
    },
    { menus: 0, items: 0, popup: null, expanded: "true", prevented: false, active: "bbx-t-a" },
  );
});
