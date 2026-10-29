---
title: "A theme can set the selection background without its foreground, and selected text then uses the default ink"
workstream: unattached
area: beebox
labels: [themes, css, contrast]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder report, 2026-10-29"
---

The boxholder's report: when a theme overrides the selection background, it
should override the selection foreground too.

The selection rule is in `src/frontend/src/themes/chrome.css`:

```css
::selection {
  background-color: var(--bbx-selection, #bcd4f6);
  color: var(--bbx-selection-ink, #14202e);
}
```

plus a code pair (`--bbx-selection-code`, `--bbx-selection-code-ink`) for
`pre`. The comment there says the tokens are "set in pairs", but nothing
enforces it. A theme, a nested scope, or a box-authored theme that sets
`--bbx-selection` alone gets the default dark ink `#14202e` on its own
background, which can be unreadable on a dark selection. A scope that sets
the code background alone has the same problem with the code ink.

On 2026-10-29 every shipped theme in `src/frontend/src/themes/` set the
pairs together (counted per file), so the case the boxholder saw is either a
nested scope where one token of a pair is inherited from another theme, a
theme in an unmerged branch, a studio theme, or a box-authored theme. Ask
which theme showed it.

Directions:

- **A check:** any CSS rule (and any box-authored theme) that sets
  `--bbx-selection` or `--bbx-selection-code` sets its `-ink` partner in the
  same rule. This fits beside the existing theme contrast checks.
- **A safer fallback:** when the ink token is unset, choose the ink from the
  background's lightness instead of always using the dark default, so a lone
  background still reads.
- Check the contrast of each shipped pair at the same time; the closed
  danger-text contrast issue
  (`issues/closed/bugs/2026-10-26-danger-text-fails-contrast-on-every-theme.md`)
  added that kind of check for another token.
