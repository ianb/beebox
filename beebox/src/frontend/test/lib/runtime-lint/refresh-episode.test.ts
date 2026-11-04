// Runtime lint `refresh-failed`: an open card whose refresh fails reports the
// failure and its kind, then the recovery with how long it lasted. Moving to
// another path ends the episode with no recovery record.
// Plan: docs/implemented-plans/runtime-lint.md, Track 2.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { refreshFailureKind, useRefreshEpisode } from "../../../src/lib/runtime-lint/refresh-episode.js";
import { opaqueId, resetRuntimeLintForTest } from "../../../src/lib/runtime-lint/report.js";

const notFound = { data: { code: "NOT_FOUND" } };

function Card({ path, failing }: { path: string; failing: boolean }) {
  useRefreshEpisode({ path, surface: "card-body", failing, error: failing ? notFound : null });
  return null;
}

function setup(t: Test) {
  resetRuntimeLintForTest(() => 0);
  t.capture(console, "warn");
  return () => window.__bbxRuntimeLint?.take().records ?? [];
}

void test("a failed refresh, then its recovery", async (t) => {
  const records = setup(t);
  const page = await mount(h(Card, { path: "_content/report.doc.card", failing: false }));
  t.teardown(() => page.unmount());
  await page.rerender(h(Card, { path: "_content/report.doc.card", failing: true }));
  await page.rerender(h(Card, { path: "_content/report.doc.card", failing: false }));
  t.check(records(), [
    { check: "refresh-failed", phase: "failed", surface: "card-body", content: opaqueId("_content/report.doc.card"), kind: "not-found", seq: 1 },
    { check: "refresh-failed", phase: "recovered", surface: "card-body", content: opaqueId("_content/report.doc.card"), durationMs: any(Number), seq: 2 },
  ]);
});

void test("moving to another card ends the episode without a recovery", async (t) => {
  const records = setup(t);
  const page = await mount(h(Card, { path: "_content/a.doc.card", failing: true }));
  t.teardown(() => page.unmount());
  await page.rerender(h(Card, { path: "_content/b.doc.card", failing: false }));
  t.check(records(), [{ check: "refresh-failed", phase: "failed", surface: "card-body", content: opaqueId("_content/a.doc.card"), kind: "not-found", seq: 1 }]);
});

void test("the kind comes from the error's code, never its text", async (t) => {
  t.check([refreshFailureKind(notFound), refreshFailureKind(new Error("Card not found: x")), refreshFailureKind(null)], ["not-found", "other", "other"]);
});
