// # The Popover interaction contract
//
// Rules 2–5 of the contract in docs/implemented-plans/ui-primitives-dedup.md (Track 7):
// initial focus by how it opened, Tab and Shift+Tab at every edge, Escape, and
// an outside press. happy-dom has no Tab key, so each Tab case focuses the
// element that sequential navigation reaches in DOM order (the panel follows
// its trigger), which fires the same `focusout` the browser does. The
// stand-in `showPopover()` (test/helpers/popover-api.ts) runs the dialog
// focusing steps, as the browser does on a `<dialog>`.

// First, and bare: React DOM must load after the happy-dom window exists.
import { byId, mount } from "../../helpers/dom-harness.js";
import { popoverOpen } from "../../helpers/popover-api.js";
import { createElement as h, type ReactNode } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Popover } from "../../../src/components/ui/Popover.js";

/** Before, a trigger, its popover, after: the page order the Tab cases walk. */
function Page({ panel }: { panel: "controls" | "text" }): ReactNode {
  return h("div", null,
    h("button", { id: "bbx-t-before", type: "button" }, "Before"),
    h(Popover, {
      label: "Details",
      trigger: ({ toggle, ariaProps }) => h("button", { id: "bbx-t-trigger", type: "button", onClick: toggle, ...ariaProps }, "Open"),
      children: panel === "controls"
        ? [h("button", { key: "a", id: "bbx-t-first", type: "button" }, "First"), h("button", { key: "b", id: "bbx-t-last", type: "button" }, "Last")]
        : "Only text",
    }),
    h("button", { id: "bbx-t-after", type: "button" }, "After"));
}

async function setup(panel: "controls" | "text", openedBy: "pointer" | "keyboard") {
  const view = await mount(h(Page, { panel }));
  const trigger = byId(view.container, "bbx-t-trigger");
  trigger.focus();
  // A keyboard activation of a button is a click with `detail` 0.
  await view.act(() => { trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: openedBy === "pointer" ? 1 : 0 })); });
  return view;
}

/** Where focus is, and whether the panel is showing. */
function state(): { focus: string; open: boolean } {
  const panel = document.querySelector("dialog");
  const active = document.activeElement;
  return { focus: active === panel ? "panel" : active?.id ?? "none", open: panel !== null && popoverOpen(panel) };
}

async function focus(view: Awaited<ReturnType<typeof setup>>, id: string) {
  await view.act(() => { byId(document.body, id).focus(); });
  return state();
}

void test("a pointer open leaves focus on the trigger; a keyboard open moves it into the panel", async (t) => {
  const results: Record<string, unknown> = {};
  for (const [name, panel, openedBy] of [
    ["pointer, controls", "controls", "pointer"],
    ["keyboard, controls", "controls", "keyboard"],
    ["keyboard, text only", "text", "keyboard"],
  ] as const) {
    const view = await setup(panel, openedBy);
    results[name] = state();
    await view.unmount();
  }
  t.check(results, {
    "pointer, controls": { focus: "bbx-t-trigger", open: true },
    "keyboard, controls": { focus: "bbx-t-first", open: true },
    "keyboard, text only": { focus: "panel", open: true },
  });
});

void test("the trigger names and points at the open panel", async (t) => {
  const view = await setup("text", "pointer");
  t.teardown(() => view.unmount());
  const trigger = byId(view.container, "bbx-t-trigger");
  const panel = document.querySelector("dialog");
  t.check(
    {
      haspopup: trigger.getAttribute("aria-haspopup"),
      expanded: trigger.getAttribute("aria-expanded"),
      controlsPanel: trigger.getAttribute("aria-controls") === panel?.id,
      name: panel?.getAttribute("aria-label"),
      popover: panel?.getAttribute("popover"),
    },
    { haspopup: "dialog", expanded: "true", controlsPanel: true, name: "Details", popover: "manual" },
  );
});

// Rule 3, after a pointer open with focus on the trigger.
void test("from the trigger, Tab enters the panel and Shift+Tab leaves and closes", async (t) => {
  const tab = await setup("controls", "pointer");
  const intoPanel = await focus(tab, "bbx-t-first");
  await tab.unmount();
  const shiftTab = await setup("controls", "pointer");
  const backOut = await focus(shiftTab, "bbx-t-before");
  await shiftTab.unmount();
  t.check({ intoPanel, backOut }, {
    intoPanel: { focus: "bbx-t-first", open: true },
    backOut: { focus: "bbx-t-before", open: false },
  });
});

// Rule 3, inside the panel.
void test("inside the panel, Shift+Tab from the first control keeps it open; Tab past the last closes it", async (t) => {
  const view = await setup("controls", "keyboard");
  const toLast = await focus(view, "bbx-t-last");
  await focus(view, "bbx-t-first");
  const toTrigger = await focus(view, "bbx-t-trigger");
  await focus(view, "bbx-t-last");
  const pastLast = await focus(view, "bbx-t-after");
  await view.unmount();
  t.check({ toLast, toTrigger, pastLast }, {
    toLast: { focus: "bbx-t-last", open: true },
    toTrigger: { focus: "bbx-t-trigger", open: true },
    pastLast: { focus: "bbx-t-after", open: false },
  });
});

// Rule 3, a panel with nothing to focus.
void test("a text-only panel: Tab leaves and closes, Shift+Tab returns to the trigger", async (t) => {
  const keyboardTab = await setup("text", "keyboard");
  const tabFromPanel = await focus(keyboardTab, "bbx-t-after");
  await keyboardTab.unmount();
  const keyboardShiftTab = await setup("text", "keyboard");
  const shiftTabFromPanel = await focus(keyboardShiftTab, "bbx-t-trigger");
  await keyboardShiftTab.unmount();
  // After a pointer open, Tab from the trigger skips the panel (tabindex -1).
  const pointerTab = await setup("text", "pointer");
  const tabFromTrigger = await focus(pointerTab, "bbx-t-after");
  await pointerTab.unmount();
  t.check({ tabFromPanel, shiftTabFromPanel, tabFromTrigger }, {
    tabFromPanel: { focus: "bbx-t-after", open: false },
    shiftTabFromPanel: { focus: "bbx-t-trigger", open: true },
    tabFromTrigger: { focus: "bbx-t-after", open: false },
  });
});

function escape(): void {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

function press(id: string): void {
  byId(document.body, id).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
}

// Rule 4.
void test("Escape closes and returns focus to the trigger", async (t) => {
  const view = await setup("controls", "keyboard");
  await view.act(escape);
  const after = state();
  await view.unmount();
  t.check(after, { focus: "bbx-t-trigger", open: false });
});

// Rule 5: focus returns only when it was in the panel.
void test("an outside press closes; focus returns to the trigger only from inside the panel", async (t) => {
  const fromPanel = await setup("controls", "keyboard");
  await fromPanel.act(() => press("bbx-t-after"));
  const pressFromPanel = state();
  await fromPanel.unmount();
  // Focus on the page body (a blur with no next target does not close it).
  const fromTrigger = await setup("controls", "pointer");
  await fromTrigger.act(() => { byId(document.body, "bbx-t-trigger").blur(); });
  await fromTrigger.act(() => press("bbx-t-after"));
  const pressFromOutside = state();
  await fromTrigger.unmount();
  t.check({ pressFromPanel, pressFromOutside }, {
    pressFromPanel: { focus: "bbx-t-trigger", open: false },
    pressFromOutside: { focus: "", open: false },
  });
});

void test("a press on the trigger toggles it closed", async (t) => {
  const view = await setup("text", "pointer");
  const trigger = byId(view.container, "bbx-t-trigger");
  await view.act(() => { trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  await view.act(() => { trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); });
  const after = { ...state(), expanded: trigger.getAttribute("aria-expanded") };
  await view.unmount();
  t.check(after, { focus: "bbx-t-trigger", open: false, expanded: "false" });
});
