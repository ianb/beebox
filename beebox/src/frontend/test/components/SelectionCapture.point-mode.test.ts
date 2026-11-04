import { mount } from "../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { SelectionCapture } from "../../src/components/SelectionCapture.js";

function pointerDown(target: Element, pointerType: string): void {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType }));
}

void test("desktop click attaches the previewed block without a second confirmation", async (t) => {
  const captured: string[] = [];
  const view = await mount(h(SelectionCapture, {
    pointMode: true, extract: () => null,
    onCapture: ({ text }: { text: string }) => { captured.push(text); },
    children: h("p", { className: "bbx-paragraph" }, "The quoted paragraph."),
  }));
  t.teardown(() => view.unmount());
  const paragraph = view.container.querySelector("p");
  if (paragraph === null) throw new Error("paragraph missing");
  await view.act(() => { pointerDown(paragraph, "mouse"); paragraph.click(); });
  t.check(captured, ["The quoted paragraph."]);
  t.check(view.container.querySelector("#bbx-selection-add"), null);
});

void test("touch tap previews a block until the nearby plus is pressed", async (t) => {
  const captured: string[] = [];
  const view = await mount(h(SelectionCapture, {
    pointMode: true, extract: () => null,
    onCapture: ({ text }: { text: string }) => { captured.push(text); },
    children: h("p", { className: "bbx-paragraph" }, "The quoted paragraph."),
  }));
  t.teardown(() => view.unmount());
  const paragraph = view.container.querySelector("p");
  if (paragraph === null) throw new Error("paragraph missing");
  paragraph.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 10, width: 200, height: 40 });
  await view.act(() => { pointerDown(paragraph, "touch"); paragraph.click(); });
  t.check(captured, []);
  const add = view.container.querySelector<HTMLButtonElement>("#bbx-selection-add");
  t.check(add?.getAttribute("aria-label"), "Add selection to message");
  await view.act(() => { add?.click(); });
  t.check(captured, ["The quoted paragraph."]);
});
