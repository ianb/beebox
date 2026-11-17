---
title: "Theme audit flags an intentional light Card panel as a surface inversion"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-check-gate — checking nested material boundaries
---

A default `<Card>` inside a dark `CardThemeSurface` correctly paints white and
resets React MaterialContext, so its `<Hint>` uses dark app ink. The contrast
audit nevertheless reports that hint as a surface inversion (Deck: white
against paper `#29312e`, 13.35:1; Night Atlas: 9.37:1).

`Card.tsx` declares the app background and React context but not a new CSS
`--bbx-ink`. `test/tours/tour-lib/contrast-page.ts` recognizes app-panel classes
for its wrong-ink check, while the separate surface check excludes only
controls and descendants whose `--bbx-ink` differs from the enclosing theme.

A fixture with an open Accordion, Hint and ghost Button inside a default Card
reproduced this. The light-panel fixture now remains inside the composer
material in Theme Studio, where it verifies the same React-context reset
without triggering the themed-card surface check. The card-material
Accordion has its own specimen. No audit threshold or exemption was changed.

Decide whether the shared Card should declare its complete CSS material or
the audit should recognize intentionally painted app panels for both checks.
Retain detection of accidental light surfaces inside dark cards.
