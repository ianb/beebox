// The toast viewport is a named region, and only a modal holds its toasts.
// First, and bare: React DOM must load after the happy-dom window exists.
import { byId, mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ToastViewport } from "../../../src/components/ui/ToastViewport.js";
import { Popover } from "../../../src/components/ui/Popover.js";
import { ModalDialog } from "../../../src/components/ui/ModalDialog.js";
import { toastError, dismissToast, getToasts, toastsHeld } from "../../../src/components/ui/toast-store.js";

void test("the toast viewport is a named region", async (t) => {
  toastError("Save failed");
  const view = await mount(h(ToastViewport));
  const region = view.container.querySelector("[role='region']");
  t.check({ name: region?.getAttribute("aria-label"), alerts: [...(region?.querySelectorAll("[role='alert']") ?? [])].map((a) => a.textContent?.startsWith("Save failed")) }, { name: "Notifications", alerts: [true] });
  await view.unmount();
  for (const toast of getToasts()) dismissToast(toast.id);
});


// The toast hold belongs to ModalDialog, which covers the toasts. A Popover
// does not cover them, so their timers keep running while one is open.
void test("an open ModalDialog holds toast expiry until it closes; an open Popover does not", async (t) => {
  toastError("Save failed");
  const view = await mount(h(Host, { modal: false, popover: false }));
  const states: Record<string, boolean> = {};
  await view.rerender(h(Host, { modal: false, popover: true }));
  await view.act(() => { byId(view.container, "bbx-t-popover").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); });
  states.popoverOpen = toastsHeld();
  await view.rerender(h(Host, { modal: true, popover: false }));
  states.modalOpen = toastsHeld();
  await view.rerender(h(Host, { modal: false, popover: false }));
  states.modalClosed = toastsHeld();
  // Still there after a held stretch: the modal did not let it expire unseen.
  const shown = getToasts().map((toast) => toast.message);
  await view.unmount();
  for (const toast of getToasts()) dismissToast(toast.id);
  t.check({ states, shown }, { states: { popoverOpen: false, modalOpen: true, modalClosed: false }, shown: ["Save failed"] });
});

function Host({ modal, popover }: { modal: boolean; popover: boolean }) {
  return h("div", null,
    h(ToastViewport),
    popover
      ? h(Popover, { label: "Details", trigger: ({ toggle, ariaProps }) => h("button", { id: "bbx-t-popover", type: "button", onClick: toggle, ...ariaProps }, "Open"), children: "Text" })
      : null,
    h(ModalDialog, { open: modal, labelledBy: "bbx-t-heading", children: h("h2", { id: "bbx-t-heading" }, "Heading") }));
}
