---
title: "Chat surfaces are themed by overriding Tailwind utility classes per theme"
workstream: theme-audit
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-audit — pixel contrast audit of every catalog theme
resolution: implemented
---

> **Closed:** resolved on `worktree-theme-audit` (plan `theme-studio.md`, landed in the merge of that branch). Chat roots now provide MaterialContext, chat text uses the `text-card-*` tokens, and themes set `--bbx-ink`, `--bbx-ink-soft` and `--bbx-pen`. The per-theme utility-class overrides are deleted. No divergence from the proposed direction.

Most dark and textured system themes restyle chat surfaces by matching
Tailwind utility classes inside them, for example in `themes/deck.css`:

```css
.bbx-box-presentation[data-chrome-theme="deck"] :is(.bbx-chat-reply-material, …)
  :is(.text-warm-500, .text-warm-600, .text-warm-700, .text-warm-800, .text-primary):not(button)… { color: #b2cbc5; }
```

and `… .bbx-chat-reply-material .bg-warm-50:not(.bbx-card-theme *) { color: #302f2d; }`
in Gilt, Tempest and the textile themes. Each theme carries its own copy, and
the copies differ (some list `text-warm-900`, some exclude buttons).

The pattern fails silently when a component changes a utility class: the
theme-audit workstream found 13 theme rules keyed on `.text-accent-dark` that
stopped applying when the callout label changed class, and four themes that
had each patched the system-theme picker labels by hand while Deck had not.
That workstream replaced those two cases with `bbx-` hooks and the `Card`
material context (`components/ui/material.ts`).

## Possible resolution

Give chat surfaces material tokens like card themes have (`--bbx-ink`,
`--bbx-ink-soft`, a plate surface), have the chat components read them
through the text primitives, and delete the per-theme utility-class
overrides. `bin/theme-check --all` measures the result for every theme.
