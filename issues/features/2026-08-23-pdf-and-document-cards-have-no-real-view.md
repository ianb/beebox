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

## The `document` card has no view at all — but check the premise first

`document` is a real registered card type (`src/schemas/document.ts`,
`registry.ts:121`). It is **not** what a general PDF upload produces. It is
written by the **scanner import** path only — `scan-import-document.ts:61`,
whose output shape is:

```
<sessionAttach>/source.document.card
  + source.attach/{source.pdf, docling.json.gz, page-NNN.avif, figure-NNN.avif}
```

So it carries docling's extraction, page renders, and figures, and it exists
because someone fed paper through a scanner. `docs/plans/pdf-intake-design.md`
describes a broader intake (`cb import`, capture endpoint, email connector); its
`status: partial` is doing real work — the scan branch is what got built.

**Nothing renders it.** No renderer registers `rendersCardTypes` for `document`;
the schema ships no view. `file-types/builtins.tsx:48` registers only a *list
icon*. So the card falls through to generic rendering and the extracted
structure — pages, tables, figures — is never used.

**Scope honestly.** Zero exist in any local box; a deployed box was found to
have **exactly one** (alongside 4 `.doc.card`, 1 `.gdoc.card`, 3 loose `.pdf`).
So this is the scanner's output, at a rate of one, not the common PDF path.

**And it is invisible by construction**, which is the more interesting finding.
The card is written *inside an attach scope*
(`<sessionAttach>/source.document.card` — `scan-import.ts`), so it does not
appear in ordinary directory browsing; it has no renderer; and
`file-types/builtins.tsx:48` gives it only a list icon. The boxholder did not
recognize the type at all when asked — a fair reaction to a card that the
system produces, stores, and never shows.

That reframes the fix: the question is not "does the `document` view look good"
but "should this pipeline produce an artifact nobody can reach".

**The one real instance, traced (2026-08-24).** A 20-page school handbook PDF,
`source: drive` (not a physical scanner — `scan-import` names the command, not
the hardware), captured 2026-08-04 and extracted a minute later
(`Created-By: document-reanalyze`). Its attach scope holds `source.pdf`,
`page-001…020.avif`, and `figure-001…015.avif`. **Every one of those page and
figure renders exists today and nothing displays any of them** — which is the
whole argument for the view in one example.

Settle [the type's name](../code-quality/2026-08-24-document-card-type-name-is-too-generic.md)
before building a viewer that hardcodes it.

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
- **What happens for a PDF that never went through the scanner** — which today
  is nearly all of them. The iframe is the fallback either way; it should at
  least be a *good* fallback with a download affordance. This is the case a
  boxholder actually meets, so it likely outranks the `document` view.

## Related, from the same page

The card was opened in the chat companion pane, where **the route to the browse
view is a single unlabeled icon** — `ExternalIconLink` in `FileView.tsx:296`,
sharing a cramped header row with a renderer toggle, card actions, and
open-in-panel. The boxholder's reading of that page was that there was no way to
get to browse at all, only the landmark menu's Recent files. Whether that is a
labelling problem or a layout one is worth a look while in this area; it is the
same family as
[no visible search box and no home surface](2026-08-08-no-visible-search-or-home.md).
