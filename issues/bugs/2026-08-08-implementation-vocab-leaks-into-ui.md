---
title: "Implementation vocabulary leaks into first-contact UI and agent replies"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activities 1+2)
labels: [soft-launch, field-test-findings]
---

A first-week user persona collected, verbatim, the words the product showed it
that it could not understand. The list is a map of implementation vocabulary
reaching user-facing surfaces:

- **`store/recipes/Lemon_Chicken_With_Olives.recipe.card`** as the *page
  heading* on two of the three card views (plus "Type: recipe" under it). The
  card has a display title; the filename should not be the headline.
- **"Recipe / Card / Source"** view tabs — "what's the difference between my
  recipe and 'the card'? Isn't the recipe the card?"
- **"No box matches `box` on this server"** — "box" used as concept and name
  in one sentence, plus "server," on an error page with no recovery action.
- Agent replies: **"drop a landmark in `store/recipes/`"**, **"person card"**,
  **"the view can double it"**, **"[→ original recipe.txt: verbatim, from the
  recipe file the boxholder saved]"** — "boxholder" as a third-person label
  for the person being addressed.
- Chrome labels: **"Place: Chat"**, **"Session menu"**, the chip flipping to
  **"box ▸ Card"**.
- **"Open Lemon_Chicken_With_Olives attachments"** — unexplained "attachments"
  on a thing the user thinks of as a recipe.

No single fix; this is a sweep-shaped tension: each surface (card view header,
view tabs, error pages, nav chrome) needs a user-words pass, and the box
agent's guidance should tell it to explain-or-avoid box jargon when talking to
the user (the agent-guide / box CLAUDE.md owns that). The worst single item is
the filename-as-heading on card views.

Related: [first-run-experience](2026-07-20-first-run-experience.md) (the
surrounding "explains nothing" tension);
[day-to-day-usage-docs](../docs-and-chores/2026-07-20-day-to-day-usage-docs.md).
