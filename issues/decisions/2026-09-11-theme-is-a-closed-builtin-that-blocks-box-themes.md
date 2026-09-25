---
title: "`theme:` is a closed built-in field, so a box cannot define its own theme — and a box-local schema that names it loses with a misleading error"
workstream: unattached
area: beebox
priority: normal
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: main session — a box's own site schemas declared `theme` and every card failed validation; "we're definitely going to have open values for theme soon"
---

`theme:` is validated on **every** card by the built-in lint, independent of
that card's schema: `core/card-lint.ts:246-248` calls `validateThemeChoice`
(`shared/card-theme.ts`), which requires an object `{ name, stock? }`, resolves
`name` against the hard-coded `THEME_CATALOG` (`plain`, `spectrum`, `paper`,
`post-it`), and resolves `stock` against that theme's own stock list.

Two consequences, and the second is the one that matters going forward.

## A box-local schema that names `theme` loses, confusingly

A box wrote its own site-page/site-doc schemas declaring
`theme: z.enum(["plain", "paper", "post-it"])` — a bare string — and authored
cards as `theme: paper` with a sibling `stock: manila`. Every one of those cards
failed with:

> `error: theme must be an object with a string name and optional string stock`

The message describes the built-in's expected shape and never says that the
field is reserved, that the box's own schema disagrees, or that the box's
declaration cannot win. The box author's reasonable reading is "my schema is
wrong," when in fact the field was taken out from under them. They were
unblocked by converting the cards and the schema to the built-in shape, but
that only worked because the values happened to be catalog values.

## The catalog is closed, and it should not stay that way

Boxholder: "we're definitely going to have open values for theme soon."

As written, a box-defined theme is impossible. `descriptor()` looks the name up
in a module-level array; anything else produces "names unknown theme … ;
available themes: …" and silently falls back to `plain`. The same applies to
stocks. So the moment a box authors its own paper stock or a themed surface of
its own, validation rejects it.

## What needs deciding — not yet, deliberately

The boxholder's position is that this wants **runtime validation eventually,
but not now**. Recorded so the decision is made on purpose rather than
discovered by the next box that tries it:

- **Where an open theme comes from.** A box-level theme catalog card? The
  existing card-themes selection rules? Something the box's own schemas can
  extend? This decides whether "open" means unvalidated or validated against a
  box-supplied list.
- **What validation still buys once values are open.** Catching a typo'd theme
  name is genuinely useful; the fallback to `plain` is silent, so a
  misspelling today degrades without complaint. Whatever replaces the closed
  enum should keep that, not drop validation entirely.
- **The reserved-field collision is separable and cheaper.** Even before themes
  open up, the lint could say what is actually wrong: name the field as
  built-in, name the conflicting box-local declaration, and point at the
  expected shape. That is a message change, not a design change, and it would
  have saved the whole investigation this issue came from.

## Related

- `beebox/docs/implemented-plans/card-themes.md` — the theme system as shipped
  (paper, Post-it, plain, with agent-editable selection rules).
