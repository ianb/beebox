// # A menu at a point (a context menu)
//
// `Menu at` (docs/plans/ui-primitives-dedup.md, Track 7): a pointer open
// focuses the panel and the arrow keys start from it; a keyboard open focuses
// the first item; a press outside the panel closes it, including a press on
// the row that opened it; a scroll outside the panel or a resize closes it;
// focus goes back to `returnFocus` on Escape or when it was in the menu.

// First, and bare: React DOM must load after the happy-dom window exists.
import { byId, mount } from "../../helpers/dom-harness.js";
import { createElement as h, useState, type ReactNode } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Menu } from "../../../src/components/ui/Menu.js";
import { MenuItem } from "../../../src/components/ui/menu-item.js";

const noop = (): void => undefined;
const row = document.createElement("button");
row.id = "bbx-t-row";
document.body.append(row);

/** Like the browse page, the host unmounts the menu on close. */
function Host({ openedBy, closes }: { openedBy: "pointer" | "keyboard"; closes: string[] }): ReactNode {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return h(Menu, {
    at: { x: 20, y: 20 },
    open,
    openedBy,
    returnFocus: row,
    onClose: () => { closes.push("close"); setOpen(false); },
    children: [
      h(MenuItem, { key: "a", id: "bbx-t-a", onClick: noop, children: "A" }),
      h(MenuItem, { key: "b", id: "bbx-t-b", onClick: noop, children: "B" }),
      h(MenuItem, { key: "c", id: "bbx-t-c", onClick: noop, children: "C" }),
    ],
  });
}

async function openAt(openedBy: "pointer" | "keyboard") {
  const closes: string[] = [];
  row.focus();
  const view = await mount(h(Host, { openedBy, closes }));
  return { view, closes };
}

function key(name: string): void {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

function focused(): string {
  const active = document.activeElement;
  return active?.getAttribute("role") === "menu" ? "panel" : active?.id ?? "none";
}

void test("a pointer open focuses the panel, and the arrow keys start from it", async (t) => {
  const results: Record<string, string> = {};
  for (const arrow of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    const { view } = await openAt("pointer");
    results.opened = focused();
    await view.act(() => key(arrow));
    results[arrow] = focused();
    await view.unmount();
  }
  t.check(results, { opened: "panel", ArrowDown: "bbx-t-a", ArrowUp: "bbx-t-c", Home: "bbx-t-a", End: "bbx-t-c" });
});

void test("a keyboard open focuses the first item", async (t) => {
  const { view } = await openAt("keyboard");
  t.teardown(() => view.unmount());
  t.check(focused(), "bbx-t-a");
});

void test("Escape closes and returns focus to the row", async (t) => {
  const { view, closes } = await openAt("pointer");
  t.teardown(() => view.unmount());
  await view.act(() => key("Escape"));
  t.check({ closes, focus: focused(), menus: document.querySelectorAll("[role=menu]").length }, { closes: ["close"], focus: "bbx-t-row", menus: 0 });
});

void test("a press outside the panel closes it, even on the row that opened it; a press inside does not", async (t) => {
  const { view, closes } = await openAt("pointer");
  t.teardown(() => view.unmount());
  await view.act(() => { byId(document.body, "bbx-t-b").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  const afterInside = [...closes];
  await view.act(() => { row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  t.check({ afterInside, afterRow: closes }, { afterInside: [], afterRow: ["close"] });
});

void test("a scroll outside the panel or a resize closes it; a scroll inside does not", async (t) => {
  const results: Record<string, string[]> = {};
  const inside = await openAt("pointer");
  await inside.view.act(() => { document.querySelector("[role=menu]")?.dispatchEvent(new Event("scroll")); });
  results.inside = inside.closes;
  await inside.view.unmount();
  const outside = await openAt("pointer");
  await outside.view.act(() => { document.dispatchEvent(new Event("scroll")); });
  results.outside = outside.closes;
  await outside.view.unmount();
  const resized = await openAt("pointer");
  await resized.view.act(() => { window.dispatchEvent(new Event("resize")); });
  results.resized = resized.closes;
  await resized.view.unmount();
  t.check(results, { inside: [], outside: ["close"], resized: ["close"] });
});

void test("choosing an item closes the menu and returns focus to the row", async (t) => {
  const { view, closes } = await openAt("keyboard");
  t.teardown(() => view.unmount());
  await view.act(() => { byId(document.body, "bbx-t-b").click(); });
  t.check({ closes, focus: focused() }, { closes: ["close"], focus: "bbx-t-row" });
});
