// # Figure card layout — a notice keeps the description and the caption
//
// The figure card puts every state (loading, a notice, the mounted figure) in
// one slot inside `FigureLayout`, so a figure that cannot draw keeps the
// card's description (page) and the embed's `![caption]` (embed). The
// container (`FigureView`) pulls in Markdoc, which does not load under plain
// Node, so it is checked in the browser; this renders the layout and the
// notice it holds.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FigureLayout, FigureNotice } from "../../../src/components/FigureView/FigureLayout.js";

globalThis.React = React;

const OUTDATED = { kind: "outdated", detail: "v.cache was removed: use v.picture" } as const;

/** The page's visible text, one entry per text run. */
function text(html: string): string[] {
  return html.split(/<[^>]+>/u).map((s) => s.trim()).filter((s) => s !== "");
}

void test("page mode keeps the description below a notice", async (t) => {
  const html = renderToStaticMarkup(React.createElement(FigureLayout, {
    mode: "page",
    caption: undefined,
    description: React.createElement("p", null, "Balance the reaction by dragging molecules."),
    children: React.createElement(FigureNotice, { notice: OUTDATED }),
  }));
  // The learner sees no technical line: `v.cache was removed` goes only to
  // the console warning and `bbx figure run` (boxholder's wording, Checkpoint 5).
  t.check(text(html), [
    "This figure is being updated",
    "It will be back soon.",
    "Balance the reaction by dragging molecules.",
  ]);
  t.check(/role="(\w+)"/u.exec(html)?.[1], "status");
});

void test("embed mode keeps the caption beneath a notice", async (t) => {
  const html = renderToStaticMarkup(React.createElement(FigureLayout, {
    mode: "embed",
    caption: "balance it",
    description: null,
    children: React.createElement(FigureNotice, { notice: { kind: "no-webgpu", detail: "no WebGPU" } }),
  }));
  t.check(text(html), [
    "This figure can&#x27;t draw on this device",
    "It draws with WebGPU, which this browser or device does not offer. Updating the browser or the operating system may add it, or the figure may work on another device.",
    "balance it",
  ]);
});

void test("no adapter and other errors each have their own text", async (t) => {
  const render = (notice: React.ComponentProps<typeof FigureNotice>["notice"]) => text(renderToStaticMarkup(React.createElement(FigureNotice, { notice })));
  t.check({
    adapter: render({ kind: "no-adapter", detail: "no GPU adapter" }),
    error: render({ kind: "error", detail: "Build failed with 1 error" }),
  }, {
    adapter: ["This figure can&#x27;t draw on this device", "This browser has WebGPU turned off, or has no graphics hardware it can use for it."],
    error: ["Figure error", "Build failed with 1 error"],
  });
});
