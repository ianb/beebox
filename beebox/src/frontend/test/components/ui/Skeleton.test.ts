// Skeleton: one placeholder bar, sized by the caller. Decorative; the container
// carries aria-busy.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { Skeleton } from "../../../src/components/ui/Skeleton.js";

void test("a pulsing warm bar with the caller's size, hidden from assistive tech", async (t) => {
  const view = await mount(h(Skeleton, { className: "h-5 w-48" }));
  const element = view.container.firstElementChild;
  const result = {
    tag: element?.tagName.toLowerCase() ?? "",
    hidden: element?.getAttribute("aria-hidden") ?? null,
    classes: [...(element?.classList ?? [])],
  };
  await view.unmount();
  t.check(result, { tag: "div", hidden: "true", classes: ["bg-warm-100", "rounded", "animate-pulse", "h-5", "w-48"] });
});
