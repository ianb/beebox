---
title: "Markdown and source-citation markup render raw in agent output and cards"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test onboarding-first-days (multiple activities)
labels: [soft-launch, field-test-findings]
---

Across the onboarding field-test run, agent-authored markup reached the UI
unrendered:

- **Bare `**`** shown as literal text under the "The Plate" heading
  (`screenshots/dentist-email/02-todos-plate.png`, verified by eye) — bold
  markdown that didn't parse.
- **Source-citation blocks show raw brackets and arrow**: `[→ original.txt: the
  recipe as it was written in the family's own file — kept verbatim]` and
  `[→ thread Reminder Wrens check up Thursday 14 Augu reminder: …]` render with
  their literal `[→ … ]` syntax rather than as a designed citation element
  (recall-recipe, dentist-email). In one the citation is truncated mid-word
  ("Augu") and loses the apostrophe from "Wren's".

Two surfaces are implicated — the chat/message renderer and the card renderer —
so the likely root is a shared markdown/citation rendering path (`src/frontend/`
Markdown component and/or the source-tag renderer) that some agent output takes
and some doesn't. Worth pinning down which citation syntax the agent emits
(`[→ …]`) and whether the renderer is supposed to turn it into a source
affordance; right now it leaks as raw markup, which reads as broken to a user.

The apostrophe loss ("Wren's" → "Wrens", "Nana Odette's" → "Nana Odettes" in
tabs and menus) recurs in filenames/titles and may be a separate slugging
issue; noted here since it showed up in the same citations.
