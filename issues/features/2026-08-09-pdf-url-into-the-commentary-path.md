---
title: "Bring a PDF at a URL into the box as commentable markdown — no path covers it today"
area: callback-box
needs: [design]
labels: [clerk, documents, commentary]
---

Reading a paper on the web (an academic PDF served straight from a university
site, say) there's no way to get it into the box as something commentable. Each
half of the machinery exists; nothing joins them.

## What already works

**PDF → markdown is solved.** The `document` card type
(`src/schemas/document.ts`) is exactly this: docling extraction renders the
markdown as the card **body**, `format:` carries the source type, the original
bytes stay attached, and the canonical `DoclingDocument` JSON is gzipped
alongside (`docling.ref:`). Design in
[pdf-intake-design](../../callback-box/docs/plans/pdf-intake-design.md), as
amended by `scanner-ingest.md`. `cb document reanalyze` re-runs extraction over
the original.

**Capturing a web page is solved.** Clerk captures http(s) pages into `webpage`
cards.

## Why neither reaches a PDF URL

**Clerk structurally can't.** `commentBlockedReason`
(`callback-clerk/src/domain/commentary.ts:51-67`) documents it: the capture
content script only runs on http(s) pages, so browser-internal pages — and
**"PDFs in the viewer"** explicitly — are out. That isn't an oversight to fix in
Clerk; Chrome's built-in PDF viewer isn't a readable DOM page. Any design that
starts "have Clerk read the PDF" is dead on arrival.

**The document path has no URL door.** Everything that creates a `document`
card starts from local bytes — `document-extract.ts`, `scan-import.ts`,
`scan-import-document.ts`, `document-reanalyze.ts`. A search for a
fetch-a-URL-then-extract path finds nothing. So today the only route is: save
the PDF by hand, then upload it.

## The shape of the fix (undecided)

The natural split is **Clerk sends the URL, the server does the work** — Clerk
becomes a trigger, not a capturer, which sidesteps the viewer limitation
entirely and puts docling where it already lives. That implies:

- A server-side "fetch this URL → document card" intake. Open questions: where
  it lives (a `cb` command? an intake route? a connector?), what it does when
  the URL isn't a PDF, size limits, and whether fetching arbitrary URLs
  server-side needs any guard.
- A Clerk affordance that's *enabled* on PDF tabs, where commenting is
  currently disabled with a reason. Note the existing popup deliberately shows
  a disabled button with an explanation rather than hiding it — a "send to box"
  action for exactly this case would fit that pattern.

## The second half: what does commenting on it mean?

Getting a `document` card is not the end. The
[commentary surface](../../callback-box/docs/plans/box-commentary-surface.md)
(partially implemented) is built for files **outside** the box, anchored via
`{% source %}` — but an ingested paper is *inside* the box, as a card body. So
either:

- commenting on it is ordinary in-box card commentary and needs nothing new, or
- the anchored-commentary machinery is what's actually wanted (position- and
  version-anchored notes into a long document), in which case this needs the
  commentary surface's remaining tracks.

**This is the real design question, and it should be settled before any code.**
The answer decides whether this is a small intake feature or a dependency on
finishing the commentary surface.

## Worth noting

Extraction quality on a dense academic PDF — two-column layouts, footnotes,
figures, references — is the thing that decides whether the result is actually
readable or a mess. Worth testing docling against a real paper before committing
to the workflow.
