---
title: "Chat chemistry formulas render literal markup"
workstream: unattached
area: beebox
labels: [journey-findings, ui-error]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — D chemistry journey, 2026-09-21
priority: normal
---

Chat messages containing chemistry formula markup show the source notation
instead of a reader-facing formula. A learner saw `$$\ce{H2 + Cl2 -> HCl}$$`
and `$$\ce{H2 + O2 -> H2O}$$`, including the dollar signs and backslash. The
formula remained understandable, but the punctuation made the exercise look
broken during an exercise about coefficients and subscripts.

## Research (2026-09-21)

The journey screenshots 20 and 21 show the literal output in the chat. The
shared frontend renderer uses Markdoc and configures ordinary document,
heading, paragraph, link, image, blockquote, and custom-tag rendering; it has
no formula-specific transform. `beebox/src/frontend/src/components/Markdown.tsx:136-162,287-304`
and `beebox/src/frontend/src/components/chat/markdown-rendering.tsx:236-239`.

The resolution needs to decide how authored formula notation should become a
readable formula in chat. It should address the mismatch between generated
output and the renderer without assuming a particular math library.

Evidence: `beebox/user-stories/work/journeys/D-chemistry-2026-09-21/shots/20-balancing-question.png`
and `21-water-exercise.png`.

Evidence and limits: [journey D report](../../beebox/user-stories/journeys/D-chemistry/reports/2026-09-21.md).

The smallest option to evaluate is authoring guidance to emit readable plain
Unicode formulas (for example `H₂ + Cl₂ → 2 HCl`) in this chat renderer.
Nothing found in the current courseware instructions requires `\ce{}` notation.
Adding a formula renderer is a separate product/subsystem decision, not a
requirement established by this walk.
