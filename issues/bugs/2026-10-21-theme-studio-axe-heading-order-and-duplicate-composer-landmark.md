---
title: "Theme studio: axe heading-order and landmark-unique violations on its specimens"
workstream: tour-check
area: beebox
labels: [a11y, tours]
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261021-221418
---

The `theme-studio` tour reports two axe violations at both checkpoints
(`draft-theme`, `card-material`) and both viewports, on
`/dev/theme-studio?system=draft&card=draft`:

- `heading-order` (moderate): an `h4` inside `div[aria-label="This card"]`
  follows a heading more than one level above it.
- `landmark-unique` (moderate): more than one composer specimen is a landmark
  named "Compose message"
  (`.bbx-composer-material > .border-t.border-warm-300[aria-label="Compose message"]`).

The specimens are real components on fixed props (`e11d5b6e7`). The page
shows several composers at once, which a real page never does. So the
second violation may be a property of the studio only. The heading-order one
can come from the card-back specimen and may also appear in the app.

## Evidence

- Tour: `beebox/test/tours/theme-studio.tour.ts`.
- Artifacts: `beebox/test/tours/.artifacts/theme-studio/2026-10-22T04-10-40-325Z/draft-theme.desktop.axe.json`
  and `card-material.desktop.axe.json` (mobile has the same).
