---
name: bbx-guide-schemas
description: Use when creating or changing beebox card types, schema fields, or schema instructions. Changes to existing cards may also need bbx-migration.
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

- **Every schema silently gets seven optional global fields** —
  `title`, `contains`, `contains-evidence`, `todos`, `symbol`, and
  `prominence`, and `theme` (`GLOBAL_CARD_FIELDS`, `src/cards/schema.ts`).
  `contains` is the prime retrieval field (search boosts it 3×) — a
  card type whose writers never populate it is invisible to search.
  `contains-evidence` is the detail `contains` was derived from
  (uncapped, not searched, not embedded — not a second summary).
  `todos` is the frontmatter counterpart to the `{% todo %}` tag.
  `symbol` is the card's mark (`{ glyph, src, foreground, background }`)
  — most cards have none. `prominence` (`entry-point` | `primary` |
  `background`) says whether the box should surface this card to a
  reader looking around — absent means the type's default level
  (`src/shared/prominence.ts`; `cardSchema`'s own `prominence` option
  sets it per type, and `category: "system"` implies `background`).
  `theme: { name, stock? }` selects presentation independently of the view;
  `cardSchema`'s own `theme` option sets the type preference.
  Don't redeclare any of these — a schema's own declaration silently
  wins.
- Cards also accept an optional catalog-validated `theme: {name, stock?}`
  presentation choice. It is independent of the preferred view; read
  `node_modules/beebox/box-docs/card-themes.md` before setting a schema theme
  preference or advising on a card override.
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
