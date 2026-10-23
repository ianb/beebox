// An open popover closes on a mousedown outside it and on Escape; a mousedown
// inside it or its portaled part, an Escape another handler consumed, or any
// event while closed leaves it alone.
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

function Host({ open, onDismiss }: { open: boolean; onDismiss: () => void }): ReactNode {
  useDismiss({ root, portal, open, onDismiss });
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
  const view = await mount(h(Host, { open: true, onDismiss: () => calls.push(step) }));
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
  t.check(calls, ["outside", "escape"]);
});

void test("a closed popover ignores both", async (t) => {
  const calls: number[] = [];
  const view = await mount(h(Host, { open: false, onDismiss: () => calls.push(1) }));
  t.teardown(() => view.unmount());
  press("outside");
  escape({ consumed: false });
  t.check(calls, []);
});
