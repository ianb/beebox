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
import "agent-doctest/tap";
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
  // doctest:L76
  const fields = readCard(ANALYZED);
  t.check([fields.title, fields.author, String(fields.pages), fields.format].join(" | "), "Employee Handbook | Wren Aldana | 12 | pdf");

  // doctest:L80
  t.check([fields.originalRef, fields.originalName, fields.channel, fields.acquired].join(" | "), "attach/source.pdf | handbook-2026.pdf | scanner | 2026-08-20T14:00:00Z");

  // doctest:L83
  t.check([String(fields.error), String(fields.unusable), fields.description].join(" | "), "null | false | The 2026 handbook, scanned.");

  // The `docling:` ref is read too — it is what the view needs to label page
  // boundaries in the extracted text (`lib/docling-match.ts`):

  // doctest:L91
  t.check(fields.doclingRef, "attach/docling.json.gz");
});

// A card with nothing optional filled in reads as nulls, not as `undefined`
// leaking into the markup:
void test("A card with nothing optional filled in reads as nulls, not as undefined leaki...", async (t) => {
  // doctest:L99
  const bare = readCard(`---
format: pdf
filename:
  ref: attach/source.pdf
  via:
    channel: scanner
    at: 2026-08-20T14:00:00Z
---
`);
  t.check([String(bare.title), String(bare.author), String(bare.pages), String(bare.description)].join(" "), "null null null null");

  // doctest:L111
  await t.checkText(String(bare.doclingRef), "null");
});

// ## Page renders come out of the attach listing
//
// Page images aren't referenced from the body — only the extractor's naming
// convention says which files they are. The derivation filters a `status.browse`
// listing to `page-NNN.webp` or archived `page-NNN.avif` and sorts numerically,
// so page 10 lands after page 2 rather than between 1 and 2.
void test("Page images aren't referenced from the body — only the extractor's naming con...", async (t) => {
  // doctest:L123
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
  t.check(pages.map((p) => p.page).join(","), "1,2,10,1000");

  // doctest:L137
  t.check(pages[0]?.src, "/test/api/image/inbox/Handbook.attach/page-001.avif");

  // doctest:L140
  t.check(pages[1]?.src, "/test/api/image/inbox/Handbook.attach/page-002.webp");

  // doctest:L143
  await t.checkText(
    pageRendersFrom([
      { name: "page-01.webp", relativePath: "page-01.webp" },
      { name: "page-003.png", relativePath: "page-003.png" },
    ], (p) => p).length,
    "0",
  );
});

// A card whose extraction never produced page renders yields an empty list, and
// the strip renders nothing at all rather than an empty scroller:
void test("A card whose extraction never produced page renders yields an empty list, and...", async (t) => {
  // doctest:L154
  await t.checkText(pageRendersFrom([{ name: "source.pdf", relativePath: "inbox/Handbook.attach/source.pdf" }], (p) => p).length, "0");

  // doctest:L157
  t.check(render(React.createElement(PdfPageStrip, { pages: [], activePage: null })), "");
});

// ## A card claiming pages that the attach listing didn't produce gets a notice
//
// `missingPageRenders` is the predicate behind `PdfCardView`'s muted notice: a
// card that says pages were extracted, whose attach-scope listing finished
// without error, but came back with none.
void test("missingPageRenders is the predicate behind PdfCardView's muted notice:", async (t) => {
  // doctest:L168
  const analyzedWithPages = { doclingRef: "attach/docling.json.gz", pages: 12 };

  // doctest:L170
  t.check(missingPageRenders({ fields: analyzedWithPages, pages: [], pagesLoading: false, pagesErrored: false }), true);

  // Still loading, or the listing errored: no notice yet — those get their own
  // state, not a false "missing" claim.

  // doctest:L178
  t.check(missingPageRenders({ fields: analyzedWithPages, pages: [], pagesLoading: true, pagesErrored: false }), false);

  // doctest:L181
  t.check(missingPageRenders({ fields: analyzedWithPages, pages: [], pagesLoading: false, pagesErrored: true }), false);

  // Renders are actually present: no notice.

  // doctest:L188
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
  // doctest:L201
  t.check(missingPageRenders({ fields: { doclingRef: "attach/docling.json.gz", pages: null }, pages: [], pagesLoading: false, pagesErrored: false }), false);

  // doctest:L204
  t.check(missingPageRenders({ fields: { doclingRef: null, pages: 12 }, pages: [], pagesLoading: false, pagesErrored: false }), false);

  // doctest:L207
  t.check(missingPageRenders({ fields: { doclingRef: "attach/docling.json.gz", pages: 0 }, pages: [], pagesLoading: false, pagesErrored: false }), false);
});

// ## `?page=3` highlights and anchors that page
void test("`?page=3` highlights and anchors that page", async (t) => {
  // doctest:L214
  t.check([String(requestedPage({ page: "3" })), String(requestedPage({})), String(requestedPage({ page: "later" }))].join(" "), "3 null null");
});

// The requested page gets a ring; the others don't. Each thumbnail also carries a
// `page-N` id, so a `#page-3` link lands on it.
void test("The requested page gets a ring; the others don't.", async (t) => {
  // doctest:L222
  const pages = [1, 2, 3].map((page) => ({ page, src: `/test/api/image/page-00${page}.avif` }));
  const html = render(React.createElement(PdfPageStrip, { pages, activePage: 3 }));

  // doctest:L225
  t.check(html.split("ring-2 ring-accent").length - 1, 1);

  // doctest:L228
  t.check(/id="page-3" data-page="3" class="[^"]*ring-2 ring-accent"/.test(html), true);

  // doctest:L231
  t.check(
    // Every page is present, alt-texted, and captioned.
    [html.includes('alt="Page 1"'), html.includes('alt="Page 3"'), html.includes("Page 2</span>")].join(" "),
    "true true true",
  );
});

// ## Status notices
//
// A failed extraction is the case the generic card renderer hid: an `error:`
// and no `docling:`. The banner quotes the error and names the command that
// re-runs extraction on this card.
void test("A failed extraction is the case the generic card renderer hid:", async (t) => {
  // doctest:L243
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

  // doctest:L261
  await t.checkText(html.includes("Text extraction failed"), "true");

  // doctest:L264
  await t.checkText(html.includes("docling exited 1 — no text layer found"), "true");

  // doctest:L267
  await t.checkText(html.includes(`bbx pdf reanalyze ${CARD_PATH}`), "true");
});

// `unusable: true` is a judgement someone made, and it outranks a failed
// extraction's banner. An extracted card with an empty body is a real answer
// ("no readable text"), not a failure — each gets a muted notice instead of the
// warning banner. A normal extracted card with text gets no notice.
void test("unusable:", async (t) => {
  // doctest:L277
  type NoticeProps = React.ComponentProps<typeof PdfStatusNotice>;
  function notice(props: Omit<NoticeProps, "error" | "unusable" | "cardPath"> & Partial<Pick<NoticeProps, "error" | "unusable">>) {
    return renderToStaticMarkup(React.createElement(PdfStatusNotice, { error: null, unusable: false, cardPath: CARD_PATH, ...props }));
  }

  // doctest:L282
  await t.checkText(notice({ extracted: false, unusable: true, error: "docling exited 1", hasBody: false }).includes("marked unusable"), "true");

  // doctest:L285
  await t.checkText(notice({ extracted: false, unusable: true, error: "docling exited 1", hasBody: false }).includes("Text extraction failed"), "false");

  // doctest:L288
  await t.checkText(notice({ extracted: true, hasBody: false }).includes("No readable text"), "true");

  // doctest:L291
  t.check(notice({ extracted: true, hasBody: true }), "");
});
