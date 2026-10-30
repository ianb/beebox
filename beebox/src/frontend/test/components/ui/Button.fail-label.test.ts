// Button flash: after a successful click the label swaps to `flash.label`;
// after a failed one, a rejected promise or a synchronous throw, it swaps to
// `flash.failLabel`. The button is a polite live region so the swap is announced.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { Button } from "../../../src/components/ui/Button.js";

const FLASH = { label: "Copied", failLabel: "Copy failed" };

async function labelAfterClick(onClick: () => void | Promise<void>): Promise<{ before: string; after: string; live: string | null }> {
  const view = await mount(h(Button, { onClick, flash: FLASH, children: "Copy" }));
  const button = view.container.querySelector("button");
  const before = button?.textContent ?? "";
  await view.act(async () => {
    button?.click();
    // Let the handler's awaited promise settle inside act.
    await Promise.resolve();
    await Promise.resolve();
  });
  const result = { before, after: button?.textContent ?? "", live: button?.getAttribute("aria-live") ?? null };
  await view.unmount();
  return result;
}

void test("a resolved click shows the success label", async (t) => {
  t.check(await labelAfterClick(async () => {}), { before: "Copy", after: "Copied", live: "polite" });
});

void test("a rejected click shows the failure label", async (t) => {
  t.check(await labelAfterClick(() => Promise.reject(new Error("denied"))), { before: "Copy", after: "Copy failed", live: "polite" });
});

void test("a synchronous throw counts as a failure", async (t) => {
  t.check(await labelAfterClick(() => { throw new Error("denied"); }), { before: "Copy", after: "Copy failed", live: "polite" });
});
