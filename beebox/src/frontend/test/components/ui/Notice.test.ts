// Notice: a failed or degraded operation shown inline. The tone picks the live
// region role and the colors; an id passes through for the theme studio.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { any, containing, not } from "@ianbicking/tap-check/check";
import { Notice, NOTICE_TONE_CLASSES } from "../../../src/components/ui/Notice.js";

async function noticeOf(props: Parameters<typeof Notice>[0]): Promise<{ role: string | null; id: string; text: string; classes: string[] }> {
  const view = await mount(h(Notice, props));
  const element = view.container.firstElementChild;
  const result = {
    role: element?.getAttribute("role") ?? null,
    id: element?.id ?? "",
    text: element?.textContent ?? "",
    classes: [...(element?.classList ?? [])],
  };
  await view.unmount();
  return result;
}

void test("an error is an assertive alert in the danger colors", async (t) => {
  const notice = await noticeOf({ tone: "error", children: "Archive failed" });
  t.check(notice.role, "alert");
  t.check(notice.text, "Archive failed");
  t.check(notice.classes, ["rounded-lg", "border", "px-4", "py-3", "text-sm", "bg-danger-50", "border-danger-light", "text-danger-dark"]);
});

void test("a warning is a polite status in the warning colors with readable text", async (t) => {
  const notice = await noticeOf({ tone: "warning", children: "Docs API is off" });
  t.check(notice.role, "status");
  t.check(notice.classes, ["rounded-lg", "border", "px-4", "py-3", "text-sm", "bg-warning-50", "border-warning-light", "text-warm-800"]);
  t.check(NOTICE_TONE_CLASSES.warning, not(any(String).includes("text-warning-dark")));
});

void test("the id and layout class pass through; layout wins an overlap", async (t) => {
  const notice = await noticeOf({ tone: "warning", id: "bbx-admin-google-drive-docs-api", className: "mt-2 px-2", children: "x" });
  t.check(notice.id, "bbx-admin-google-drive-docs-api");
  t.check(notice.classes, containing(["mt-2", "px-2"]));
  t.check(notice.classes.filter((name) => name === "px-4"), []);
});
