// A flashing Button keeps its accessible name; a sibling status announces.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Button } from "../../../src/components/ui/Button.js";

void test("a flashing Button keeps its name and announces in a sibling status", async (t) => {
  const view = await mount(h(Button, { onClick: async () => {}, flash: { label: "Copied", failLabel: "Copy failed" }, children: "Copy" }));
  const snapshot = () => {
    const button = view.container.querySelector("button");
    const status = view.container.querySelector("[role='status']");
    return {
      name: button?.getAttribute("aria-label") ?? button?.textContent,
      live: button?.getAttribute("aria-live") ?? null,
      statusInsideButton: button?.querySelector("[role='status']") !== null,
      status: status?.textContent,
      statusParent: status?.parentElement === button?.parentElement,
    };
  };
  t.check(snapshot(), { name: "Copy", live: null, statusInsideButton: false, status: "", statusParent: true });
  const button = view.container.querySelector("button");
  await view.act(async () => {
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
  t.check(snapshot(), { name: "Copy", live: null, statusInsideButton: false, status: "Copied", statusParent: true });
  await view.unmount();
});

