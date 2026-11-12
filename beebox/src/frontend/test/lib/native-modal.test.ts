// # The native modal lifecycle
//
// `showNativeModal` is the open/close half that beebox's `useModalDialog` and
// the dev dashboard's hook share: it shows a `<dialog>` as a modal and returns
// the cleanup that closes it and gives focus back to the element that had it.
// The app effects (toast hold, Escape layers) are beebox's hook's own; its
// test covers them.
// First, and bare: the happy-dom window must exist before the DOM is touched.
import "../helpers/dom-globals.js";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { showNativeModal } from "../../src/lib/native-modal.js";

void test("opens as a modal, and the cleanup closes it and returns focus", async (t) => {
  const opener = document.createElement("button");
  opener.id = "opener";
  const dialog = document.createElement("dialog");
  const inside = document.createElement("button");
  inside.id = "inside";
  dialog.append(inside);
  document.body.append(opener, dialog);
  t.teardown(() => { opener.remove(); dialog.remove(); });
  opener.focus();
  const close = showNativeModal(dialog);
  inside.focus();
  const opened = { open: dialog.open, focus: document.activeElement?.id };
  close();
  t.check({ opened, closed: { open: dialog.open, focus: document.activeElement?.id } }, {
    opened: { open: true, focus: "inside" },
    closed: { open: false, focus: "opener" },
  });
});

// A dialog the caller already closed (its close event unmounts it) is left as
// it is; the cleanup still returns focus.
void test("the cleanup after a close of its own only returns focus", async (t) => {
  const opener = document.createElement("button");
  opener.id = "opener2";
  const dialog = document.createElement("dialog");
  document.body.append(opener, dialog);
  t.teardown(() => { opener.remove(); dialog.remove(); });
  opener.focus();
  const close = showNativeModal(dialog);
  dialog.close();
  document.body.focus();
  close();
  t.check({ open: dialog.open, focus: document.activeElement?.id }, { open: false, focus: "opener2" });
});
