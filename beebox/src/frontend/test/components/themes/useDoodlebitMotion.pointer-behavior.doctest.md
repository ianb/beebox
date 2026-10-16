# Doodlebit walkers advance with mouse travel and pause outside the desk

The small cellular walkers advance one frame for each twelve pixels of mouse
travel across exposed desk. They hold their frame while the pointer is still or
over cards, labels, and controls.

```ts setup
import { mount } from "../helpers/dom-harness.js";
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

function Surface({ active = true }: { active?: boolean }) {
  const ref = useDoodlebitMotion(active);
  return h("div", { ref, id: "surface" },
    h("div", { id: "desk", className: "bbx-conversation-desk" },
      h("span", { id: "open" }, "Open desk"),
      h("span", { className: "bbx-chat-empty-label", id: "empty" }, "Empty label"),
    ),
    h("div", { className: "bbx-card-theme" }, h("span", { id: "card" }, "Card")),
    h("button", { id: "control" }, "Control"),
  );
}

function pointerMove(target: Element, x: number, y: number, pointerType = "mouse") {
  const event = new Event("pointermove", { bubbles: true });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    clientX: { value: x },
    clientY: { value: y },
  });
  target.dispatchEvent(event);
}
```

```ts
const view = await mount(h(Surface));
const surface = view.container.querySelector<HTMLElement>("#surface")!;
const open = view.container.querySelector("#open")!;
await view.act(() => pointerMove(open, 0, 0));
await view.act(() => pointerMove(open, 120, 0));
const afterTravel = surface.style.getPropertyValue("--doodlebit-walkers").includes("#frame10");
const frameAtRest = surface.style.getPropertyValue("--doodlebit-walkers");
await new Promise((resolve) => setTimeout(resolve, 180));
const whileStill = surface.style.getPropertyValue("--doodlebit-walkers") === frameAtRest;
await view.act(() => pointerMove(view.container.querySelector("#card")!, 240, 0));
await view.act(() => pointerMove(open, 240, 0));
await view.act(() => pointerMove(open, 252, 0));
const afterResume = surface.style.getPropertyValue("--doodlebit-walkers").includes("#frame11");
await view.act(() => pointerMove(view.container.querySelector("#empty")!, 360, 0));
const overLabel = surface.style.getPropertyValue("--doodlebit-walkers").includes("#frame11");
await view.act(() => pointerMove(view.container.querySelector("#control")!, 480, 0));
const overControl = surface.style.getPropertyValue("--doodlebit-walkers").includes("#frame11");
await view.unmount();
({ afterTravel, whileStill, afterResume, overControl, overLabel })
=> { afterTravel: true, whileStill: true, afterResume: true, overControl: true, overLabel: true }
```

Reduced motion and touch input do not advance the walkers.

```ts
setMotionAllowed(false);
const reduced = await mount(h(Surface));
const reducedSurface = reduced.container.querySelector<HTMLElement>("#surface")!;
await reduced.act(() => pointerMove(reduced.container.querySelector("#open")!, 0, 0));
await reduced.act(() => pointerMove(reduced.container.querySelector("#open")!, 120, 0));
const reducedValue = reducedSurface.style.getPropertyValue("--doodlebit-walkers");
await reduced.unmount();
setMotionAllowed(true);
const touch = await mount(h(Surface));
await touch.act(() => pointerMove(touch.container.querySelector("#open")!, 0, 0, "touch"));
await touch.act(() => pointerMove(touch.container.querySelector("#open")!, 120, 0, "touch"));
const touchValue = touch.container.querySelector<HTMLElement>("#surface")!.style.getPropertyValue("--doodlebit-walkers");
await touch.unmount();
({ reducedValue, touchValue })
=> { reducedValue: "", touchValue: "" }
```
