---
title: "/questions fails axe heading-order — an h3 with no h2 above it"
workstream: tour-health
resolution: implemented
area: callback-box
labels: [a11y, tours]
filed-by: agent
discovered-by: agent
discovered-in: tour-health — nav-pages tour axe report, both viewports
---

The `nav-pages` tour reports one axe violation on `/questions` at desktop
and mobile: `heading-order`, first node
`<h3 class="text-warm-900 text-lg font-bold mb-2">Brain-dump-pattern</h3>`.
The question cards render their title as `h3` under the page's `h1` with no
`h2` in between. Either the card title is an `h2`, or the section has an
`h2`. Small; the weekly tour check will keep reporting it until fixed.

## Resolved (2026-08-28)

Commit 02347dbee.

Fixed: the question-card title (`components/questions/QuestionForm.tsx`'s
`QuestionContext`) was an `h3` rendered directly under the page's `h1` with
no intervening `h2` — a heading-order skip. Changed it to `h2`, matching
`QuestionsList`'s existing "Invalid"/"Archive" section headings (also `h2`)
and the convention elsewhere in the app (card titles are `h2` directly under
a page `h1`, e.g. `TodoViewCard`, `PdfCardView`, `LandmarkSection`).

Also changed the matching title in `components/QuestionCardView.tsx` (the
single-question `/browse/`/`/card/` renderer, which reuses `QuestionForm` for
answerable questions and had its own `h3` for the answered-state title) from
`h3` to `h2`, so the heading level doesn't flip depending on question status.

`pnpm typecheck` and `pnpm lint:changed` clean. `bin/tour nav-pages`:
10 checkpoints, 0 findings, 0 axe violations — `questions` checkpoint shows
0 axe violations on both desktop and mobile in
`callback-box/test/tours/.artifacts/nav-pages/2026-08-28T15-03-52-681Z/summary.md`.
