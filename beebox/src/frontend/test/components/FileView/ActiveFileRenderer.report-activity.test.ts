// # Built-in renderers receive the card's activity reporter
//
// A figure reports learner activity like an agent view does (plan
// docs/plans/figure-check.md, Track C), so ActiveFileRenderer hands the
// companion pane's `reportActivity` to built-in renderers too, not only to
// bound agent views.

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ActiveFileRenderer } from "../../../src/components/FileView/ActiveFileRenderer.js";
import type { RendererProps } from "../../../src/file-type-registry.js";

void test("a built-in renderer gets the reporter it was given", async (t) => {
  const received: Array<RendererProps["reportActivity"]> = [];
  function Recorder(props: RendererProps) {
    received.push(props.reportActivity);
    return null;
  }
  const reported: string[] = [];
  const reportActivity = (kind: string, detail?: string) => { reported.push(`${kind}: ${detail ?? ""}`); };
  renderToStaticMarkup(h(ActiveFileRenderer, {
    active: { name: "Figure", Component: Recorder, priority: 50 },
    binding: null,
    data: { path: "_content/physics/Scale.figure.card" },
    path: "_content/physics/Scale.figure.card",
    mode: "companion",
    reportActivity,
    onNavigate: () => {},
    renderInline: () => null,
  }));
  for (const report of received) report?.("explored", "set mass = 2");
  t.check(reported, ["explored: set mass = 2"]);
});
