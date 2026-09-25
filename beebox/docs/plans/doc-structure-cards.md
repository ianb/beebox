---
title: "Documentation structured like code: cards"
status: active
workstream: doc-structure
issues: []
---
# Documentation structured like code: cards

Fifth cluster under the [organizing principles](../README.md#organizing-principles):
the card file format, the schema workflow, validation, and migrations become
members of one `cards` subject. The pages were already one file per member;
what this cluster fixes is three statements that disagree with the code.

**Issues addressed:** none filed.

## Smallest fix and budget

Smallest fix: correct the three stale statements in place. Chosen: parent
plus four members, about 1,200 lines moved, ~60 rewritten, a frozen report
for the 2026-05 rollout history, one manifest allowlist line, about 100
hand-repaired references (the migrations page alone has 48 inbound).

## Stated preferences this plan trades against

The principles as written.

## What already exists

The pilot's tooling; flat publish paths.

## Prior art (external)

None needed.

## Ontology

Members in the code's names: format (`src/cards/`, `src/core/card-io.ts`),
schemas (`src/schemas/`, `cardSchema()`), validation (`bbx validate`,
`src/core/card-lint.ts`, the hooks), migrations (`src/core/migrations.ts`,
`scripts/migrate/`).

## Tracks / scope

Stale facts found by reading against the code (2026-09-25), fixed in chunk 2:

| Page | Says | Code |
|---|---|---|
| cards-as-markdown.md "Format" | every schema gets `title` and `contains` for free | `GLOBAL_CARD_FIELDS` (`src/cards/schema.ts:101-107`): seven fields, as adding-schemas.md already says |
| adding-schemas.md "Files to Touch" | "The `type` field in YAML is the discriminator — the loader uses it to look up the schema. Templates must emit it." | `card-io.ts:101`: the filename is the discriminator; a `type:` field must match if present |
| adding-schemas.md intro, step 2, "How Agent Discovery Works" | the XML schema form is "still used by capture-session"; `registry.ts` has a `schemas[]` list; `generateDocs` reads "both `schemas` (XML) and `cardSchemas`" | `capture-session.tsx:72` uses `cardSchema()`; no `schemas[]`; `docs-gen` reads `cardSchemas` only |
| adding-schemas.md "Verification Checklist" | `npm run typecheck` | the repo uses pnpm |

Target tree:

| Old | New |
|---|---|
| (new) | `cards.md`: what a card is; members; owned elsewhere (box layout, the box-facing card docs, the schemas agent file) |
| `cards-as-markdown.md` | `cards/format.md` |
| `adding-schemas.md` | `cards/schemas.md` |
| `card-validation.md` | `cards/validation.md` |
| `migrations.md` (current parts) | `cards/migrations.md` |
| `migrations.md` "Production rollout history" and the two retired migrators | `reports/migration-rollout-2026-05-23.md` |

## Could this be simpler?

Fix the three facts and stop. The directory is the walkable name.

## Subplans

none.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Fact dropped in the move | section-hash check | zero missing before commit | clear |
| The 48 migration links and code comments cite old paths | no | repo-wide sed then grep | clear once grepped |

## Agent-flow / user-flow edge cases

Stale ref: `doc-check`. Hand-edit drift: periodic review.

## NOT in scope

`box-layout.md` (its own subject), `docs/box/` card docs (box-facing),
`src/schemas/CLAUDE.md` (agent file), the media pages (next cluster).

## Open design questions

none.

## Knowledge audits

Skipped: nothing box-loaded changes.

## What will hold this after it ships

`doc-check`; periodic review.

## Implementation order

Before-run (done); chunk 1 moves; chunk 2 rewrite; after-run; Codex review.

## Rollout shape

Questions (pilot protocol):

| # | Question | Key string |
|---|---|---|
| 1 | Where does a card's type come from; what if filename and frontmatter disagree? | `typeFromFilename` |
| 2 | Which frontmatter fields does every schema get automatically? | `GLOBAL_CARD_FIELDS` |
| 3 | What must the body field be named; body content on a body-less card? | `body(` |
| 4 | What does the `attach/` ref prefix mean; which two lint rules? | `attach-lint` |
| 5 | The exception to root-relative refs; what `..` resolves to? | `fail closed` |
| 6 | Where does a schema's `instructions` doc land, built-in vs box-local? | `card-<type>.md` |
| 7 | What does `templateMerge.boxOwnedFields` change? | `boxOwnedFields` |
| 8 | Read-only migration status options and result? | `--status --json` |
| 9 | Drain wait when closing admission; the yielding sweep's wait? | `ten minutes` |
| 10 | What does `bbx validate --canonical --fix` refuse to rewrite? | `ambiguous` |

### Before (2026-09-25)

| # | Found | Steps | Cited | Locations |
|---|---|---|---|---|
| 1 | yes | 2 | cards-as-markdown.md#Format | 2, conflicting (adding-schemas.md says the YAML field) |
| 2 | yes | 3 | cards-as-markdown.md#Format | 2, conflicting (two fields vs seven); the navigator returned the wrong one |
| 3 | yes | 3 | cards-as-markdown.md#Format | 1 |
| 4 | yes | 4 | cards-as-markdown.md#Attachments | 1 |
| 5 | yes | 3 | cards-as-markdown.md#Refs | 1 |
| 6 | yes | 3 | adding-schemas.md#How Agent Discovery Works | 1 |
| 7 | yes | 3 | adding-schemas.md#templateMerge | 1 |
| 8 | yes | 3 | migrations.md#Applying and inspecting | 1 |
| 9 | yes | 3 | migrations.md#Admission | 1 |
| 10 | yes | 3 | card-validation.md#Canonical ref form | 1 |
