---
title: "Opening a document doesn't scroll its tab into view when the tab bar overflows"
workstream: sidecar-shell
area: beebox
labels: [ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder report
priority: important
resolution: implemented
---

Resolved by `878d3fc7c` (fix(sidecar): scroll the active tab into view when the
strip overflows), part of the `sidecar-shell` plan
(`InteractiveChat-controls.tsx:160`, `scrollIntoView({ inline: "nearest",
block: "nearest" })`, reduced-motion aware via the extracted
`lib/reduced-motion.ts`). No divergence from what the issue proposed.

With more open documents than the tab bar can show, opening a new document
adds its tab outside the visible range — so the newly active tab isn't
visible ("not highlighted": the highlight exists but is off-screen).

`src/frontend/src/components/ui/TabBar.tsx` has no `scrollIntoView` (grepped);
the fix is the standard one: when the active tab changes, scroll it into view
(`scrollIntoView({ inline: "nearest", block: "nearest" })` on the active tab's
element in an effect — smooth is fine, respect `prefers-reduced-motion`).
Applies on open AND on switching to an off-screen tab by any other means
(e.g. a keyboard shortcut or external navigation).
