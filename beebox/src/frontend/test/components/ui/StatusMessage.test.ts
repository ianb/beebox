// StatusMessage: a pane's roomy placeholder, a menu's compact row, or an unpadded inline line. All are
// polite status regions; busy marks loading.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { StatusMessage, type StatusMessageProps } from "../../../src/components/ui/StatusMessage.js";

async function messageOf(props: StatusMessageProps): Promise<{ role: string | null; text: string; classes: string[] }> {
  const view = await mount(h(StatusMessage, props));
  const element = view.container.firstElementChild;
  const result = { role: element?.getAttribute("role") ?? null, text: element?.textContent ?? "", classes: [...(element?.classList ?? [])] };
  await view.unmount();
  return result;
}

void test("the default is the pane variant", async (t) => {
  const message = await messageOf({ children: "Loading…" });
  t.check(message, { role: "status", text: "Loading…", classes: ["p-8", "text-warm-700"] });
});

void test("the menu variant is a compact small-text row", async (t) => {
  const message = await messageOf({ variant: "menu", children: "Searching…" });
  t.check(message, { role: "status", text: "Searching…", classes: ["px-3", "py-2", "text-sm", "text-warm-700"] });
});

void test("the inline variant is a small-text line with no padding", async (t) => {
  const message = await messageOf({ variant: "inline", children: "Loading runs…" });
  t.check(message, { role: "status", text: "Loading runs…", classes: ["text-sm", "text-warm-700"] });
});

// Loading then a result in the same element: the live region exists before the
// result arrives, so the result is announced as a change inside it; aria-busy
// holds the announcement while the loading text shows.
void test("one status region from loading to result", async (t) => {
  const view = await mount(h(StatusMessage, { busy: true, children: "Loading…" }));
  const element = view.container.firstElementChild;
  const loading = { role: element?.getAttribute("role") ?? null, busy: element?.getAttribute("aria-busy") ?? null };
  await view.rerender(h(StatusMessage, { children: "No recent files yet" }));
  const same = view.container.firstElementChild === element;
  const result = { role: element?.getAttribute("role") ?? null, busy: element?.getAttribute("aria-busy") ?? null, text: element?.textContent ?? "" };
  await view.unmount();
  t.check({ loading, same, result }, {
    loading: { role: "status", busy: "true" },
    same: true,
    result: { role: "status", busy: null, text: "No recent files yet" },
  });
});

void test("a layout class overrides the variant's padding", async (t) => {
  const message = await messageOf({ className: "p-4", children: "x" });
  t.check(message.classes, ["text-warm-700", "p-4"]);
});
