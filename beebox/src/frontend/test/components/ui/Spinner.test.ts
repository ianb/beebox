// Spinner: the one indeterminate progress glyph. Decorative, sized and toned by
// props, and carrying the `bbx-spinner` hook that the reduced-motion rule in
// index.css slows instead of stopping.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { Spinner, type SpinnerProps } from "../../../src/components/ui/Spinner.js";

async function spinnerOf(props: SpinnerProps): Promise<{ tag: string; hidden: string | null; classes: string[] }> {
  const view = await mount(h(Spinner, props));
  const element = view.container.firstElementChild;
  const result = {
    tag: element?.tagName.toLowerCase() ?? "",
    hidden: element?.getAttribute("aria-hidden") ?? null,
    classes: [...(element?.classList ?? [])],
  };
  await view.unmount();
  return result;
}

void test("the default is a small spinner in the surrounding text color", async (t) => {
  t.check(await spinnerOf({}), {
    tag: "svg",
    hidden: "true",
    classes: ["bbx-spinner", "animate-spin", "shrink-0", "w-4", "h-4"],
  });
});

void test("md on a dark backdrop is larger and white", async (t) => {
  t.check(await spinnerOf({ size: "md", tone: "onDark" }), {
    tag: "svg",
    hidden: "true",
    classes: ["bbx-spinner", "animate-spin", "shrink-0", "w-5", "h-5", "text-white"],
  });
});

void test("a layout class is merged", async (t) => {
  const spinner = await spinnerOf({ className: "ml-2" });
  t.check(spinner.classes, ["bbx-spinner", "animate-spin", "shrink-0", "w-4", "h-4", "ml-2"]);
});
