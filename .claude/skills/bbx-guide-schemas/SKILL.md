---
name: bbx-guide-schemas
description: Explains adding or changing card types (schemas) in beebox — what a schema is, the automatic fields, and the boundary where a change needs a migration. Use when creating a card type, adding/renaming/removing card fields, or writing schema instructions. Triggers include "new card type", "add a schema", "add a field to X cards", "change the card format". Instructional (a bbx-guide-* skill) — worked example in docs/adding-schemas.md; shape changes to existing cards are bbx-migration's territory.
---

# Card schemas: the model, then the checklist

A guide skill: the mental model and the boundaries. The worked example
and file-by-file checklist live in `beebox/docs/adding-schemas.md`.

## The model

A card type is a Zod-based `cardSchema(type, { fields, instructions? })`
in `src/schemas/`, registered in `registry.ts` (boxes can add local
schemas under the package `src/schemas/`, importing `beebox/cards`
— never engine internals). The type comes from the filename
(`Foo.<type>.card`), not a frontmatter field.

Things the schema system does that you'd otherwise miss:

- **Every schema silently gets five optional global fields** —
  `title`, `contains`, `contains-evidence`, `todos`, and `symbol`
  (`GLOBAL_CARD_FIELDS`, `src/cards/schema.ts`). `contains` is the prime
  retrieval field (search boosts it 3×) — a card type whose writers
  never populate it is invisible to search. `contains-evidence` is the
  detail `contains` was derived from (uncapped, not searched, not
  embedded — not a second summary). `todos` is the frontmatter
  counterpart to the `{% todo %}` tag. `symbol` is the card's mark
  (`{ glyph, src, foreground, background }`) — most cards have none.
  Don't redeclare any of these — a schema's own declaration silently
  wins.
- **`instructions` prose is injected into agent context** when an agent
  processes cards of that type — it's prompt surface (see
  `docs/prompt-surface-review.md` before writing more than a couple of
  lines).
- **Reserialization reorders frontmatter keys** to the schema's declared
  field order; a one-field mutation rewrites the whole block.
- Templates: new types that ship to boxes need template entries
  (`src/schemas/templates*.ts`) and regenerate into boxes via `bbx init`.

## The migration boundary

Purely additive (new type; new optional field old cards still satisfy) →
no migration, this skill + the checklist suffice. Anything existing
boxes already hold — rename/remove a field, change type/format/
extension, split/merge fields, move data between cards — **invoke
bbx-migration**; that's a data migration even when the diff only touches
a schema. New agent-facing conventions also want a knowledge-audit entry
(`docs/knowledge-audits.md`).
