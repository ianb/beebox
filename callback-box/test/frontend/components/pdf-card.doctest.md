# Pdf card — reading its frontmatter, its pages, its status

The pdf card (`src/schemas/pdf.ts`) reaches the frontend as parsed
frontmatter plus a markdown body. `PdfCardView` is the container that
fetches the card's attach-scope listing and renders the Markdoc body; the parts
tested here are the pieces it composes — the frontmatter reader, the page-strip
derivation, and the two presentational components. (The container itself pulls
in Markdoc, which doesn't load under plain Node ESM, so it's covered by the
browser pass rather than here.)

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseCardText } from "../../../src/core/card-io.js";
import { PdfSchema } from "../../../src/schemas/pdf.js";
import { isRecord } from "../../../src/lib/is-record.js";
import {
  EXTRACTED_CARD_TYPE,
  missingPageRenders,
  pageRendersFrom,
  readExtractedFields,
  requestedPage,
} from "../../../src/frontend/src/lib/pdf-card.js";
import { PdfPageStrip } from "../../../src/frontend/src/components/PdfPageStrip.js";
import { PdfStatusNotice } from "../../../src/frontend/src/components/PdfStatusNotice.js";
import { LightboxProvider } from "../../../src/frontend/src/components/LightboxProvider.js";

globalThis.React = React;

const schemas = new Map([[EXTRACTED_CARD_TYPE, PdfSchema]]);
const CARD_PATH = `inbox/Handbook.${EXTRACTED_CARD_TYPE}.card`;

/** Parse a card the way the backend does, then read it the way the view does. */
function readCard(text) {
  const fields = parseCardText(text, { source: CARD_PATH, schemas }).fields;
  return readExtractedFields(isRecord(fields) ? fields : {});
}

const ANALYZED = `---
status: analyzed
format: pdf
filename:
  ref: attach/source.pdf
  captured: 2026-08-20T14:00:00Z
  source: scanner
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
function render(element) {
  return renderToStaticMarkup(React.createElement(LightboxProvider, null, element));
}
```

## Reading the frontmatter

Everything the header shows comes from one tolerant read of the frontmatter —
nested `filename:`/`metadata:` entries included, and a missing entry is `null`
rather than a crash in a renderer.

```ts
const fields = readCard(ANALYZED);
[fields.title, fields.author, String(fields.pages), fields.format].join(" | ")
=> Employee Handbook | Wren Aldana | 12 | pdf

[fields.originalRef, fields.originalName, fields.source].join(" | ")
=> attach/source.pdf | handbook-2026.pdf | scanner

[String(fields.error), String(fields.status), fields.description].join(" | ")
=> null | analyzed | The 2026 handbook, scanned.
```

The `docling:` ref is read too — it is what the view needs to label page
boundaries in the extracted text (`lib/docling-match.ts`):

```ts continue
fields.doclingRef
=> attach/docling.json.gz
```

A card with nothing optional filled in reads as nulls, not as `undefined`
leaking into the markup:

```ts
const bare = readCard(`---
status: analyzed
format: pdf
filename:
  ref: attach/source.pdf
  captured: 2026-08-20T14:00:00Z
  source: scanner
---
`);
[String(bare.title), String(bare.author), String(bare.pages), String(bare.description)].join(" ")
=> null null null null

String(bare.doclingRef)
=> null
```

## Page renders come out of the attach listing

Page images aren't referenced from the body — only the extractor's naming
convention says which files they are. The derivation filters a `status.browse`
listing to `page-NNN.avif` and sorts numerically, so page 10 lands after page 2
rather than between 1 and 2.

```ts
const listing = {
  files: [
    { name: "source.pdf", relativePath: "inbox/Handbook.attach/source.pdf" },
    { name: "page-010.avif", relativePath: "inbox/Handbook.attach/page-010.avif" },
    { name: "figure-001.avif", relativePath: "inbox/Handbook.attach/figure-001.avif" },
    { name: "page-002.avif", relativePath: "inbox/Handbook.attach/page-002.avif" },
    { name: "page-001.avif", relativePath: "inbox/Handbook.attach/page-001.avif" },
  ],
};
const pages = pageRendersFrom(listing.files, (p) => `/test/api/image/${p}`);
pages.map((p) => p.page).join(",")
=> 1,2,10

pages[0].src
=> /test/api/image/inbox/Handbook.attach/page-001.avif
```

A card whose extraction never produced page renders yields an empty list, and
the strip renders nothing at all rather than an empty scroller:

```ts
pageRendersFrom([{ name: "source.pdf", relativePath: "inbox/Handbook.attach/source.pdf" }], (p) => p).length
=> 0

render(React.createElement(PdfPageStrip, { pages: [], activePage: null }))
=>
```

## A card claiming pages that the attach listing didn't produce gets a notice

`missingPageRenders` is the predicate behind `PdfCardView`'s muted notice: a
card that says pages were extracted, whose attach-scope listing finished
without error, but came back with none.

```ts
const analyzedWithPages = { status: "analyzed", pages: 12 };

missingPageRenders({ fields: analyzedWithPages, pages: [], pagesLoading: false, pagesErrored: false })
=> true
```

Still loading, or the listing errored: no notice yet — those get their own
state, not a false "missing" claim.

```ts continue
missingPageRenders({ fields: analyzedWithPages, pages: [], pagesLoading: true, pagesErrored: false })
=> false

missingPageRenders({ fields: analyzedWithPages, pages: [], pagesLoading: false, pagesErrored: true })
=> false
```

Renders are actually present: no notice.

```ts continue
missingPageRenders({
  fields: analyzedWithPages,
  pages: [{ page: 1, src: "/x" }],
  pagesLoading: false,
  pagesErrored: false,
})
=> false
```

A card that never claimed to have pages — `metadata.pages` absent, or a
pre-extraction / non-analyzed card — stays silent even with zero renders:

```ts
missingPageRenders({ fields: { status: "analyzed", pages: null }, pages: [], pagesLoading: false, pagesErrored: false })
=> false

missingPageRenders({ fields: { status: "new", pages: 12 }, pages: [], pagesLoading: false, pagesErrored: false })
=> false

missingPageRenders({ fields: { status: "analyzed", pages: 0 }, pages: [], pagesLoading: false, pagesErrored: false })
=> false
```

## `?page=3` highlights and anchors that page

```ts
[String(requestedPage({ page: "3" })), String(requestedPage({})), String(requestedPage({ page: "later" }))].join(" ")
=> 3 null null
```

The requested page gets a ring; the others don't. Each thumbnail also carries a
`page-N` id, so a `#page-3` link lands on it.

```ts
const pages = [1, 2, 3].map((page) => ({ page, src: `/test/api/image/page-00${page}.avif` }));
const html = render(React.createElement(PdfPageStrip, { pages, activePage: 3 }));

html.split("ring-2 ring-accent").length - 1
=> 1

html.includes('id="page-3" data-page="3" class="flex-shrink-0 flex flex-col items-center gap-1 p-1 rounded ring-2 ring-accent"')
=> true

// Every page is present, alt-texted, and captioned.
[html.includes('alt="Page 1"'), html.includes('alt="Page 3"'), html.includes("Page 2</span>")].join(" ")
=> true true true
```

## Status notices

A failed extraction is the case the generic card renderer hid: `status: new`
with an `error:`. The banner quotes the error and names the command that
re-runs extraction on this card.

```ts
const failed = readCard(`---
status: new
format: pdf
filename:
  ref: attach/source.pdf
  captured: 2026-08-20T14:00:00Z
  source: scanner
error: docling exited 1 — no text layer found
---
`);
const html = renderToStaticMarkup(React.createElement(PdfStatusNotice, {
  status: failed.status,
  error: failed.error,
  hasBody: false,
  cardPath: CARD_PATH,
}));

html.includes("Text extraction failed")
=> true

html.includes("docling exited 1 — no text layer found")
=> true

html.includes(`cb pdf reanalyze ${CARD_PATH}`)
=> true
```

`invalid` is a judgement someone made, and an `analyzed` card with an empty body
is a real answer ("no readable text"), not a failure — each gets a muted notice
instead of the warning banner. A normal analyzed card with text gets no notice.

```ts
function notice(props) {
  return renderToStaticMarkup(React.createElement(PdfStatusNotice, { error: null, cardPath: CARD_PATH, ...props }));
}

notice({ status: "invalid", hasBody: false }).includes("marked unusable")
=> true

notice({ status: "analyzed", hasBody: false }).includes("No readable text")
=> true

notice({ status: "analyzed", hasBody: true })
=>
```
