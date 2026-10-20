---
title: "Revealed redacted text is a fixed dark purple, hard to read on dark themes"
workstream: unattached
area: beebox
labels: [ui, themes]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-bug-burndown-3 — boxholder report while fixing todo colors on dark themes
resolution: implemented
---

Once a `{% redacted %}` passage is revealed, its text is
`text-info-dark` (iris dark, `#5E5490`) on every surface
(`beebox/src/frontend/src/components/Markdown/Redacted.tsx`). On dark card
themes (deck, night-atlas, gold-thread, phosphor, tempest, gilt) that is dark
purple on a dark background and barely readable. Checked in a browser on
2026-10-19.

The concealed state blurs the text in its own (theme) color and lays a noise
texture over it with `mix-blend-mode: multiply`. It reads as a blurred
smudge on both light and dark themes; on dark themes the noise is not visible.

Fix direction: derive the revealed color from the surrounding text color so
it keeps that surface's contrast, and keep a visible cue that the text was
redacted.

## Resolution

2026-10-19, bug-burndown-3: revealed text uses a new `.bbx-redacted-revealed`
class in `beebox/src/frontend/src/index.css`: the text color is
`color-mix(in srgb, currentColor 50%, #7b6fb0)`, half the surrounding text
color and half iris, and a 14% iris background marks the passage as once
redacted. On a light card that gives dark purple-grey text, on a dark card
light lavender text. `Redacted.tsx` applies the class to inline and block
reveals, and the block gets padding for the background. The concealed state
is unchanged. Checked in a browser on the plain, paper, post-it, deck,
night-atlas, gold-thread, phosphor, tempest and gilt card themes.
