---
title: "Base secondary text (warm-500/600) is below WCAG AA on light surfaces; move it to warm-700"
workstream: theme-audit
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-audit — tour checkpoints now run the pixel contrast audit
resolution: implemented
---

> **Closed:** resolved on `worktree-theme-audit` (plan `theme-studio.md`, landed in the merge of that branch). Direction 2 shipped: `text-warm-500/600` text moved to `warm-700` across about 90 files; icon-only sites moved to `warm-600`. The scale in `tailwind.config.js` is unchanged.

Every tour checkpoint now reports text below WCAG AA. On the plain (Flat)
app the remaining misses are the base warm scale used as secondary text:
`text-warm-500` (#B8A890, 2.3:1 on white; 1.8:1 on the desk) for the empty
chat line, the composer placeholder and many hints, and `text-warm-600`
(#9B8E7E, 3.5:1). About 240 call sites use the two classes for text.

This is a choice about the look of every secondary-text surface, so it is
the boxholder's:

1. **Remap the scale**: darken warm-500/600 in `tailwind.config.js`. One
   file; every border, fill and text that uses those steps darkens with it.
2. **Move text to warm-700** (#6B5D4B, 6.5:1) and keep 400–600 for borders
   and fills. Many files; borders keep their look.

The theme-audit exhibit shows the composer placeholder at warm-500 and at
warm-700. Text on themed cards no longer depends on this scale where it
uses the `Card` material (`text-card-soft`).

## Decision (2026-10-21)

The boxholder approved the lean: direction 2, move secondary text to
warm-700 and keep 400–600 for borders and fills. The theme-audit branch
moved the two surfaces the theme studio shows, the empty-chat line and the
composer placeholder. The other `text-warm-500` and `text-warm-600` text call
sites remain. Tour checkpoints report each one a tour reaches.
