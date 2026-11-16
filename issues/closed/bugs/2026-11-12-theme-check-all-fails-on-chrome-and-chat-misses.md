---
title: "bin/theme-check --all fails on chrome and chat misses unrelated to cards"
workstream: theme-check-gate
area: beebox
labels: [themes, theme-check, contrast]
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-ink-dark-themes — full catalog runs on 2026-11-12
resolution: implemented
---

`bin/theme-check --all` exits 1 with 40 misses that no card work touches:

- Rose trellis nav: the voice chip's "transcribing…", the questions and todo
  counts, and the profile initial are `#fff3df` on the pink plates, 3.1–3.8:1.
- Phosphor composer placeholder "Type a message..." is 2.75:1 (needs 3).
- Veil chat: the activity summary's "▶" is 4.45:1.
- Overprint chat embed: the card's chat path is 4.48:1 on its band.
- 29 theme rules for `.bbx-chat-pending-material` (a queued message) match
  nothing in the studio, across every chrome theme that styles it. The
  studio's queued entry (`ThemeStudioHarness/chat.tsx`, `QUEUED`) no longer
  renders inside that material, or never did.

Until these are fixed, `--all` cannot serve as a landing gate for theme work.

## Manual testing

> Verified by boxholder 2026-11-15

The contrast changes are committed in 5631c13ae; they are not landed. Review the “Theme contrast before and after” exhibit in the theme-check-gate workstream. Confirm that the adjusted text and chip colors preserve the intended appearance. The full catalog check passed with exit 0 across all 25 cases; evidence is recorded in the [implementation plan](../../../beebox/docs/implemented-plans/theme-check-gate.md); visual approval remains a separate gate.

