---
title: "Danger-colored small text is 2 to 4.4:1 on every theme, so a citation whose source cannot be found is hard to read"
workstream: theme-colors
area: beebox
labels: [themes, contrast]
resolution: implemented
filed-by: agent
discovered-by: Ian
discovered-in: main — theme-check run after adding citations to the theme studio sample, 2026-10-26
---

**Closed.** Resolved by 09f013512 and e64e23114. Each theme sets its own `--bbx-danger` red (card and chat materials) with a derived default; the unresolvable citation is back in the theme studio sample; `bin/theme-check` now audits danger token pairs. On the decision points: the boxholder chose a per-theme red, and the unresolvable marker stays danger-colored.

A citation whose `ref` points outside the box renders as an inert marker,
"[→ <label> (unresolvable)]", in `text-danger`
(`beebox/src/frontend/src/components/Markdown/Source.tsx`, `CitationChip`).
That color is `#c2788a` on every theme; no system or card theme sets it. As
small text it measured below 4.5:1 everywhere `bin/theme-check --all` looked
on 2026-10-26: 3.31:1 on plain white, 2.09:1 on paper-manila, 2.91:1 on
night-atlas, 4.41:1 on gold-thread.

`text-danger` appears in about 87 places in the frontend, so the marker is
likely one case of a wider miss: error text in forms, failed-send notes,
and other warnings may fail the same way on some themes.

The theme studio sample card had an unresolvable citation for one run; it
was taken out so that every theme-check run does not report the same miss.
Put it back when this is fixed, so the check guards it.

## To decide

- A themed danger color: each theme sets a danger ink that passes on its
  surfaces, or one derived value (for example, mixed toward the theme's ink)
  that passes everywhere.
- Whether the unresolvable marker should be danger-colored at all, or
  muted ink with the "(unresolvable)" word carrying the meaning.
