---
title: "canvas-loop before/after compare and speed checks live in per-chunk scratch copies"
workstream: canvas-brushes
area: canvas-loop
filed-by: agent
discovered-in: worktree-retrospective — retrospective 20261116-005159
resolution: wontfix
---

**Closed (wontfix, 2026-11-17):** Checked against main on 2026-11-17 (plan:canvas-loop-harness-and-doc-check.subplan). The scripts compared the gallery and cache cases, both since deleted from main; no renderer or performance change is open, and examples:check covers run-to-run determinism. The tracked GPU lock (bin/with-gpu) and live page (cli page) that the same scratch work relied on were built instead. If a renderer change needs a before/after: render each example with cli run in both trees and cli diff the PNGs; the live page's frames/s line covers speed spot checks.

Renderer work in canvas-loop checks each chunk two ways: a byte compare of
PNGs and transcripts against a reference checkout, and a pointer-latency
measure of the same page built from two checkouts. Both are scratch scripts
(`compare.sh`, `hashes.ts`, `walker-page.ts`, `six-page.ts`). Each chunk
copies and repoints them. A copy that still pointed at a moved directory cost
one round. A page that dropped `draw`'s return value threw on the new
contract, so one measurement batch had to be redone.

A tracked tool that takes two checkouts and renders the gallery exercises,
examples, and cache cases (PNGs and transcripts), plus an optional speed mode
with pooled latencies, would replace the copies.

Evidence: `canvas-brushes/20261116T022755Z-implemented.md`,
`canvas-brushes/20261116T062111Z-review-adjudicated.md`.
