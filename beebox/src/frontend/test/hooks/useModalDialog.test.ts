// A modal dialog opens with focus on the named element and, when it closes,
// hands focus back to the element that had it before.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../helpers/dom-harness.js";
import { createElement as h, type ReactNode } from "react";
import { test } from "tap";
import { useModalDialog } from "../../src/hooks/useModalDialog.js";

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
