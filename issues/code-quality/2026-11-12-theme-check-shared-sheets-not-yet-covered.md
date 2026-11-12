---
title: "Theme audit: nine shared theme sheets are not yet held to rule coverage"
workstream: unattached
area: beebox
labels: [themes, theme-check]
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-ink-dark-themes — extending bin/theme-check rule coverage to sheets that name no theme
---

`bin/theme-check` checks that each theme rule matches something in the theme
studio. It used to count only rules that name a theme, so a sheet every theme
wears (`question-beside.css`) was never checked. It now counts rules that name
no theme in every `themes/*.css` sheet, except the sheets listed in
`SHARED_NOT_YET_COVERED` (`beebox/test/tours/theme-check.ts`).

On 2026-11-12 those sheets had 34 rules that match nothing in the studio,
mostly states the studio does not show: a card turning over (`card-turn.css`),
inset and plain quote treatments and nested quotes (`quote-sheets.css`,
`card-themes.css`), a disabled swatch, a figure's error (`.cl-error`), the
card back's field list, the tab strip's overflow shadows, the "Updating…"
badge. Each needs a studio specimen, deletion if dead, or an exemption with a
reason; then the sheet leaves the list.
