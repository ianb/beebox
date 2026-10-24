// ModalCard: opens a native modal <dialog>, routes Escape (the native cancel
// event) to onCancel with the browser's close prevented, routes a press on the
// backdrop to onBackdropClick, forwards the id, and returns focus on close.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { ModalCard, type ModalCardProps } from "../../../src/components/ui/ModalCard.js";

function card(props: Partial<Omit<ModalCardProps, "children">>) {
  const children = [h("h2", { id: "title", key: "title" }, "Title"), h("button", { id: "inside", type: "button", key: "inside" }, "Inside")];
  return h(ModalCard, { open: true, labelledBy: "title", ...props, children });
}

void test("open shows a modal dialog with the id and label; closing returns focus", async (t) => {
  const opener = document.createElement("button");
  opener.id = "opener";
  document.body.append(opener);
  t.teardown(() => opener.remove());
  opener.focus();

  const view = await mount(card({ id: "bbx-test-dialog", initialFocus: "#inside" }));
  t.teardown(() => view.unmount());
  const dialog = view.container.querySelector("dialog");
  const opened = {
    open: dialog?.open,
    id: dialog?.id,
    labelledBy: dialog?.getAttribute("aria-labelledby"),
    focus: document.activeElement?.id,
  };
  await view.rerender(card({ open: false, id: "bbx-test-dialog", initialFocus: "#inside" }));
  t.check({ opened, closed: { dialog: view.container.querySelector("dialog"), focus: document.activeElement?.id } }, {
    opened: { open: true, id: "bbx-test-dialog", labelledBy: "title", focus: "inside" },
    closed: { dialog: null, focus: "opener" },
  });
});

void test("Escape calls onCancel and prevents the native close", async (t) => {
  let cancels = 0;
  const view = await mount(card({ onCancel: () => { cancels += 1; } }));
  t.teardown(() => view.unmount());
  const dialog = view.container.querySelector("dialog");
  const cancel = new Event("cancel", { cancelable: true });
  await view.act(() => { dialog?.dispatchEvent(cancel); });
  t.check({ cancels, prevented: cancel.defaultPrevented, open: dialog?.open }, { cancels: 1, prevented: true, open: true });
});

void test("without onCancel, Escape is still prevented and does nothing", async (t) => {
  const view = await mount(card({}));
  t.teardown(() => view.unmount());
  const dialog = view.container.querySelector("dialog");
  const cancel = new Event("cancel", { cancelable: true });
  await view.act(() => { dialog?.dispatchEvent(cancel); });
  t.check({ prevented: cancel.defaultPrevented, open: dialog?.open }, { prevented: true, open: true });
});

// The card's padding is on an inner box, so only a press on the backdrop
// targets the <dialog> itself; a press inside the card is not a dismissal.
void test("a press on the backdrop calls onBackdropClick; a press inside does not", async (t) => {
  let presses = 0;
  const view = await mount(card({ onBackdropClick: () => { presses += 1; } }));
  t.teardown(() => view.unmount());
  const dialog = view.container.querySelector("dialog");
  await view.act(() => { view.container.querySelector("#inside")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  const afterInside = presses;
  await view.act(() => { dialog?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  t.check({ afterInside, afterBackdrop: presses }, { afterInside: 0, afterBackdrop: 1 });
});

// Chrome closes a modal itself on a repeated Escape with no click in between,
// ignoring preventDefault. That close counts as Escape, and a dialog the
// caller keeps open comes back.
void test("a close the browser forces counts as Escape and reopens a kept dialog", async (t) => {
  let cancels = 0;
  const view = await mount(card({ onCancel: () => { cancels += 1; } }));
  t.teardown(() => view.unmount());
  const dialog = view.container.querySelector("dialog");
  await view.act(async () => {
    dialog?.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  t.check({ cancels, open: dialog?.open }, { cancels: 1, open: true });
});

void test("closing through the open prop does not count as Escape", async (t) => {
  let cancels = 0;
  const onCancel = (): void => { cancels += 1; };
  const view = await mount(card({ onCancel }));
  t.teardown(() => view.unmount());
  await view.rerender(card({ open: false, onCancel }));
  await view.act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  t.check(cancels, 0);
});
