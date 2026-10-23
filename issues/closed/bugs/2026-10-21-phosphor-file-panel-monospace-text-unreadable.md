---
title: "Phosphor file panel: monospace text is unreadable (1.85:1) because the shared Pre component hard-codes text-warm-800"
workstream: theme-audit
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-audit — bin/theme-check --all
resolution: implemented
---

Resolved in the commit that moved this file: `Pre` takes `card-ink`/`card-soft` on a material, the neutral file desk is a material root, and Phosphor sets its material ink there.

`bin/theme-check --all` reports monospace text in the Phosphor file panel at
1.85:1. The shared `Pre` component sets `text-warm-800`, so the text ignores
the dark file material that Phosphor paints behind it. The miss predates the
theme-audit work.

Direction to weigh: have `Pre` take its color from the material tokens
(`text-card-*`) as the chat text now does, so every theme's file area sets
the ink. A per-theme override would repeat the utility-class pattern that
`closed/code-quality/2026-10-21-chat-material-themed-by-utility-class-overrides.md`
removed.
