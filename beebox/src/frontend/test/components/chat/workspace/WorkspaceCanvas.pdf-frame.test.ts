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
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PdfFrame } from "../../../../src/components/PdfFrame.js";
import { registerFileType } from "../../../../src/file-type-registry.js";
import { pdfRenderer } from "../../../../src/renderers/pdf.js";
import { binaryRenderer } from "../../../../src/renderers/binary.js";
import { isWorkspacePdf } from "../../../../src/components/chat/workspace/WorkspaceCanvas/pdf-pane-view.js";

// Only these two members, not the full registry (`installRenderers()`):
// several other renderers (markdown, markdown-card, ...) pull in
// `lib/markdoc-parse.ts`, whose `@markdoc/markdoc` import doesn't resolve
// under the plain tsx/root-tsconfig runtime this test runs under.
for (const entry of [pdfRenderer, binaryRenderer]) registerFileType(entry.selector, { renderer: entry.renderer });
globalThis.React = React;

function render(props: React.ComponentProps<typeof PdfFrame>) {
  return renderToStaticMarkup(React.createElement(PdfFrame, props));
}

const base = { src: "/test/api/files/inbox/Handbook.attach/source.pdf", title: "Handbook", downloadName: "source.pdf" };

const SRC = "/test/api/files/inbox/Handbook.attach/source.pdf";
const DOWNLOAD_LINK = `<a href="${SRC}" target="_blank" rel="noopener noreferrer" download="source.pdf" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-warm-300 rounded hover:bg-warm-50 text-warm-700"><span>Download</span></a>`;
// Open-in-new-tab is a labelled icon link (icon-only controls need a name).
const OPEN_LINK = `<a href="${SRC}" target="_blank" rel="noopener noreferrer" aria-label="Open source.pdf in a new tab" title="Open source.pdf in a new tab" class="w-7 h-7 bg-transparent hover:bg-warm-200 text-warm-600 hover:text-warm-700 rounded-full inline-flex items-center justify-center flex-shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"></path></svg></a>`;
const TOOLBAR = `<div class="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-warm-200 bg-warm-50"><span class="text-warm-700 text-sm truncate flex-1 min-w-0" title="Handbook">Handbook</span>${DOWNLOAD_LINK}${OPEN_LINK}</div>`;
const FALLBACK = `<div class="p-4 flex flex-col items-start gap-3 bg-warm-50"><p class="text-warm-700 text-sm">This PDF can’t be displayed here. Open it in a new tab or download it.</p><div class="flex items-center gap-2">${DOWNLOAD_LINK}${OPEN_LINK}</div></div>`;

/** The frame: a wrapper, an optional toolbar, and the `<object>` with its fallback children. */
function frame(parts: { wrapperClass: string; toolbar: string; objectClass: string }): string {
  return `<div class="${parts.wrapperClass}">${parts.toolbar}<object data="${SRC}" type="application/pdf" title="Handbook" class="${parts.objectClass}">${FALLBACK}</object></div>`;
}

const pageFrame = frame({ wrapperClass: "flex flex-col", toolbar: TOOLBAR, objectClass: "w-full h-[80vh]" });

// ## The frame, the fallback, and the download link
//
// Both affordances appear twice, once in the toolbar and once in the fallback, so
// a viewer who only ever sees the fallback still gets them.
void test("The frame, the fallback, and the download link", async (t) => {
  t.check(render({ ...base, mode: "page" }), pageFrame);
});

// ## Height comes from the surface
//
// `page` owns the viewport, so it takes a viewport-relative height. `chat` must
// fit inside FileView's `max-h-96` wrapper. `companion` and `embed` fill whatever
// their container gives them — a column flex whose object takes the leftover
// space, which is why FileView's companion wrapper is itself a column.
void test("page owns the viewport, so it takes a viewport-relative height.", async (t) => {
  t.check(render({ ...base, mode: "page" }), pageFrame);

  t.check(render({ ...base, mode: "chat" }), frame({ wrapperClass: "flex flex-col", toolbar: TOOLBAR, objectClass: "w-full h-80" }));

  // The companion frame claims the remainder of a column that has a height —
  // and falls back to a viewport floor when its ancestors are content-sized,
  // which is what the browse detail panel and the chat sidebar actually give it.
  t.check(render({ ...base, mode: "companion" }), frame({ wrapperClass: "flex flex-col h-full min-h-0", toolbar: TOOLBAR, objectClass: "w-full flex-1 min-h-[70vh]" }));
});

// An omitted `mode` behaves like `page`, the surface a bare PDF path lands on:
void test("An omitted mode behaves like page, the surface a bare PDF path lands on:", async (t) => {
  t.check(render(base), pageFrame);
});

// ## Workspace supplies the file actions
//
// The tab already names the file and its menu supplies Open/Download. The frame
// uses the pane's available height without adding another toolbar or a viewport
// height floor. Unsupported viewers still receive the fallback links.
void test("The tab already names the file and its menu supplies Open/Download.", async (t) => {
  t.check(
    render({ ...base, mode: "companion", workspacePdf: true }),
    frame({ wrapperClass: "flex flex-col h-full min-h-0", toolbar: "", objectClass: "w-full h-full flex-1 min-h-0" }),
  );
});

// Old view names fall back to the preferred renderer, just as in FileView. An
// explicit Download view retains its selector so the PDF remains reachable.
void test("Old view names fall back to the preferred renderer, just as in FileView.", async (t) => {
  t.check([null, "PDF", "pdf", "retired-view", "Download"].map((viewer) => isWorkspacePdf("_content/guide.pdf", viewer)), [
    true,
    true,
    true,
    true,
    false,
  ]);

  t.check(isWorkspacePdf("_content/guide.pdf.card", null), false);
});
