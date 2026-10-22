---
title: "Theme studio has no real app-nav specimen, so nav pill contrast escapes the theme loop"
workstream: theme-audit
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-audit — system-themes tour contrast findings
resolution: implemented
---

> **Closed:** resolved on `worktree-theme-audit` (plan `theme-studio.md`, landed in the merge of that branch). The studio renders the real nav through shared faces in `components/app-bar-faces/` instead of a copied class list. Remaining nav misses (Rose Trellis) are tracked in `decisions/2026-10-21-rose-trellis-nav-labels-below-aa.md`.

`bin/theme-check` measures what the theme studio renders. The studio's
navigation sample is three `Button`s on the nav bar; the real nav uses the
place pill, session chip, badges and voice control, which several themes
style separately (`themes/chrome.css` paper pills, Gilt's leaf buttons,
Posy's pressed state). The Paper (Blue) nav pills' white labels were below
AA (3.5–4.4:1) and only the `system-themes` tour found it.

## Possible resolution

Render the real `AppNav` pieces in the studio with fixed fictional data
(place, session title, badge counts), as the studio already does for the
composer and the empty chat, so every theme's capture covers them.
