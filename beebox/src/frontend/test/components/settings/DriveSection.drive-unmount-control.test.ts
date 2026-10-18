// # Unmounting asks twice, on the page
//
// `UnmountControl` (`components/settings/DriveMountRow.tsx`) is the settings
// page's unmount affordance. Unmounting is not destructive — children stay where
// they are and the card is recoverable from `_bookkeeping/trash/` — but it silently
// stops something the box was doing, and a mis-click is invisible until a sync
// that should have happened doesn't. So it is two steps.
//
// The second step is inline, not a browser `confirm()`: that dialog cannot say
// what unmounting does, and this is the one control on the page whose sentence a
// boxholder should read before answering.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  driveControlId,
  UnmountControl,
} from "../../../src/components/settings/DriveSection/DriveMountRow.js";
import { isControlAddress } from "../../../src/lib/ui-scan/resolve.js";

globalThis.React = React;

const noop = () => {};

function render(state: { confirming: boolean; busy?: boolean; pending?: boolean }): string {
  return renderToStaticMarkup(
    React.createElement(UnmountControl, {
      driveId: "folder-1",
      confirming: state.confirming,
      busy: state.busy ?? false,
      pending: state.pending ?? false,
      onAsk: noop,
      onCancel: noop,
      onConfirm: noop,
    }),
  );
}

// Drive IDs are case-sensitive and may contain characters outside the control
// scan's lowercase address grammar. The row encodes the complete ID rather than
// lowercasing it, so distinct Drive IDs stay distinct and every control remains
// addressable.
void test("Drive IDs are case-sensitive and may contain characters outside the control s...", async (t) => {
  // doctest:L47
  const encoded = driveControlId("unmount", "Folder_A-1");
  t.check(encoded, "bbx-settings-drive-unmount-id-izxwyzdfojpucljr");

  // doctest:L51
  t.check(isControlAddress(encoded), true);

  // doctest:L54
  await t.checkText(driveControlId("unmount", "Folder_A-1") === driveControlId("unmount", "folder_a-1"), "false");
});

// ## Step one is a single button that commits to nothing
void test("Step one is a single button that commits to nothing", async (t) => {
  // doctest:L61
  const idle = render({ confirming: false });
  await t.checkText(idle.includes(">Unmount<"), "true");

  // doctest:L65
  await t.checkText(idle.includes("Yes, unmount"), "false");
});

// ## Step two says what will happen, and offers a way back
void test("Step two says what will happen, and offers a way back", async (t) => {
  // doctest:L72
  const asked = render({ confirming: true });
  await t.checkText(asked.includes("Stop mirroring? Children stay where they are."), "true");

  // doctest:L76
  await t.checkText(asked.includes("Yes, unmount"), "true");

  // doctest:L79
  await t.checkText(asked.includes(">Cancel<"), "true");

  // ## A running unmount says so rather than looking untouched
  //
  // Principle 13: a control shows real state. While the mutation is in flight the
  // confirm button reads as working and Cancel is unavailable — the request is
  // already out.

  // doctest:L90
  const running = render({ confirming: true, busy: true, pending: true });
  await t.checkText(running.includes("Unmounting…"), "true");

  // doctest:L94
  await t.checkText(running.includes("disabled"), "true");
});
