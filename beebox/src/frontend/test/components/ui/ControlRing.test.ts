// # ControlRing: a ring around an element or a rect
//
// The ring sits RING_PADDING outside its target, in the body, out of the
// accessibility tree. A rect target is drawn where it is; an element target
// follows the element. The timer runs only when `durationMs` is given.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ControlRing } from "../../../src/components/ui/ControlRing.js";

function ring(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>("body > [aria-hidden='true'].pointer-events-none");
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

void test("a rect target: drawn around the rect, subtle tone, no timer", async (t) => {
  const view = await mount(h(ControlRing, { target: DOMRect.fromRect({ x: 10, y: 20, width: 100, height: 30 }), tone: "subtle" }));
  t.teardown(() => view.unmount());
  const node = ring();
  await wait(20);
  t.check({
    box: [node?.style.top, node?.style.left, node?.style.width, node?.style.height],
    pulses: node?.classList.contains("animate-pulse"),
    stillThere: ring() !== null,
  }, { box: ["16px", "6px", "108px", "38px"], pulses: false, stillThere: true });
});

void test("an element target with durationMs: accent ring, onDone after the duration", async (t) => {
  const target = document.createElement("button");
  target.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 40, height: 20 });
  document.body.append(target);
  t.teardown(() => target.remove());
  let done = 0;
  const view = await mount(h(ControlRing, { target, durationMs: 10, onDone: () => { done += 1; } }));
  t.teardown(() => view.unmount());
  const node = ring();
  const before = done;
  await view.act(async () => { await wait(30); });
  t.check({
    box: [node?.style.top, node?.style.width],
    pulses: node?.classList.contains("animate-pulse"),
    before,
    after: done,
  }, { box: ["-4px", "48px"], pulses: true, before: 0, after: 1 });
});
