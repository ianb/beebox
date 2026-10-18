// A fenced block in rendered Markdown carries a Copy button that copies the
// block's text, not the button's label, and says "Copied" after.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { Markdown } from "../../../src/components/Markdown/body.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";

const source = "Ready to copy:\n\n```\nHi Sam,\n\nLunch on Friday?\n```\n\n> A quote stays as it is.\n";

function render() {
  return h(BoxSlugProvider, {
    boxSlug: "test",
    children: h(Markdown, { onNavigate: () => {}, children: source }),
  });
}

test("a fenced block copies its text and confirms", async (t) => {
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text: string) => { copied.push(text); return Promise.resolve(); } },
  });
  const view = await mount(render());
  const buttons = [...view.container.querySelectorAll("button")];
  t.equal(buttons.length, 1, "one button, on the fence; the blockquote has none");
  const [button] = buttons;
  if (button === undefined) return;
  t.equal(button.closest("pre")?.tagName, "PRE", "the button sits in the code block");
  t.equal(button.textContent, "Copy");
  t.equal(button.getAttribute("type"), "button");
  await view.act(() => { button.click(); });
  await view.act(() => Promise.resolve());
  t.same(copied, ["Hi Sam,\n\nLunch on Friday?\n"]);
  t.equal(button.textContent, "Copied");
  t.equal(button.getAttribute("aria-live"), "polite");
  await view.unmount();
});
