// An upload chip shows a native progress: indeterminate until a total is known.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { FileAttachmentPanel, type FileAttachmentItem } from "../../../../../src/components/chat/InteractiveChat-layout/view/ChatAttachments.js";

function chip(state: FileAttachmentItem["state"]): FileAttachmentItem {
  return { id: 1, originalName: "a.pdf", size: 10, mimetype: "application/pdf", state };
}

void test("an upload with no progress yet is an indeterminate native progress", async (t) => {
  const view = await mount(h(FileAttachmentPanel, {
    attachments: [chip({ status: "uploading", progress: 0 })],
    onRemove: () => {},
    onRetry: () => {},
  }));
  const bar = view.container.querySelector("progress");
  t.check({ name: bar?.getAttribute("aria-label"), value: bar?.getAttribute("value") ?? null, role: bar?.getAttribute("role") ?? null },
    { name: "Uploading a.pdf", value: null, role: null });
  await view.unmount();
});

void test("an upload with progress reports its value", async (t) => {
  const view = await mount(h(FileAttachmentPanel, {
    attachments: [chip({ status: "uploading", progress: 0.5 })],
    onRemove: () => {},
    onRetry: () => {},
  }));
  const bar = view.container.querySelector("progress");
  t.check({ value: bar?.getAttribute("value"), max: bar?.getAttribute("max") }, { value: "50", max: "100" });
  await view.unmount();
});

