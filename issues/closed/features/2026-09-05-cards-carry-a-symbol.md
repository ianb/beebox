---
title: "Cards carry a `symbol` — one mark beside the title, and landmarks stop being the special case"
workstream: sidecar-shell
area: beebox
needs: [design]
labels: [cards, ui]
filed-by: agent
discovered-by: Ian
discovered-in: "worktree-sidecar-shell — boxholder direction after the pinned-tab work"
priority: normal
resolution: implemented
---

**Closed 2026-09-05** by `a706e09a9` and follow-ups on `worktree-sidecar-shell`
(see `beebox/docs/implemented-plans/card-symbol.md`): `symbol` is now a
GLOBAL_CARD_FIELDS group (`glyph`/`src`/`foreground`/`background`), drawn by
one component (`CardMark`), with landmarks folded onto it via the
`landmark-symbol` migration. No divergence from the design questions above —
all were answered in the plan (image `src` included, contrary to the
original "text only, for now").

A card has no mark. A landmark does — `navigation.symbol` (`beebox/docs/landmarks.md`)
— and it is the only card type that does, which is the wrong shape: the mark is
a property of a card, not of one schema. The ask: **standard frontmatter
`symbol` on every card**, with landmarks reading the same field rather than
carrying their own.

Boxholder decisions, already made:

- **The field is `symbol`.** Not `favicon` — the mark appears in tab strips,
  browse rows, file chips and the place menu, and a browser word imports the
  wrong metaphor. It is also the name landmarks already use, so this unifies a
  vocabulary instead of adding a second one.
- **Text only, for now** — an emoji, typically. No SVG and no image ref in this
  round.
- **Optional colouring**, as two sibling fields: `symbolForeground` and
  `symbolBackground`. Any valid CSS colour is allowed; `hsl()` is the preferred
  spelling because it is the easiest to reason about. The background renders as
  a circle or a heavily-rounded rectangle behind the mark. Foreground does
  nothing to most emoji — accepted. A rendered surface honours both; a page
  title drops them and keeps the character. This is the reason the mark stays
  text: a `<title>` can carry an emoji and cannot carry an SVG.
- **Landmarks are not a special case.** `navigation.symbol` folds into the
  standard field, which means the landmark schema loses its own copy and every
  landmark card keeps its mark through a migration
  (`symbolSrc`, the image form, is a separate question this does not settle).

## What the design still has to answer

- **How free-form colour sits beside the semantic palette.** The decision is
  "any valid CSS colour", which the app's own components do not use — they take
  tones from `beebox/src/frontend/tailwind.config.js`. The design has to say
  how an arbitrary `symbolBackground` renders without dragging a second colour
  system into every surface, and what a symbol with no colours falls back to.
- **Which surfaces draw it, through what one component.** The pinned sidecar
  tab is the prompt for this (a compact pinned tab has room for a mark and not
  much else — see the closed
  [pin-a-sidecar-tab](2026-08-30-pin-a-sidecar-tab.md)), but
  browse rows, recent files, the place menu, and chat file chips all want the
  same mark. One renderer, or the mark drifts.
- **Abbreviation, and what a pinned tab shows.** The boxholder's call
  (2026-09-05): a symbol that is unambiguous among the pinned tabs stands in
  for the title entirely, browser-pinned-tab style. When it is ambiguous — or
  when a title does not fit — the tab abbreviates the title instead of dropping
  it. So the design owes two rules: what "abbreviate" means (initials, first
  word, truncation), and how a tab decides it is ambiguous without the answer
  flickering as other tabs open and close.
- **Where the mark comes from, for a surface that has no card data.** The
  sidecar strip holds a path and a string, and only an activated tab fetches its
  card — so a pinned tab restored from storage has no title and no symbol. That
  is the same gap as
  [sidecar-tab-label-never-updates](../bugs/2026-09-05-sidecar-tab-label-never-updates.md),
  and both want one answer: a batch lookup of identity (title + symbol) for a
  set of paths, invalidated on `file-change`.
- **Who authors it.** Agents write most cards. A standard field is worth having
  only if the agent guide and the schema instructions say when to set one and
  when to leave it empty — a box where every card has a different emoji is
  noise, not navigation.
- **Migration.** The field itself is additive (old cards load unchanged), so
  only the landmark fold needs one: move `navigation.symbol` up to the card's
  own `symbol`, per `bbx-migration`.
