// # Pdf card — reading its frontmatter, its pages, its extraction outcome
//
// The pdf card (`src/schemas/pdf.ts`) reaches the frontend as parsed
// frontmatter plus a markdown body. `PdfCardView` is the container that
// fetches the card's attach-scope listing and renders the Markdoc body; the parts
// tested here are the pieces it composes — the frontmatter reader, the page-strip
// derivation, and the two presentational components. (The container itself pulls
// in Markdoc, which doesn't load under plain Node ESM, so it's covered by the
// browser pass rather than here.)

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseCardText } from "../../../core/card-io.js";
import { PdfSchema } from "../../../schemas/pdf.js";
import { isRecord } from "../../../shared/is-record.js";
import {
  EXTRACTED_CARD_TYPE,
  missingPageRenders,
  pageRendersFrom,
  readExtractedFields,
  requestedPage,
} from "../../src/lib/pdf-card.js";
import { PdfPageStrip } from "../../src/components/PdfCardView/PdfPageStrip.js";
import { PdfStatusNotice } from "../../src/components/PdfCardView/PdfStatusNotice.js";
import { LightboxProvider } from "../../src/components/LightboxProvider.js";

globalThis.React = React;

const schemas = new Map([[EXTRACTED_CARD_TYPE, PdfSchema]]);
const CARD_PATH = `inbox/Handbook.${EXTRACTED_CARD_TYPE}.card`;

/** Parse a card the way the backend does, then read it the way the view does. */
function readCard(text: string) {
  const fields = parseCardText(text, { source: CARD_PATH, schemas }).fields;
  return readExtractedFields(isRecord(fields) ? fields : {});
}

const ANALYZED = `---
format: pdf
filename:
  ref: attach/source.pdf
  via:
    channel: scanner
    at: 2026-08-20T14:00:00Z
  original-name: handbook-2026.pdf
  mime-type: application/pdf
docling:
  ref: attach/docling.json.gz
metadata:
  pages: 12
  title: Employee Handbook
  author: Wren Aldana
description: The 2026 handbook, scanned.
---
# Employee Handbook

Onboarding starts on your first Monday.

![Figure 1](attach/figure-001.avif)
`;

/** Render a component, wrapping it in the lightbox context thumbnails need. */
function render(element: React.ReactElement) {
  return renderToStaticMarkup(React.createElement(LightboxProvider, null, element));
}

// ## Reading the frontmatter
//
// Everything the header shows comes from one tolerant read of the frontmatter —
// nested `filename:`/`metadata:` entries included, and a missing entry is `null`
// rather than a crash in a renderer.
void test("Everything the header shows comes from one tolerant read of the frontmatter —...", async (t) => {
  t.check(readCard(ANALYZED), {
    format: "pdf",
    originalRef: "attach/source.pdf",
    doclingRef: "attach/docling.json.gz",
    originalName: "handbook-2026.pdf",
    acquired: "2026-08-20T14:00:00Z",
    channel: "scanner",
    title: "Employee Handbook",
    author: "Wren Aldana",
    pages: 12,
    error: null,
    unusable: false,
    description: "The 2026 handbook, scanned.",
  });
});

// A card with nothing optional filled in reads as nulls, not as `undefined`
// leaking into the markup:
void test("A card with nothing optional filled in reads as nulls, not as undefined leaki...", async (t) => {
  const bare = readCard(`---
format: pdf
filename:
  ref: attach/source.pdf
  via:
    channel: scanner
    at: 2026-08-20T14:00:00Z
---
`);
  t.check(bare, {
    format: "pdf",
    originalRef: "attach/source.pdf",
    doclingRef: null,
    originalName: null,
    acquired: "2026-08-20T14:00:00Z",
    channel: "scanner",
    title: null,
    author: null,
    pages: null,
    error: null,
    unusable: false,
    description: null,
  });
});

// ## Page renders come out of the attach listing
//
// Page images aren't referenced from the body — only the extractor's naming
// convention says which files they are. The derivation filters a `status.browse`
// listing to `page-NNN.webp` or archived `page-NNN.avif` and sorts numerically,
// so page 10 lands after page 2 rather than between 1 and 2.
void test("Page images aren't referenced from the body — only the extractor's naming con...", async (t) => {
  const listing = {
    files: [
      { name: "source.pdf", relativePath: "inbox/Handbook.attach/source.pdf" },
      { name: "page-1000.webp", relativePath: "inbox/Handbook.attach/page-1000.webp" },
      { name: "page-010.avif", relativePath: "inbox/Handbook.attach/page-010.avif" },
      { name: "figure-001.avif", relativePath: "inbox/Handbook.attach/figure-001.avif" },
      { name: "page-002.webp", relativePath: "inbox/Handbook.attach/page-002.webp" },
      { name: "page-001.avif", relativePath: "inbox/Handbook.attach/page-001.avif" },
    ],
  };
  const pages = pageRendersFrom(listing.files, (p) => `/test/api/image/${p}`);
  t.check(pages, [
    {
      page: 1,
      src: "/test/api/image/inbox/Handbook.attach/page-001.avif",
    },
    {
      page: 2,
      src: "/test/api/image/inbox/Handbook.attach/page-002.webp",
    },
    {
      page: 10,
      src: "/test/api/image/inbox/Handbook.attach/page-010.avif",
    },
    {
      page: 1000,
      src: "/test/api/image/inbox/Handbook.attach/page-1000.webp",
    },
  ]);

  t.check(
    pageRendersFrom([
      { name: "page-01.webp", relativePath: "page-01.webp" },
      { name: "page-003.png", relativePath: "page-003.png" },
    ], (p) => p),
    [],
  );
});

// A card whose extraction never produced page renders yields an empty list, and
// the strip renders nothing at all rather than an empty scroller:
void test("A card whose extraction never produced page renders yields an empty list, and...", async (t) => {
  t.check(pageRendersFrom([{ name: "source.pdf", relativePath: "inbox/Handbook.attach/source.pdf" }], (p) => p), []);

  t.check(render(React.createElement(PdfPageStrip, { pages: [], activePage: null })), "");
});

// ## A card claiming pages that the attach listing didn't produce gets a notice
//
// `missingPageRenders` is the predicate behind `PdfCardView`'s muted notice: a
// card that says pages were extracted, whose attach-scope listing finished
// without error, but came back with none.
void test("missingPageRenders is the predicate behind PdfCardView's muted notice:", async (t) => {
  const analyzedWithPages = { doclingRef: "attach/docling.json.gz", pages: 12 };

  t.check(missingPageRenders({ fields: analyzedWithPages, pages: [], pagesLoading: false, pagesErrored: false }), true);

  // Still loading, or the listing errored: no notice yet — those get their own
  // state, not a false "missing" claim.

  t.check(missingPageRenders({ fields: analyzedWithPages, pages: [], pagesLoading: true, pagesErrored: false }), false);

  t.check(missingPageRenders({ fields: analyzedWithPages, pages: [], pagesLoading: false, pagesErrored: true }), false);

  // Renders are actually present: no notice.

  t.check(
    missingPageRenders({
      fields: analyzedWithPages,
      pages: [{ page: 1, src: "/x" }],
      pagesLoading: false,
      pagesErrored: false,
    }),
    false,
  );
});

// A card that never claimed to have pages — `metadata.pages` absent, or a
// card with no `docling:` extraction — stays silent even with zero renders:
void test("A card that never claimed to have pages — metadata.pages absent, or a card wi...", async (t) => {
  t.check(missingPageRenders({ fields: { doclingRef: "attach/docling.json.gz", pages: null }, pages: [], pagesLoading: false, pagesErrored: false }), false);

  t.check(missingPageRenders({ fields: { doclingRef: null, pages: 12 }, pages: [], pagesLoading: false, pagesErrored: false }), false);

  t.check(missingPageRenders({ fields: { doclingRef: "attach/docling.json.gz", pages: 0 }, pages: [], pagesLoading: false, pagesErrored: false }), false);
});

// ## `?page=3` highlights and anchors that page
void test("`?page=3` highlights and anchors that page", async (t) => {
  t.check([requestedPage({ page: "3" }), requestedPage({}), requestedPage({ page: "later" })], [3, null, null]);
});

// The requested page gets a ring; the others don't. Each thumbnail also carries a
// `page-N` id, so a `#page-3` link lands on it.
void test("The requested page gets a ring; the others don't.", async (t) => {
  const pages = [1, 2, 3].map((page) => ({ page, src: `/test/api/image/page-00${page}.avif` }));
  const html = render(React.createElement(PdfPageStrip, { pages, activePage: 3 }));

  t.check(html, "<div class=\"flex gap-3 overflow-x-auto pb-2\"><figure id=\"page-1\" data-page=\"1\" class=\"flex-shrink-0 flex flex-col items-center gap-1 p-1 rounded\"><button type=\"button\" aria-label=\"Page 1 (click to zoom)\" class=\"block border-0 bg-transparent p-0 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent\"><img src=\"/test/api/image/page-001.avif\" alt=\"Page 1\" loading=\"lazy\" class=\"max-w-xs max-h-64 rounded border border-warm-300 m-0\" data-image-src=\"/test/api/image/page-001.avif\" data-image-alt=\"Page 1\"/></button><figcaption><span class=\"text-warm-700 text-xs\">Page 1</span></figcaption></figure><figure id=\"page-2\" data-page=\"2\" class=\"flex-shrink-0 flex flex-col items-center gap-1 p-1 rounded\"><button type=\"button\" aria-label=\"Page 2 (click to zoom)\" class=\"block border-0 bg-transparent p-0 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent\"><img src=\"/test/api/image/page-002.avif\" alt=\"Page 2\" loading=\"lazy\" class=\"max-w-xs max-h-64 rounded border border-warm-300 m-0\" data-image-src=\"/test/api/image/page-002.avif\" data-image-alt=\"Page 2\"/></button><figcaption><span class=\"text-warm-700 text-xs\">Page 2</span></figcaption></figure><figure id=\"page-3\" data-page=\"3\" class=\"flex-shrink-0 flex flex-col items-center gap-1 p-1 rounded ring-2 ring-accent\"><button type=\"button\" aria-label=\"Page 3 (click to zoom)\" class=\"block border-0 bg-transparent p-0 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent\"><img src=\"/test/api/image/page-003.avif\" alt=\"Page 3\" loading=\"lazy\" class=\"max-w-xs max-h-64 rounded border border-warm-300 m-0\" data-image-src=\"/test/api/image/page-003.avif\" data-image-alt=\"Page 3\"/></button><figcaption><span class=\"text-warm-700 text-xs\">Page 3</span></figcaption></figure></div>");
});

// ## Status notices
//
// A failed extraction is the case the generic card renderer hid: an `error:`
// and no `docling:`. The banner quotes the error and names the command that
// re-runs extraction on this card.
void test("A failed extraction is the case the generic card renderer hid:", async (t) => {
  const failed = readCard(`---
format: pdf
filename:
  ref: attach/source.pdf
  via:
    channel: scanner
    at: 2026-08-20T14:00:00Z
error: docling exited 1 — no text layer found
---
`);
  const html = renderToStaticMarkup(React.createElement(PdfStatusNotice, {
    extracted: failed.doclingRef !== null,
    error: failed.error,
    unusable: failed.unusable,
    hasBody: false,
    cardPath: CARD_PATH,
  }));

  t.check(html, "<div role=\"status\" class=\"rounded-lg border px-4 py-3 text-sm bg-warning-50 border-warning-light text-warm-800\"><p class=\"text-warm-900 text-sm font-medium\">Text extraction failed — the original file is still attached.</p><div class=\"mt-2\"><pre class=\"font-mono whitespace-pre-wrap break-words text-sm text-warm-800\">docling exited 1 — no text layer found</pre></div><p class=\"text-warm-900 text-sm mt-2\">Re-run it with <code>bbx pdf reanalyze inbox/Handbook.pdf.card</code>.</p></div>");
});

// `unusable: true` is a judgement someone made, and it outranks a failed
// extraction's banner. An extracted card with an empty body is a real answer
// ("no readable text"), not a failure — each gets a muted notice instead of the
// warning banner. A normal extracted card with text gets no notice.
void test("unusable:", async (t) => {
  type NoticeProps = React.ComponentProps<typeof PdfStatusNotice>;
  function notice(props: Omit<NoticeProps, "error" | "unusable" | "cardPath"> & Partial<Pick<NoticeProps, "error" | "unusable">>) {
    return renderToStaticMarkup(React.createElement(PdfStatusNotice, { error: null, unusable: false, cardPath: CARD_PATH, ...props }));
  }

  t.check(notice({ extracted: false, unusable: true, error: "docling exited 1", hasBody: false }), "<div class=\"p-3 bg-warm-100 border border-warm-200 rounded\" role=\"status\"><p class=\"text-warm-700 text-sm\">This document was marked unusable (corrupt, junk, or an empty scan).</p></div>");
  t.check(notice({ extracted: true, hasBody: false }), "<div class=\"p-3 bg-warm-100 border border-warm-200 rounded\" role=\"status\"><p class=\"text-warm-700 text-sm\">No readable text in this document — see the original or the page renders.</p></div>");

  t.check(notice({ extracted: true, hasBody: true }), "");
});
