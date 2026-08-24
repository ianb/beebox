---
title: "PDFs get a bare iframe and PDF-derived `document` cards get no view at all — the extracted structure is never shown"
workstream: unattached
area: callback-box
needs: [design]
labels: [ui, pdf, renderers]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder opening a school document from chat
---

> These PDF views are not at all good.

Two gaps sit next to each other, and the second is the surprising one.

## The PDF renderer is 28 lines

`src/frontend/src/renderers/pdf.tsx` is the whole thing: an `<iframe>` pointed at
`/files/<path>`, sized `w-full h-[85vh]`, leaning entirely on the browser's
built-in viewer.

Consequences, none of them handled:

- **`85vh` is viewport-relative, and the PDF is usually not in the viewport.**
  It renders inside the chat companion pane and inside a mobile modal. Sizing to
  85% of the *screen* in a container that is not the screen is wrong nearly
  everywhere it is used.
- **No fallback.** If the browser will not render a PDF inline, the user gets an
  empty box — no download link, no "open externally", no message. iOS/WKWebView
  is exactly this case, and iOS is a shipping surface.
- **No controls of our own** — no page navigation, no "which page am I on", no
  way to link to a page.
- **No integration.** The app has selection anchoring
  (`lib/selection/quote-anchor.ts`, `{% source %}` chips) and figure embeds; an
  iframe of foreign bytes participates in none of it. A PDF is the one document
  type you cannot quote, cite, or comment on.

## The `document` card has no view at all

This is the sharper defect. PDF intake (`docs/plans/pdf-intake-design.md`,
status `partial`) runs docling and produces a **`document` card**
(`src/schemas/document.ts`) carrying extracted markdown, tables, `metadata`
(pages/title/author), page images, and figures as addressable assets.

**Nothing renders any of it.** No renderer registers `rendersCardTypes` for
`document`, and the schema ships no view. So a card built specifically to make a
PDF legible falls through to the generic card rendering — frontmatter plus a
markdown body — and the structure the pipeline worked to extract (pages, tables,
figures) is never used.

So the system extracts a good representation of a PDF and then shows you either
that representation flattened, or the original bytes in an iframe. The one thing
it never shows is the good representation *as* a document.

## What to decide

- **Which is the default view of a PDF-backed card** — the extracted document
  (searchable, quotable, anchorable, cheap on mobile) or the original file
  (faithful, unquotable)? Both need to be reachable; the question is which one
  opens.
- **What a `document` view actually renders.** Page images give a faithful
  scroll; extracted markdown gives selectable text; tables want real table
  rendering. The design doc calls the markdown "faithful-but-lossy … the right
  thing to read", which argues for text-first with the page render available.
- **How a page is addressed.** If a document view exists, `page 3` should be
  linkable, and the existing anchoring work is the natural mechanism.
- **What happens for a PDF that never went through intake** (imported before the
  pipeline, or with no text layer — those route to the photo flow per the design
  doc). The iframe is the fallback either way; it should at least be a *good*
  fallback with a download affordance.

## Related, from the same page

The card was opened in the chat companion pane, where **the route to the browse
view is a single unlabeled icon** — `ExternalIconLink` in `FileView.tsx:296`,
sharing a cramped header row with a renderer toggle, card actions, and
open-in-panel. The boxholder's reading of that page was that there was no way to
get to browse at all, only the landmark menu's Recent files. Whether that is a
labelling problem or a layout one is worth a look while in this area; it is the
same family as
[no visible search box and no home surface](2026-08-08-no-visible-search-or-home.md).
