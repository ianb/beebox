---
name: bbx-guide-schemas
description: Use when creating or changing beebox card types, schema fields, or schema instructions. Changes to existing cards may also need bbx-migration.
---

# Card schemas: the model, then the checklist

A guide skill: the mental model and the boundaries. The worked example
and file-by-file checklist live in `beebox/docs/cards/schemas.md`.

A card type is where the box meets a person. Before the field list, write its
situation line ("When …, I want to …, so I can …") and the surface where the
card appears; for a new type, use the bbx-design skill.

## The model

A card type is a Zod-based `cardSchema(type, { fields, instructions? })`
in `src/schemas/`, registered in `src/schemas.ts` (boxes can add local
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
  `cardSchema`'s own `theme` option sets the type preference (read
  `node_modules/beebox/box-docs/card-themes.md` before setting one).
  Don't redeclare any of these, except `title: z.string()` to require
  a title. The UI shows `title` in the header, `todos` on the front, the
  other four under Properties "Found by", and `theme` as its "Appearance"
  row; type fields go under Properties "Fields" for a type with a body
  field, on the front otherwise.
- **Every new field needs a named reader** (a query, a UI surface, or code),
  and some names are banned: `status`, `created`, `summary`, `date`,
  `modified`, `source`, plus the global names. A registry test rejects them
  on built-in schemas; box-local ones get a health warning. The rules and
  the alternatives are in `docs/cards/schemas.md` ("Adding a field").
- **A type owns its summary.** `cardSchema`'s `summarize(card, base)` hook
  decides how the type appears in lists (todo list headers, recent files,
  `bbx query` text). `card` is typed from the schema's own fields and the hook
  runs only on a validated card; spread `base` and add `detail`/`attrs`, or
  replace it. The React list component is a separate registry: it lives beside
  the schema as `src/schemas/<type>/list-entry.tsx`, is registered from
  `src/frontend/src/file-types/builtins.tsx`, types its props with
  `SummaryAttrs<typeof XSchema>`, and reaches schema/core/cards code by
  `import type` only (lint-enforced). See `docs/cards/schemas.md`.
- **`instructions` prose is injected into agent context** when an agent
  processes cards of that type — it's prompt surface (see
  `docs/prompts/review.md` before writing more than a couple of
  lines).
- **Reserialization reorders frontmatter keys** to the schema's declared
  field order; a one-field mutation rewrites the whole block.
- Templates: new types that ship to boxes need template entries
  (`src/templates/builtins/templates.ts`) and regenerate into boxes via
  `bbx engine init`.

## The migration boundary

Purely additive (new type; new optional field old cards still satisfy) →
no migration, this skill + the checklist suffice. Anything existing
boxes already hold — rename/remove a field, change type/format/
extension, split/merge fields, move data between cards — **invoke
bbx-migration**; that's a data migration even when the diff only touches
a schema. New agent-facing conventions also want a knowledge-audit entry
(`docs/testing/knowledge-audits.md`).
