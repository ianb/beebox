import { mount } from "../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { SelectionCapture, captureSelectedText } from "../../src/components/SelectionCapture.js";

function pointerDown(target: Element, pointerType: string): void {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType }));
}

void test("desktop click attaches the previewed block without a second confirmation", async (t) => {
  const captured: string[] = [];
  const exits: string[] = [];
  const view = await mount(h(SelectionCapture, {
    pointMode: true,
    onCapture: ({ text }: { text: string }) => { captured.push(text); },
    onExitPointMode: () => { exits.push("exit"); },
    children: h("p", { className: "bbx-paragraph" }, "The quoted paragraph."),
  }));
  t.teardown(() => view.unmount());
  const paragraph = view.container.querySelector("p");
  if (paragraph === null) throw new Error("paragraph missing");
  await view.act(() => { pointerDown(paragraph, "mouse"); paragraph.click(); });
  t.check(captured, ["The quoted paragraph."]);
  t.check(exits, ["exit"]);
  t.check(view.container.querySelector("#bbx-selection-add"), null);
});

void test("touch tap previews a block until the nearby plus is pressed", async (t) => {
  const captured: string[] = [];
  const exits: string[] = [];
  const view = await mount(h(SelectionCapture, {
    pointMode: true,
    onCapture: ({ text }: { text: string }) => { captured.push(text); },
    onExitPointMode: () => { exits.push("exit"); },
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
  t.check(exits, ["exit"]);
});

// Embedded document capture owns its events before the transcript can consume them.
void test("the innermost capture owns a document point", async (t) => {
  const captured: string[] = [];
  const view = await mount(h(SelectionCapture, {
    pointMode: true,
    onCapture: () => { captured.push("outer"); },
    children: h(SelectionCapture, {
      pointMode: true,
      onCapture: () => { captured.push("inner"); },
      children: h("p", null, "Embedded paragraph."),
    }),
  }));
  t.teardown(() => view.unmount());
  const paragraph = view.container.querySelector("p");
  if (paragraph === null) throw new Error("paragraph missing");
  await view.act(() => { pointerDown(paragraph, "mouse"); paragraph.click(); });
  t.check(captured, ["inner"]);
});

void test("moving into an embedded card clears the outer hover outline", async (t) => {
  const view = await mount(h(SelectionCapture, {
    pointMode: true, onCapture: () => {},
    children: [
      h("p", { key: "outer" }, "Chat text"),
      h(SelectionCapture, { key: "inner", pointMode: true, onCapture: () => {}, children: h("p", null, "Card text") }),
    ],
  }));
  t.teardown(() => view.unmount());
  const paragraphs = view.container.querySelectorAll("p");
  const outer = paragraphs[0];
  const inner = paragraphs[1];
  if (outer === undefined || inner === undefined) throw new Error("paragraphs missing");
  for (const paragraph of paragraphs) paragraph.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 10, width: 200, height: 40 });
  await view.act(() => { outer.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" })); });
  t.check([...view.container.querySelectorAll("[aria-hidden].pointer-events-none")].map((node) => node.tagName), ["DIV"]);
  await view.act(() => { inner.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" })); });
  t.check([...view.container.querySelectorAll("[aria-hidden].pointer-events-none")].map((node) => node.tagName), ["DIV"]);
});

// A new touch point replaces every other source's unconfirmed point.
void test("a new point cancels another source's pending confirmation", async (t) => {
  const captured: string[] = [];
  const view = await mount(h("div", null, ...["First", "Second"].map((name) => h(SelectionCapture, {
    key: name, pointMode: true,
    onCapture: ({ text }) => { captured.push(text); },
    children: h("p", null, name),
  }))));
  t.teardown(() => view.unmount());
  const paragraphs = [...view.container.querySelectorAll("p")];
  for (const paragraph of paragraphs) {
    paragraph.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 10, width: 200, height: 40 });
    await view.act(() => { pointerDown(paragraph, "touch"); paragraph.click(); });
  }
  const buttons = [...view.container.querySelectorAll<HTMLButtonElement>("#bbx-selection-add")];
  await view.act(() => { for (const button of buttons) button.click(); });
  t.check(captured, ["Second"]);
});

// Hiding a source cannot leave a valid floating confirmation behind.
void test("hidden source cancels its pending point", async (t) => {
  const captured: string[] = [];
  const view = await mount(h(SelectionCapture, {
    pointMode: true,
    onCapture: ({ text }) => { captured.push(text); },
    children: h("p", null, "Hidden paragraph."),
  }));
  t.teardown(() => view.unmount());
  const paragraph = view.container.querySelector("p");
  if (paragraph === null) throw new Error("paragraph missing");
  paragraph.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 10, width: 200, height: 40 });
  await view.act(() => { pointerDown(paragraph, "touch"); paragraph.click(); });
  const add = view.container.querySelector<HTMLButtonElement>("#bbx-selection-add");
  await view.act(() => { paragraph.hidden = true; add?.click(); });
  t.check(captured, []);
  t.check(view.container.querySelector("#bbx-selection-add"), null);
});

// With several sources mounted, Escape cancels the pending source before exiting mode.
void test("Escape clears pending confirmation before exiting shared mode", async (t) => {
  const exits: string[] = [];
  const view = await mount(h("div", null, ...["First", "Second"].map((name) => h(SelectionCapture, {
    key: name, pointMode: true, onCapture: () => {},
    onExitPointMode: () => { exits.push(name); },
    children: h("p", null, name),
  }))));
  t.teardown(() => view.unmount());
  const paragraph = view.container.querySelectorAll("p")[1];
  if (paragraph === undefined) throw new Error("paragraph missing");
  paragraph.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 10, width: 200, height: 40 });
  await view.act(() => { pointerDown(paragraph, "touch"); paragraph.click(); });
  await view.act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })); });
  t.check(exits, []);
  t.check(view.container.querySelector("#bbx-selection-add"), null);
  await view.act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })); });
  t.check(exits, ["First"]);
});

// A native range only enters the draft through the top-bar action, with the inner card's source.
void test("a desktop text range attaches its exact quote through the innermost capture", async (t) => {
  const captured: Array<{ source: string; text: string; position: string }> = [];
  const view = await mount(h(SelectionCapture, {
    onCapture: (selection: { text: string; position: string }) => { captured.push({ source: "chat", ...selection }); },
    children: h(SelectionCapture, {
      onCapture: (selection: { text: string; position: string }) => { captured.push({ source: "card", ...selection }); },
      children: h("p", { "data-card-section": "body" }, "Before exact words after"),
    }),
  }));
  t.teardown(() => { window.getSelection()?.removeAllRanges(); view.unmount(); });
  const text = view.container.querySelector("p")?.firstChild;
  if (text === null || text === undefined) throw new Error("text missing");
  const range = document.createRange();
  range.setStart(text, 6);
  range.setEnd(text, 19);
  window.getSelection()?.addRange(range);
  t.check(captured, []);
  await view.act(() => { captureSelectedText(); });
  t.check(captured, [{ source: "card", text: " exact words ", position: "body; paragraph 1" }]);
  t.check(window.getSelection()?.toString(), "");
});
