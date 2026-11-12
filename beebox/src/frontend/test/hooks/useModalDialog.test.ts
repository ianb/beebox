// A modal dialog opens with focus on the named element and, when it closes,
// hands focus back to the element that had it before. While open it holds
// toast expiry, and a modal that unmounts while open releases the hold.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../helpers/dom-harness.js";
import { createElement as h, type ReactNode } from "react";
import { test } from "tap";
import { useModalDialog } from "../../src/hooks/useModalDialog.js";
import { toastsHeld } from "../../src/components/ui/toast-store.js";

const opener = document.createElement("button");
opener.id = "opener";
const dialogElement = document.createElement("dialog");
const close = document.createElement("button");
close.id = "close";
dialogElement.append(document.createElement("input"), close);
document.body.append(opener, dialogElement);
const dialog = { current: dialogElement };

function Host({ open }: { open: boolean }): ReactNode {
  useModalDialog({ dialog, open, initialFocus: "#close" });
  return null;
}

void test("focus moves in on open and back out on close", async (t) => {
  opener.focus();
  const view = await mount(h(Host, { open: true }));
  t.teardown(() => view.unmount());
  const opened = { open: dialogElement.open, focus: document.activeElement?.id };
  await view.rerender(h(Host, { open: false }));
  t.check({ opened, closed: { open: dialogElement.open, focus: document.activeElement?.id } }, {
    opened: { open: true, focus: "close" },
    closed: { open: false, focus: "opener" },
  });
});

void test("an open modal holds toasts, and unmounting it while open releases them", async (t) => {
  const view = await mount(h(Host, { open: true }));
  const whileOpen = toastsHeld();
  await view.unmount();
  t.check({ whileOpen, afterUnmount: toastsHeld(), dialogOpen: dialogElement.open }, { whileOpen: true, afterUnmount: false, dialogOpen: false });
});
