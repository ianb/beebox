---
title: "Cards need one provenance field — there are already four spellings of it"
workstream: unknown
area: beebox
needs: [decision, design]
labels: [schemas, provenance]
---

A card that came from somewhere should say where, in a shape anything can read
— so that downloading a paper, freezing a page, or importing a doc all leave the
same trail. The immediate motivation is
[bringing a PDF at a URL into the box](../features/2026-08-09-pdf-url-into-the-commentary-path.md):
an ingested document should record the URL it came from.

The catch: this field already exists, **four times, in four shapes.**

## What's there now

| Shape | Where | Form |
|---|---|---|
| Bare URL string | `webpage.tsx:26` | `source: z.string()` (required) — "the original page URL" |
| **Typed object** | `recipe.tsx` (`RecipeSource`) | at least one of `label` (freeform, e.g. a person), `href` (external URL), `ref` (a card, e.g. a frozen `*.webpage.card`) |
| Provenance entry | `document.ts` / `file.tsx` | a `filename:` entry carrying ref / captured / source / original-name / mime-type / size |
| Ad-hoc names | `gdoc`/`gsheet` (`link`), `email-message` (`from`), `extfile` (`href`), `image` (`from` + `source`) | one-off per schema |

`source:` appears in ~20 schemas, but **not as a shared field** — each schema
declares its own, which is why the meaning drifted. There's no common-field
mechanism in `cardSchema` to hang it on.

## The decision

**Adding `original: { href }` as a fifth spelling would make this worse.** The
real question is which existing shape wins:

- **`recipe`'s typed source is the strongest candidate.** It already models the
  three cases that actually occur — a human-readable label, an external URL, and
  a ref to an in-box card — and it's typed so a consumer can render a link, a
  ref, or a plain name without guessing. Generalizing `RecipeSource` into a
  shared `CardSource` and standardizing `source:` on it would consolidate rather
  than add.
- Against that: `webpage.source` is a required bare string today, and changing
  its shape is a **data migration** across every existing card (bbx-migration
  territory, not a schema-only change). `document`/`file`'s `filename:` entry is
  richer still and may want to stay distinct — it carries mime-type and size,
  which aren't provenance.

## Open questions

- **Which cards get it?** Not all — a memo the user typed, a todo, a job card
  have no origin. It should be optional, and "every card" is probably the wrong
  framing. But it should be *available* to any schema rather than re-declared.
- **Is a shared-field mechanism needed first?** With none in `cardSchema`, every
  schema declaring its own is exactly how four spellings happened. Standardizing
  the shape without a shared place to put it may just produce four copies of the
  same definition.
- **What does it point at for a downloaded file?** The fetch URL, the landing
  page, both? For a PDF fetched from a publisher, the direct file URL and the
  article page are different things and both are useful.
- **Migration cost.** Changing `webpage.source` from string to object touches
  every webpage card in every box. An additive alternative (leave `source:`
  alone, standardize new usage) avoids that but leaves the drift in place —
  which is the "consolidate over blast-radius fear" trade-off to make
  deliberately, not by default.

## Related

- [PDF at a URL into the commentary path](../features/2026-08-09-pdf-url-into-the-commentary-path.md)
  — the case that surfaced this; an ingested paper wants to record its origin.
- `docs/adding-schemas.md` — where a shared field would need documenting.
- `bbx-migration` skill — any change to an existing card's on-disk shape.
