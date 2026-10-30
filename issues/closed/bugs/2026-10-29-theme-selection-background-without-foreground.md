---
title: "A theme can set the selection background without its foreground, and selected text then uses the default ink"
workstream: theme-colors
area: beebox
labels: [themes, css, contrast]
resolution: implemented
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder report, 2026-10-29"
---

**Closed.** Resolved by 91f0b776e, d3a164009 and e210210d7.
`test/tours/selection-pairs.test.ts` reads every theme stylesheet and studio
study: a rule that sets `--bbx-selection` or `--bbx-selection-code` sets its
ink in the same rule, and a hex pair meets AA. Every shipped rule was paired.
Two pairs were below AA and were fixed: goldfish's system selection (4.44:1)
and posy's (3.87:1). With no ink set, `::selection` now picks black or white
by the background's relative luminance, so a lone background always reads
(at least 4.58:1). The theme studio paints a few words as selected in each
scope that can carry its own pair (chat, own message, reply, card in chat,
reading card, its code block, a plain file). `bin/theme-check` reads each
one's `::selection` colors, which covers pairs inherited across nested
scopes; `--all` found no selection misses. Which theme the boxholder saw was
not found.

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
