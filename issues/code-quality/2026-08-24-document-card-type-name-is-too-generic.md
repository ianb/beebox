---
title: "`.document.card` and `.doc.card` are indistinguishable names for unrelated types"
workstream: document-card-view
area: callback-box
needs: [decision]
labels: [cards, naming, schemas]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder did not recognize `.document.card` as a real type
---

Two card types, near-synonymous names, unrelated purposes:

- **`.doc.card`** (`schemas/doc.tsx`) — a generic in-box document: `title` plus a
  markdown body. The default for agent-authored prose instead of a plain `.md`.
- **`.document.card`** (`schemas/document.ts`) — an *extracted* document: the
  rendered text of a PDF as the body, with the original bytes, page renders, and
  figures in the attach scope. Written by `cb scan-import`'s PDF branch.

Nothing in either name distinguishes them. "doc" and "document" are the same
word.

## Observed, not hypothesized

On a deployed box the two sit **in the same directory**:

```
store/school/grs/10th_Grade_Itasca_Packing_List.doc.card
store/school/grs/Family_Student_Handbook_2025-26.document.card
```

The boxholder — who owns the box — did not recognize `.document.card` as a real
type when shown one, and guessed it might be "the name for a pdf or something".
If the person who runs the system cannot tell the two apart from a listing, an
agent choosing which to write is guessing too.

## Why the name was chosen, and why that reasoning has weakened

`schemas/document.ts:13` explains it:

> The type is deliberately `document`, not `pdf`: `format:` carries the source
> type, so a non-PDF input needs no rename migration.

Avoiding a future rename migration is sound. But the cost landed elsewhere: the
name now collides with an existing type, which is the more expensive kind of
confusion. The `format:` field still does its job under any name.

## What to decide

The deliverable here is a naming call, not a build:

- **Rename the extracted type.** `extracted`, `scanned`, `source-document`,
  `imported` — something that names *how it came to be*, since that is what
  actually distinguishes it. Keeps `format:` and its no-migration property.
- **Rename the generic one.** `doc` → `note`, `page`, or `prose`. Riskier: it is
  the recommended default for agent-authored prose and is presumably far more
  numerous, so this is the bigger migration.
- **Leave both and disambiguate elsewhere** (list UI, icons, docs). Cheapest,
  and the weakest — the filename is what an agent sees when choosing, and what a
  human reads in a directory.

Whichever way, **a rename is a real migration**: files on disk, refs pointing at
them, the schema registry, generated docs, and any box-local content. Count the
instances first — on the box inspected there was exactly one `.document.card`
against four `.doc.card`, so the extracted type is currently the cheap one to
move.

## Related

[PDFs and document cards have no real view](../features/2026-08-23-pdf-and-document-cards-have-no-real-view.md)
— the same type, viewed rather than named. Worth settling the name before
building a viewer that hardcodes it.

## Decision (2026-08-24)

Renamed the extracted type to `pdf` (`*.pdf.card`) — the first option
sketched above ("rename the extracted type"). Reasoning:

- The pipeline reads only PDFs today; a docx/html extractor would be a
  different pipeline step, not this one wearing a different `format:` value.
  It can earn its own type name if and when it exists.
- `pdf` parallels the naming already in use for wrapped-file types:
  `image.card` (wrapped file + extracted content — description, EXIF) and
  `file.card` (wrapped file, opaque). `pdf.card` fits the same pattern:
  wrapped file + extracted content (rendered text, page renders, docling
  JSON).
- It no longer collides with `doc.card`, which was the actual complaint.

`format:` is kept on the schema (still records the source type, still costs
nothing), even though the no-future-rename rationale that originally motivated
the generic name is what this decision walks back.

Implemented via `scripts/migrate/document-to-pdf.ts` (registered as
`document-to-pdf` in `src/core/migrations.ts`); see
`issues/code-quality/2026-08-24-remove-document-card-legacy-tolerance.md` for
the migration follow-up.
