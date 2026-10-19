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
import "@ianbicking/tap-check/tap";
import { not } from "@ianbicking/tap-check/check";
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
  t.check(driveControlId("unmount", "Folder_A-1"), not(driveControlId("unmount", "folder_a-1")));
});

const BUTTON_BASE = "inline-flex items-center justify-center font-medium transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed";
const SPINNER = '<svg class="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
const GHOST = "bg-transparent text-warm-700 hover:bg-warm-100 rounded px-2.5 py-1 text-sm gap-1";
const DANGER = "bg-danger text-white hover:bg-danger-dark rounded px-2.5 py-1 text-sm gap-1";
const QUESTION = '<span class="text-warm-900 text-sm">Stop mirroring? Children stay where they are.</span>';
// The ID of "folder-1", encoded.
const ID = "mzxwyzdfoiwtc";

// ## Step one is a single button that commits to nothing
void test("Step one is a single button that commits to nothing", async (t) => {
  // doctest:L61
  t.check(
    render({ confirming: false }),
    `<button id="bbx-settings-drive-unmount-id-${ID}" type="button" class="${BUTTON_BASE} ${GHOST}"><span>Unmount</span></button>`,
  );
});

// ## Step two says what will happen, and offers a way back
void test("Step two says what will happen, and offers a way back", async (t) => {
  // doctest:L72
  t.check(
    render({ confirming: true }),
    `${QUESTION}<button id="bbx-settings-drive-confirm-id-${ID}" type="button" class="${BUTTON_BASE} ${DANGER}"><span>Yes, unmount</span></button>`
      + `<button id="bbx-settings-drive-cancel-id-${ID}" type="button" class="${BUTTON_BASE} ${GHOST}"><span>Cancel</span></button>`,
  );

  // ## A running unmount says so rather than looking untouched
  //
  // Principle 13: a control shows real state. While the mutation is in flight the
  // confirm button reads as working and Cancel is unavailable — the request is
  // already out.

  // doctest:L90
  t.check(
    render({ confirming: true, busy: true, pending: true }),
    `${QUESTION}<button id="bbx-settings-drive-confirm-id-${ID}" type="button" disabled="" aria-busy="true" class="${BUTTON_BASE} ${DANGER}">${SPINNER}<span>Unmounting…</span></button>`
      + `<button id="bbx-settings-drive-cancel-id-${ID}" type="button" disabled="" class="${BUTTON_BASE} ${GHOST}"><span>Cancel</span></button>`,
  );
});
