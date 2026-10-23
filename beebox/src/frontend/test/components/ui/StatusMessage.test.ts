// StatusMessage: a pane's roomy placeholder or a menu's compact row. Both are
// polite status regions.
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

void test("a layout class overrides the variant's padding", async (t) => {
  const message = await messageOf({ className: "p-4", children: "x" });
  t.check(message.classes, ["text-warm-700", "p-4"]);
});
