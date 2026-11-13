// A tab bar with no panels is a group of toggle buttons, so a screen reader
// hears "pressed" rather than "tab, 1 of 3" with nothing to switch to.

// First, and bare: React DOM must load after the happy-dom window exists.
import { byId, byRole, mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { TabBar } from "../../../src/components/ui/TabBar.js";

const noop = (): void => undefined;
const tabs = [{ value: "all", label: "All" }, { value: "linked", label: "Linked" }];

void test("button-group mode exposes a group of aria-pressed buttons and keeps the ids", async (t) => {
  const picked: string[] = [];
  const view = await mount(h(TabBar, { mode: "buttons", value: "all", onChange: (v: string) => picked.push(v), idPrefix: "bbx-t-filter", label: "Filter", tabs }));
  t.teardown(() => view.unmount());
  const group = byRole(view.container, { role: "group", name: "Filter" });
  const state = () => [...group.querySelectorAll("button")].map((b) => `${b.id} ${b.getAttribute("role")} pressed=${b.getAttribute("aria-pressed")} selected=${b.getAttribute("aria-selected")} tabindex=${b.tabIndex}`);
  t.check(state(), [
    "bbx-t-filter-all null pressed=true selected=null tabindex=0",
    "bbx-t-filter-linked null pressed=false selected=null tabindex=0",
  ]);
  await view.act(() => { byId(view.container, "bbx-t-filter-linked").click(); });
  t.check(picked, ["linked"]);
});

void test("tabs mode is still a tablist of tabs", async (t) => {
  const view = await mount(h(TabBar, { value: "all", onChange: noop, idPrefix: "bbx-t-tab", label: "Views", tabs }));
  t.teardown(() => view.unmount());
  byRole(view.container, { role: "tablist", name: "Views" });
  t.check(byId(view.container, "bbx-t-tab-all").getAttribute("aria-selected"), "true");
});
