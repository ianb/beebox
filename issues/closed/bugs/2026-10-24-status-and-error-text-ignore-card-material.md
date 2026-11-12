---
title: "Loading and error text in card views keep app colours on dark cards"
workstream: card-ink-dark-themes
area: beebox
labels: [themes]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-frontend — cross-model review (codex gpt-6-sol) of the place-page ink fix
resolution: implemented
---

**Closed (implemented, 2026-11-12):** Landed on worktree-card-ink-dark-themes (26ac8d2d0, c45a8f3f2): card-front status/error/caption/inline-action text follows the card material; error uses each theme's --bbx-danger.

`StatusMessage` ("Loading place…", "Loading figure…", "Loading PDF…") and
`ErrorText` use fixed app colours (`text-warm-700`, the danger red). In a card
view under a dark card theme (Gilt, Deck, Night atlas, Gold thread, Phosphor,
Tempest) the text is faint: grey or red on dark teal or navy. `Text`, `Hint`
and `Button` read `MaterialContext` and take the card's ink. These two
primitives do not, and neither does `InlineAction` unless a caller passes
`material` (for example "Retry" beside an error).

Seen on the place page (`components/PlaceView/view.tsx`: the loading state,
the query error with its Retry, the unreadable-landmark and two-landmarks
errors). The same primitives render in other card renderers, so the gap is
wider than one page.

Tension: making `StatusMessage` follow the material is direct (`text-card-soft`).
Error text needs a decision: card ink loses the red that marks an error, while
the app red is too faint on a dark card. Changing `InlineAction` to follow
the material by default would recolour about 20 call sites, including the
emphatic intent (app purple to the card's pen colour).
