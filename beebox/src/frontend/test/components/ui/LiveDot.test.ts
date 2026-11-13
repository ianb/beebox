// LiveDot: the one pulsing status dot. Decorative, toned and sized by props.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { LiveDot, type LiveDotProps } from "../../../src/components/ui/LiveDot.js";

async function dotOf(props: LiveDotProps): Promise<{ tag: string; hidden: string | null; classes: string[] }> {
  const view = await mount(h(LiveDot, props));
  const element = view.container.firstElementChild;
  const result = {
    tag: element?.tagName.toLowerCase() ?? "",
    hidden: element?.getAttribute("aria-hidden") ?? null,
    classes: [...(element?.classList ?? [])],
  };
  await view.unmount();
  return result;
}

void test("the default is an 8px dot in the surrounding text color", async (t) => {
  t.check(await dotOf({}), {
    tag: "span",
    hidden: "true",
    classes: ["inline-block", "shrink-0", "rounded-full", "animate-pulse", "w-2", "h-2", "bg-current"],
  });
});

void test("a tone and the small size", async (t) => {
  const dot = await dotOf({ tone: "danger", size: "sm" });
  t.check(dot.classes, ["inline-block", "shrink-0", "rounded-full", "animate-pulse", "w-1.5", "h-1.5", "bg-danger"]);
});

void test("a layout class is merged", async (t) => {
  const dot = await dotOf({ tone: "info", className: "mr-1" });
  t.check(dot.classes, ["inline-block", "shrink-0", "rounded-full", "animate-pulse", "w-2", "h-2", "bg-info", "mr-1"]);
});
