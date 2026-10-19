// A fenced block in rendered Markdown carries a Copy button that copies the
// block's text, not the button's label, and says "Copied" after.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
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
  const state = (button: HTMLButtonElement) => ({
    inside: button.closest("pre")?.tagName,
    text: button.textContent,
    type: button.getAttribute("type"),
    live: button.getAttribute("aria-live"),
  });
  // One button, on the fence; the blockquote has none.
  t.check(buttons.map(state), [{ inside: "PRE", text: "Copy", type: "button", live: "polite" }]);
  const [button] = buttons;
  if (button === undefined) return;
  await view.act(() => { button.click(); });
  await view.act(() => Promise.resolve());
  t.check({ copied, button: state(button) }, {
    copied: ["Hi Sam,\n\nLunch on Friday?\n"],
    button: { inside: "PRE", text: "Copied", type: "button", live: "polite" },
  });
  await view.unmount();
});
