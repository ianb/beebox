// # Doodlebit walkers advance with mouse travel and pause outside the desk
//
// The small cellular walkers advance one frame for each twelve pixels of mouse
// travel across exposed desk. They hold their frame while the pointer is still or
// over cards, labels, and controls.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { useDoodlebitMotion } from "../../../src/components/themes/useDoodlebitMotion.js";

let motionAllowed = true;
function setMotionAllowed(value: boolean) {
  motionAllowed = value;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: motionAllowed, addEventListener() {}, removeEventListener() {} }),
  });
}
setMotionAllowed(true);

function Surface({ active }: { active?: boolean }) {
  const ref = useDoodlebitMotion(active ?? true);
  return h("div", { ref, id: "surface" },
    h("div", { id: "desk", className: "bbx-conversation-desk" },
      h("span", { id: "open" }, "Open desk"),
      h("span", { className: "bbx-chat-empty-label", id: "empty" }, "Empty label"),
    ),
    h("div", { className: "bbx-card-theme" }, h("span", { id: "card" }, "Card")),
    h("button", { id: "control" }, "Control"),
  );
}

function pointerMove(target: Element, { x, y, pointerType }: { x: number; y: number; pointerType?: string }) {
  const event = new Event("pointermove", { bubbles: true });
  Object.defineProperties(event, {
    pointerType: { value: pointerType ?? "mouse" },
    clientX: { value: x },
    clientY: { value: y },
  });
  target.dispatchEvent(event);
}

void test("line 45", async (t) => {
  const view = await mount(h(Surface));
  const surface = view.container.querySelector<HTMLElement>("#surface")!;
  const open = view.container.querySelector("#open")!;
  await view.act(() => pointerMove(open, { x: 0, y: 0 }));
  await view.act(() => pointerMove(open, { x: 120, y: 0 }));
  const afterTravel = surface.style.getPropertyValue("--doodlebit-walkers").includes("#frame10");
  const frameAtRest = surface.style.getPropertyValue("--doodlebit-walkers");
  await new Promise((resolve) => setTimeout(resolve, 180));
  const whileStill = surface.style.getPropertyValue("--doodlebit-walkers") === frameAtRest;
  await view.act(() => pointerMove(view.container.querySelector("#card")!, { x: 240, y: 0 }));
  await view.act(() => pointerMove(open, { x: 240, y: 0 }));
  await view.act(() => pointerMove(open, { x: 252, y: 0 }));
  const afterResume = surface.style.getPropertyValue("--doodlebit-walkers").includes("#frame11");
  await view.act(() => pointerMove(view.container.querySelector("#empty")!, { x: 360, y: 0 }));
  const overLabel = surface.style.getPropertyValue("--doodlebit-walkers").includes("#frame11");
  await view.act(() => pointerMove(view.container.querySelector("#control")!, { x: 480, y: 0 }));
  const overControl = surface.style.getPropertyValue("--doodlebit-walkers").includes("#frame11");
  await view.unmount();
  t.check(({ afterTravel, whileStill, afterResume, overControl, overLabel }), {
    afterTravel: true,
    whileStill: true,
    afterResume: true,
    overControl: true,
    overLabel: true,
  });
});

// Reduced motion and touch input do not advance the walkers.
void test("Reduced motion and touch input do not advance the walkers.", async (t) => {
  setMotionAllowed(false);
  const reduced = await mount(h(Surface));
  const reducedSurface = reduced.container.querySelector<HTMLElement>("#surface")!;
  await reduced.act(() => pointerMove(reduced.container.querySelector("#open")!, { x: 0, y: 0 }));
  await reduced.act(() => pointerMove(reduced.container.querySelector("#open")!, { x: 120, y: 0 }));
  const reducedValue = reducedSurface.style.getPropertyValue("--doodlebit-walkers");
  await reduced.unmount();
  setMotionAllowed(true);
  const touch = await mount(h(Surface));
  await touch.act(() => pointerMove(touch.container.querySelector("#open")!, { x: 0, y: 0, pointerType: "touch" }));
  await touch.act(() => pointerMove(touch.container.querySelector("#open")!, { x: 120, y: 0, pointerType: "touch" }));
  const touchValue = touch.container.querySelector<HTMLElement>("#surface")!.style.getPropertyValue("--doodlebit-walkers");
  await touch.unmount();
  t.check(({ reducedValue, touchValue }), {
    reducedValue: "",
    touchValue: "",
  });
});
