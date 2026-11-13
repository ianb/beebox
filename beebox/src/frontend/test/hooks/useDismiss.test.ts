// An open layer closes on a mousedown outside every region of its boundary
// and on Escape; a mousedown inside any region, an Escape another handler
// consumed, or any event while closed leaves it alone. Escape goes to the
// most recently opened layer only.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../helpers/dom-harness.js";
import { createElement as h, type ReactNode } from "react";
import { test } from "tap";
import { useDismiss } from "../../src/hooks/useDismiss.js";

/** The popover's parts, built outside React so the hook sees real elements. */
function part(id: string, parent: HTMLElement): HTMLElement {
  const element = document.createElement("div");
  element.id = id;
  parent.append(element);
  return element;
}
const rootElement = part("root", document.body);
part("inner", rootElement);
const root = { current: rootElement };
const portal = { current: part("portal", document.body) };
part("outside", document.body);

function Host({ open, onDismiss }: { open: boolean; onDismiss: (reason: string) => void }): ReactNode {
  useDismiss({ boundary: [root, portal], open, onDismiss });
  return null;
}

function press(id: string): void {
  document.getElementById(id)?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
}

function escape({ consumed }: { consumed: boolean }): void {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  if (consumed) event.preventDefault();
  document.body.dispatchEvent(event);
}

void test("dismisses on an outside mousedown or a fresh Escape only", async (t) => {
  const calls: string[] = [];
  let step = "";
  const view = await mount(h(Host, { open: true, onDismiss: (reason) => calls.push(`${step}: ${reason}`) }));
  t.teardown(() => view.unmount());
  for (const [name, act] of [
    ["inner", () => press("inner")],
    ["portal", () => press("portal")],
    ["outside", () => press("outside")],
    ["escape", () => escape({ consumed: false })],
    ["consumed escape", () => escape({ consumed: true })],
  ] as const) {
    step = name;
    act();
  }
  t.check(calls, ["outside: outside", "escape: escape"]);
});

void test("a closed popover ignores both", async (t) => {
  const calls: number[] = [];
  const view = await mount(h(Host, { open: false, onDismiss: () => calls.push(1) }));
  t.teardown(() => view.unmount());
  press("outside");
  escape({ consumed: false });
  t.check(calls, []);
});

void test("Escape closes only the most recently opened layer, and is consumed", async (t) => {
  const calls: string[] = [];
  const outer = await mount(h(Host, { open: true, onDismiss: () => calls.push("outer") }));
  const inner = await mount(h(Host, { open: true, onDismiss: () => calls.push("inner") }));
  t.teardown(async () => { await inner.unmount(); await outer.unmount(); });
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  t.check({ calls, consumed: event.defaultPrevented }, { calls: ["inner"], consumed: true });
});
