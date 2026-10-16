# Doodlebit desk movement stays subtle and off the controls

The desk shifts only for mouse movement over exposed background. Card and
control surfaces stay still, and the small offset settles back to zero.

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
    h("div", { id: "desk" }, h("span", { id: "open" }, "Open desk")),
    h("div", { className: "bbx-card-theme" }, h("span", { id: "card" }, "Card")),
    h("button", { id: "control" }, "Control"),
  );
}

function pointerMove(target: Element, movementX: number, movementY: number) {
  const event = new Event("pointermove", { bubbles: true });
  Object.defineProperties(event, {
    pointerType: { value: "mouse" },
    movementX: { value: movementX },
    movementY: { value: movementY },
  });
  target.dispatchEvent(event);
}
```

```ts
const view = await mount(h(Surface));
const surface = view.container.querySelector<HTMLElement>("#surface")!;
await view.act(() => pointerMove(view.container.querySelector("#open")!, 10, 8));
const shifted = [surface.style.getPropertyValue("--doodlebit-x"), surface.style.getPropertyValue("--doodlebit-y")];
await view.act(() => pointerMove(view.container.querySelector("#card")!, 10, 8));
const overCard = [surface.style.getPropertyValue("--doodlebit-x"), surface.style.getPropertyValue("--doodlebit-y")];
await view.act(() => pointerMove(view.container.querySelector("#control")!, 10, 8));
const overControl = [surface.style.getPropertyValue("--doodlebit-x"), surface.style.getPropertyValue("--doodlebit-y")];
await new Promise((resolve) => setTimeout(resolve, 180));
const settled = [surface.style.getPropertyValue("--doodlebit-x"), surface.style.getPropertyValue("--doodlebit-y")];
await view.unmount();
({ shifted, overCard, overControl, settled })
=> { shifted: ["6px", "4px"], overCard: ["", ""], overControl: ["", ""], settled: ["", ""] }
```

Reduced motion and touch-style environments do not shift the desk.

```ts
setMotionAllowed(false);
const reduced = await mount(h(Surface));
const reducedSurface = reduced.container.querySelector<HTMLElement>("#surface")!;
await reduced.act(() => pointerMove(reduced.container.querySelector("#open")!, 10, 8));
const values = [reducedSurface.style.getPropertyValue("--doodlebit-x"), reducedSurface.style.getPropertyValue("--doodlebit-y")];
await reduced.unmount();
values
=> ["", ""]
```
