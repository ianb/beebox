---
title: "The plate badge is a bare number, so it reads as a wrong total"
workstream: unattached
area: beebox
labels: [journey-findings, ui-sensibility]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey A, 2026-08-25 walk; mechanism traced by a verifier agent
priority: normal
---

## Recovery assessment (2026-09-21)

Current `beebox/src/frontend/src/components/AppNav.tsx:222-234` still renders
the plate icon and a bare count; the explanatory words are in the tooltip and
accessible label. `core/todo/count.ts:100` counts only escalated/on-plate todos.
The count itself is not wrong. This inspection supports the presentation
mechanism, not a fresh reenactment of the old user's interpretation.


> Recovered 2026-09-21 from `worktree-user-stories-refresh` at `f914fcb4e`.
> The account below describes the 2026-08-25 walk, not a new reproduction.
> Source line numbers in that account are historical. Current disposition is recorded below.


Journey A's walker had 6 todos: 3 on the plate, 3 quiet (future `start` dates).
The nav badge showed **3**. For twenty minutes they believed the app had lost
half their list — counted the document twice, called it "a trust dent… this is
a memory tool and its own two counts disagree on the first night."

**The count is not wrong.** `count.ts:91` counts exactly
`escalated | on-plate`, and the tooltip/aria say "3 todos on the plate"
(`AppNav.tsx:174-175`). And when they found The Plate page, they endorsed the
split itself: "That is exactly the split I want." The defect is the visible
badge: a plate glyph plus a bare digit, with the vocabulary only in a tooltip
nobody hovers, and no hint that a quiet half exists.

Their one-word fix is probably right: **"3 of 6"** (or equivalent) — the badge
carrying the existence of the rest, the page carrying the split.

Adjacent code-quality note for whoever picks this up: the
escalated+on-plate predicate is independently spelled at four sites
(`core/todo/count.ts:91`, `ambient-summary.ts:22,25`, `review-sweep.ts:132`,
`todo-view-card-logic.ts:17-21`) with nothing enforcing agreement — worth
consolidating into one named helper while in the area.
