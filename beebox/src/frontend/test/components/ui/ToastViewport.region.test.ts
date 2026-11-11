// The toast viewport is a named region.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ToastViewport } from "../../../src/components/ui/ToastViewport.js";
import { toastError, dismissToast, getToasts } from "../../../src/components/ui/toast-store.js";

void test("the toast viewport is a named region", async (t) => {
  toastError("Save failed");
  const view = await mount(h(ToastViewport));
  const region = view.container.querySelector("[role='region']");
  t.check({ name: region?.getAttribute("aria-label"), alerts: [...(region?.querySelectorAll("[role='alert']") ?? [])].map((a) => a.textContent?.startsWith("Save failed")) }, { name: "Notifications", alerts: [true] });
  await view.unmount();
  for (const toast of getToasts()) dismissToast(toast.id);
});

