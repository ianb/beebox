// Runtime lint `content-replaced`: content watched inside a file's view scope
// that is unmounted and mounted again while the view stays open is reported;
// closing and reopening the view, or content that stays gone, is not.
// The two bug shapes are rebuilt from their issues: the stale-notice wrapper
// (issues/closed/bugs/2026-11-03-card-contents-menu-collapses-and-reappears.md)
// and the per-render embed component
// (issues/closed/bugs/2026-10-26-card-contents-button-flickers-on-a-card-with-an-embedded-widget.md).
// Plan: docs/plans/runtime-lint.md, Track 2.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, Fragment, type ReactNode } from "react";
import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { createViewScope, RuntimeLintViewScope, useWatchedContent } from "../../../src/lib/runtime-lint/watched-content.js";
import { resetRuntimeLintForTest } from "../../../src/lib/runtime-lint/report.js";

function setup(t: Test) {
  resetRuntimeLintForTest(() => 0);
  t.capture(console, "warn");
  return () => (window.__bbxRuntimeLint?.take().records ?? []).map((record) => `${record.check} ${"surface" in record ? record.surface : ""}`);
}

function Body({ path }: { path: string }) {
  useWatchedContent("card-body", path);
  return h("p", null, "The card's text.");
}

function Embed({ src }: { src: string }) {
  useWatchedContent("card-embed", src);
  return h("figure", null, src);
}

/** The pre-fix `withBodyNotices`: the body alone, or inside a Fragment once a notice shows. */
function OldNotices({ stale, children }: { stale: boolean; children: ReactNode }) {
  if (!stale) return children;
  return h(Fragment, null, h("div", { role: "status" }, "Not up to date"), children);
}

function view(stale: boolean) {
  return h(RuntimeLintViewScope, null, h(OldNotices, { stale, children: h(Body, { path: "_content/report.doc.card" }) }));
}

void test("a body remounted by a wrapper change inside an open view is reported", async (t) => {
  const records = setup(t);
  const page = await mount(view(false));
  t.teardown(() => page.unmount());
  await page.rerender(view(true));
  await page.rerender(view(false));
  t.check(records(), ["content-replaced card-body"]);
});

void test("an embed made by a new component type each render is reported", async (t) => {
  const records = setup(t);
  // A component declared per render is a new type, so React remounts it.
  const card = () => {
    const PerRender = () => h(Embed, { src: "_content/figures/atoms.figure.card" });
    return h(RuntimeLintViewScope, null, h(PerRender));
  };
  const page = await mount(card());
  t.teardown(() => page.unmount());
  await page.rerender(card());
  t.check(records(), ["content-replaced card-embed"]);
});

void test("closing and reopening the view is not a replacement", async (t) => {
  const records = setup(t);
  const page = await mount(h("div", null, view(false)));
  t.teardown(() => page.unmount());
  await page.rerender(h("div", null, null));
  await page.rerender(h("div", null, view(false)));
  t.check(records(), []);
});

void test("one of two equal embeds replaced is reported", async (t) => {
  const records = setup(t);
  const card = (firstKey: string) => h(RuntimeLintViewScope, null,
    h(Embed, { key: firstKey, src: "_content/figures/same.figure.card" }),
    h(Embed, { key: "second", src: "_content/figures/same.figure.card" }));
  const page = await mount(card("first"));
  t.teardown(() => page.unmount());
  await page.rerender(card("first-again"));
  t.check(records(), ["content-replaced card-embed"]);
});

void test("content that stays gone, or comes back after 2 s, is not reported", async (t) => {
  setup(t);
  let now = 0;
  const scope = createViewScope(() => now);
  const releaseA = scope.register("card-embed", "a");
  releaseA();
  now = 60_000;
  // A region the person hid for editing and showed again a minute later.
  scope.register("card-embed", "a");
  t.check(window.__bbxRuntimeLint?.take().records ?? [], []);
});
