---
title: "Cards carry a `symbol` — one mark beside the title, and landmarks stop being the special case"
workstream: unattached
area: beebox
needs: [design]
labels: [cards, ui]
filed-by: agent
discovered-by: Ian
discovered-in: "worktree-sidecar-shell — boxholder direction after the pinned-tab work"
priority: normal
---

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
- **Optional colouring**, foreground and background, as part of the value. A
  rendered surface honours it; a page title drops it and keeps the character.
  This is the reason the mark stays text: a `<title>` can carry an emoji and
  cannot carry an SVG.
- **Landmarks are not a special case.** `navigation.symbol` folds into the
  standard field, which means the landmark schema loses its own copy and every
  landmark card keeps its mark through a migration
  (`symbolSrc`, the image form, is a separate question this does not settle).

## What the design still has to answer

- **The value's shape.** A bare string (`symbol: 🍳`) must keep working, so a
  coloured symbol needs a second form — an object (`symbol: { text: "🍳", fg:
  "…", bg: "…" }`), or a sibling field. Whichever is chosen, one parse helper
  owns reading both, and the colour vocabulary should be the semantic palette
  (`beebox/src/frontend/tailwind.config.js`), not free-form hex, or the box
  acquires a second colour system.
- **Which surfaces draw it, through what one component.** The pinned sidecar
  tab is the prompt for this (a compact pinned tab has room for a mark and not
  much else — see the closed
  [pin-a-sidecar-tab](../closed/features/2026-08-30-pin-a-sidecar-tab.md)), but
  browse rows, recent files, the place menu, and chat file chips all want the
  same mark. One renderer, or the mark drifts.
- **The fallback when a card has no symbol.** The pinned tab needs *something*;
  initials from the title are the obvious answer. Note the rejected variant: a
  mark that changes because another tab happens to share it makes a card's
  identity depend on what else is open. Keep the mark stable and let position
  and the tooltip disambiguate.
- **Who authors it.** Agents write most cards. A standard field is worth having
  only if the agent guide and the schema instructions say when to set one and
  when to leave it empty — a box where every card has a different emoji is
  noise, not navigation.
- **Migration.** The field itself is additive (old cards load unchanged), so
  only the landmark fold needs one: move `navigation.symbol` up to the card's
  own `symbol`, per `bbx-migration`.
