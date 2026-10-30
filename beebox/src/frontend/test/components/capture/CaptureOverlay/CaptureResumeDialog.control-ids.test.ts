// The capture resume dialog: a dark native modal with three choices. Its
// buttons carry their `bbx-` ids, except in dev specimens
// (`includeControlIds={false}`), which render without ids. Escape does nothing.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { any } from "@ianbicking/tap-check/check";
import { CaptureResumeDialog } from "../../../../src/components/capture/CaptureOverlay/CaptureResumeDialog.js";

const capture = {
  id: "capture-1",
  startedAt: "2026-10-22T16:10:00Z",
  counts: { photos: 2, audioSegments: 1, files: 0 },
};

// The date reads relative to now; the contents wording is the shared summarizer's.
const SUMMARY = any(String).includes("it still has 2 photos, 1 recording.");

async function render(includeControlIds: boolean | undefined) {
  const noop = (): void => {};
  const view = await mount(h(CaptureResumeDialog, {
    capture,
    busy: false,
    onResume: noop,
    onSubmit: noop,
    onDiscard: noop,
    ...(includeControlIds === undefined ? {} : { includeControlIds }),
  }));
  const dialog = view.container.querySelector("dialog");
  const cancel = new Event("cancel", { cancelable: true });
  await view.act(() => { dialog?.dispatchEvent(cancel); });
  const result = {
    open: dialog?.open,
    ids: [...view.container.querySelectorAll("button")].map((button) => button.id),
    escapePrevented: cancel.defaultPrevented,
    text: view.container.querySelector("p")?.textContent,
  };
  await view.unmount();
  return result;
}

void test("by default each choice carries its bbx- id", async (t) => {
  t.check(await render(undefined), {
    open: true,
    ids: ["bbx-capture-resume", "bbx-capture-resume-submit", "bbx-capture-resume-discard"],
    escapePrevented: true,
    text: SUMMARY,
  });
});

void test("a dev specimen renders without ids", async (t) => {
  t.check(await render(false), { open: true, ids: ["", "", ""], escapePrevented: true, text: SUMMARY });
});
