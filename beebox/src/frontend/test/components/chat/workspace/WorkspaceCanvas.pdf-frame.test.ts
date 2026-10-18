// # PdfFrame — a PDF stays reachable even where it can't be displayed
//
// `PdfFrame` (`components/PdfFrame.tsx`) is the one way a PDF is shown: the `.pdf`
// file renderer and the "Original" view of an extracted document card both go
// through it.
//
// It renders an `<object>` rather than an `<iframe>` on purpose. When a browser
// can't display a PDF inline — iOS/WKWebView shows a blank rectangle for an
// embedded PDF — it renders the element's *children* instead, so the fallback
// below repeats the Open/Download affordances rather than leaving a dead grey box.
// Those children are always in the markup; only the browser decides whether to
// show them.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PdfFrame } from "../../../../src/components/PdfFrame.js";
import { registerFileType } from "../../../../src/file-type-registry.js";
import { pdfRenderer } from "../../../../src/renderers/pdf.js";
import { binaryRenderer } from "../../../../src/renderers/binary.js";
import { isWorkspacePdf } from "../../../../src/components/chat/workspace/WorkspaceCanvas/pdf-pane-view.js";

// Only these two members, not the full registry (`installRenderers()`):
// several other renderers (markdown, markdown-card, ...) pull in
// `lib/markdoc-parse.ts`, whose `@markdoc/markdoc` import doesn't resolve
// under the plain tsx/root-tsconfig runtime this doctest runs under.
for (const entry of [pdfRenderer, binaryRenderer]) registerFileType(entry.selector, { renderer: entry.renderer });
globalThis.React = React;

function render(props: React.ComponentProps<typeof PdfFrame>) {
  return renderToStaticMarkup(React.createElement(PdfFrame, props));
}

const base = { src: "/test/api/files/inbox/Handbook.attach/source.pdf", title: "Handbook", downloadName: "source.pdf" };

// ## The frame, the fallback, and the download link
void test("The frame, the fallback, and the download link", async (t) => {
  // doctest:L41
  const html = render({ ...base, mode: "page" });

  // doctest:L43
  await t.checkText(html.includes('<object data="/test/api/files/inbox/Handbook.attach/source.pdf" type="application/pdf"'), "true");

  // doctest:L46
  await t.checkText(
    // Open-in-new-tab is a labelled icon link (icon-only controls need a name).
    html.includes('aria-label="Open source.pdf in a new tab"'),
    "true",
  );
});

// Both affordances appear twice — once in the toolbar, once in the fallback — so a
// viewer who only ever sees the fallback still gets them:
void test("Both affordances appear twice — once in the toolbar, once in the fallback — s...", async (t) => {
  // doctest:L55
  const html = render({ ...base, mode: "page" });
  t.check(html.split('download="source.pdf"').length - 1, 2);
});

// ## Height comes from the surface
//
// `page` owns the viewport, so it takes a viewport-relative height. `chat` must
// fit inside FileView's `max-h-96` wrapper. `companion` and `embed` fill whatever
// their container gives them — a column flex whose object takes the leftover
// space, which is why FileView's companion wrapper is itself a column.
void test("page owns the viewport, so it takes a viewport-relative height.", async (t) => {
  // doctest:L68
  await t.checkText(render({ ...base, mode: "page" }).includes("h-[80vh]"), "true");

  // doctest:L71
  await t.checkText(render({ ...base, mode: "chat" }).includes("h-80"), "true");

  // doctest:L74
  // The companion frame claims the remainder of a column that has a height —
  // and falls back to a viewport floor when its ancestors are content-sized,
  // which is what the browse detail panel and the chat sidebar actually give it.
  const companion = render({ ...base, mode: "companion" });
  t.check([companion.includes("h-full min-h-0"), companion.includes("flex-1 min-h-[70vh]"), companion.includes("h-[80vh]")].join(" "), "true true false");
});

// An omitted `mode` behaves like `page`, the surface a bare PDF path lands on:
void test("An omitted mode behaves like page, the surface a bare PDF path lands on:", async (t) => {
  // doctest:L85
  await t.checkText(render(base) === render({ ...base, mode: "page" }), "true");
});

// ## Workspace supplies the file actions
//
// The tab already names the file and its menu supplies Open/Download. The frame
// uses the pane's available height without adding another toolbar or a viewport
// height floor. Unsupported viewers still receive the fallback links.
void test("The tab already names the file and its menu supplies Open/Download.", async (t) => {
  // doctest:L96
  const pane = render({ ...base, mode: "companion", workspacePdf: true });
  const beforeObject = pane.split("<object")[0];
  assert.ok(beforeObject !== undefined);
  await t.checkText(beforeObject.includes("Handbook"), "false");

  // doctest:L102
  t.check(pane.split('download="source.pdf"').length - 1, 1);

  // doctest:L105
  await t.checkText(pane.includes("min-h-[70vh]"), "false");

  // doctest:L108
  await t.checkText(pane.includes("w-full h-full flex-1 min-h-0"), "true");

  // doctest:L111
  await t.checkText(pane.includes("This PDF can’t be displayed here.") && pane.includes('aria-label="Open source.pdf in a new tab"'), "true");
});

// Old view names fall back to the preferred renderer, just as in FileView. An
// explicit Download view retains its selector so the PDF remains reachable.
void test("Old view names fall back to the preferred renderer, just as in FileView.", async (t) => {
  // doctest:L119
  t.check([null, "PDF", "pdf", "retired-view", "Download"].map((viewer) => isWorkspacePdf("_content/guide.pdf", viewer)), [
    true,
    true,
    true,
    true,
    false,
  ]);

  // doctest:L122
  t.check(isWorkspacePdf("_content/guide.pdf.card", null), false);
});
