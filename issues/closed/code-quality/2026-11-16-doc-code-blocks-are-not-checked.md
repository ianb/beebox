---
title: "Fenced TypeScript in canvas-loop docs is not type-checked or run"
workstream: canvas-brushes
area: canvas-loop
filed-by: agent
discovered-in: worktree-retrospective — retrospective 20261116-005159
resolution: wontfix
---

**Closed (wontfix, 2026-11-17):** Checked against main on 2026-11-17 (plan:canvas-loop-harness-and-doc-check.subplan). README.md, TEA.md and BRUSHES.md hold 33 ts/tsx blocks, none a whole sketch (the examples are, and examples:check renders them). A throwaway check with v typed as View and u as Util found no stale call: every block that calls the API type-checks, and the failures were wrapper artifacts. The cited README fix (ec34ca70b) changed prose only, which a block check would not catch; a box agent copying a stale fragment gets a type error at bbx figure run. Reopen if a stale block turns up.

canvas-loop docs (README.md, TEA.md, BRUSHES.md, and RENDERER.md on the
canvas-brushes branch) hold fenced `ts` and `tsx` examples
that agents copy. Nothing checks them. After the renderer change, the README
still showed a self-styling `SketchFigure` and event-state behavior the code no
longer has. A session found these by tracing each claim to code by hand.

A harness that extracts fenced `ts` and `tsx` blocks, type-checks them against the
package, and renders the ones that are whole sketches would catch a stale
example at commit time. Blocks that are fragments need a marker to skip or a
wrapper.

Evidence: `canvas-brushes/20261116T064258Z-implemented.md`,
`canvas-brushes/20261116T065119Z-review-adjudicated.md`.
