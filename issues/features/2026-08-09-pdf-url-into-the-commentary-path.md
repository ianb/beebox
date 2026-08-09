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

**Clerk can't *read* one.** `commentBlockedReason`
(`callback-clerk/src/domain/commentary.ts:51-67`) documents it: the capture
content script only runs on http(s) pages, so browser-internal pages — and
**"PDFs in the viewer"** explicitly — are out. Chrome's built-in PDF viewer
isn't a readable DOM page, so any design that starts "have Clerk scrape the
rendered PDF" is dead on arrival. **Fetching the file is a different question**
and is not blocked — see the fix below.

**The document path has no URL door.** Everything that creates a `document`
card starts from local bytes — `document-extract.ts`, `scan-import.ts`,
`scan-import-document.ts`, `document-reanalyze.ts`. A search for a
fetch-a-URL-then-extract path finds nothing. So today the only route is: save
the PDF by hand, then upload it.

## The shape of the fix (undecided)

**Clerk should hand over the bytes, not the URL.** A server-side fetch cannot
see the user's session, so it fails on anything behind a login — a paywalled
journal, a university proxy, an intranet doc. That's a large share of the papers
worth capturing.

Clerk *can* get those bytes. The viewer limitation above governs the **content
script** reading a rendered page; it does not constrain a fetch from the
extension's own context. Clerk already has every piece:

- `optional_host_permissions: ["http://*/*", "https://*/*"]`, granted per-origin
  when the user enables a box rather than broadly at install
  (`callback-clerk/wxt.config.ts:34-36`), plus `activeTab` — and a click on the
  popup is the user gesture that activates it for the current tab.
- Credentialed fetch is already the house pattern:
  `callback-clerk/src/platform/clerk-api.ts:36` does
  `fetch(url, { credentials: "include" })`.

So: user clicks in the popup on a PDF tab → the extension fetches that URL with
the session's cookies → uploads the bytes to the box → the server runs the
existing docling extraction. Public and gated PDFs take the same path, and
nothing has to read the viewer.

Open questions:

- **Which upload route.** The box already has capture and bulk-upload routes;
  does one of them take an arbitrary binary with a filename and content type, or
  is a new one needed? Papers run to several MB — check the size limits.
- **Where the extraction fires.** On upload automatically, or as a follow-up
  (`cb document`-shaped) step? Docling on a large PDF isn't instant, so the
  upload response probably shouldn't wait on it.
- **Non-PDF URLs.** What happens when the user triggers this on something that
  isn't a PDF — refuse, or let `format:` carry whatever it is?
- **The Clerk affordance.** Commenting is currently *disabled with a reason* on
  PDF tabs, and the popup deliberately shows a disabled button with an
  explanation rather than hiding it. A "send to box" action for exactly this
  case fits that existing pattern.
- **Permission friction.** Fetching a PDF from a host the user hasn't enabled a
  box on may prompt for that origin. Worth knowing whether `activeTab` alone
  covers the click-driven case, which would avoid the prompt entirely.

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
