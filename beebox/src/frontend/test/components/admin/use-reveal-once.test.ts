// # Reveal once
//
// Admin's Show-value and Show-token buttons fetch a secret only on a click and
// keep it on screen briefly. It must go away when the page is hidden, on Hide,
// and the mutation result must be cleared on unmount.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mount, type Mounted } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { useRevealOnce } from "../../../src/components/admin/use-reveal-once.js";

let resets = 0;
const reset = (): void => { resets += 1; };
const fetchValue = async (): Promise<string> => "s3cret";

function Probe() {
  const { value, shownRef, show, hide } = useRevealOnce(fetchValue, reset);
  return h("div", { ref: shownRef },
    h("output", null, value ?? "(hidden)"),
    h("button", { id: "show", onClick: () => { void show(); } }),
    h("button", { id: "hide", onClick: hide }));
}

function shown(view: Mounted): string {
  return view.container.querySelector("output")?.textContent ?? "";
}

function click(view: Mounted, id: string): Promise<void> {
  return view.act(() => { view.container.querySelector<HTMLButtonElement>(`#${id}`)?.click(); });
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

function setWebdriver(value: boolean): void {
  Object.defineProperty(navigator, "webdriver", { value, configurable: true });
}

// An automated browser never reveals:
void test("an automated browser reveals nothing", async (t) => {
  setVisibility("visible");
  setWebdriver(true);
  const view = await mount(h(Probe));
  await click(view, "show");
  const text = shown(view);
  await view.unmount();
  t.check(text, "(hidden)");
});

void test("the value shows after Show, and hides on Hide, on page hide, and on unmount", async (t) => {
  setVisibility("visible");
  setWebdriver(false);
  resets = 0;
  const view = await mount(h(Probe));
  const seen: string[] = [shown(view)];
  await click(view, "show");
  seen.push(shown(view));
  await click(view, "hide");
  seen.push(shown(view));
  await click(view, "show");
  setVisibility("hidden");
  await view.act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  seen.push(shown(view));
  setVisibility("visible");
  // A reveal that resolves while the page is hidden is dropped:
  setVisibility("hidden");
  await click(view, "show");
  seen.push(shown(view));
  setVisibility("visible");
  const resetsBeforeUnmount = resets;
  await view.unmount();
  t.check({ seen, resetsBeforeUnmount, resetOnUnmount: resets > resetsBeforeUnmount }, {
    seen: ["(hidden)", "s3cret", "(hidden)", "(hidden)", "(hidden)"],
    resetsBeforeUnmount: 1,
    resetOnUnmount: true,
  });
});
