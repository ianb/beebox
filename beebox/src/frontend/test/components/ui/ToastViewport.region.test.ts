// The toast viewport is a named region.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { ToastViewport } from "../../../src/components/ui/ToastViewport.js";
import { toastError, dismissToast, getToasts, toastsHeld } from "../../../src/components/ui/toast-store.js";

void test("the toast viewport is a named region", async (t) => {
  toastError("Save failed");
  const view = await mount(h(ToastViewport));
  const region = view.container.querySelector("[role='region']");
  t.check({ name: region?.getAttribute("aria-label"), alerts: [...(region?.querySelectorAll("[role='alert']") ?? [])].map((a) => a.textContent?.startsWith("Save failed")) }, { name: "Notifications", alerts: [true] });
  await view.unmount();
  for (const toast of getToasts()) dismissToast(toast.id);
});


void test("an open dialog holds toast expiry until it closes", async (t) => {
  const held: boolean[] = [];
  toastError("Save failed");
  const view = await mount(h(ToastViewport));
  const dialog = document.createElement("dialog");
  document.body.append(dialog);
  t.teardown(() => dialog.remove());
  dialog.setAttribute("open", "");
  await eventually(() => toastsHeld(), { label: "held while the dialog is open" });
  held.push(toastsHeld());
  dialog.removeAttribute("open");
  await eventually(() => !toastsHeld(), { label: "released when the dialog closes" });
  held.push(toastsHeld());
  // Still there after a held stretch: the dialog did not let it expire unseen.
  const shown = getToasts().map((toast) => toast.message);
  await view.unmount();
  held.push(toastsHeld());
  for (const toast of getToasts()) dismissToast(toast.id);
  t.check({ held, shown }, { held: [true, false, false], shown: ["Save failed"] });
});
