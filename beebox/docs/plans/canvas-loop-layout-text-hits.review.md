# Cross-model review — canvas-loop layout boxes, text runs and named hits

Plan: [canvas-loop-layout-text-hits.subplan.md](canvas-loop-layout-text-hits.subplan.md).
Reviewer: codex `gpt-6-astra` (rounds 1 and 2, effort high), codex
`gpt-6-sol` (round 3, verification only). 2026-11-16.

## Round 1 — 10 findings, all accepted

| # | Finding | Change to the plan |
|---|---|---|
| 1 | A still browser figure never draws after the constructor, so a hit scene set only by tick-driven draws stays empty | The browser uses its kept record when it was drawn from the frame's end `(model, params)`; test with a first click at frame 100 |
| 2 | "Last recorded", "what the person saw" and "replay" were treated as one thing | Contract is the logical frame (end of frame N−1); presentation lag and paused-playground gaps documented as accepted |
| 3 | Layout-box rejection drops hits on a picture body outside its box and on backgrounds | Rejection removed (see round 2) |
| 4 | `keepInside` re-layout would turn runs into plain text | `TextFacts.keep` keeps the runs; test added |
| 5 | Budget did not price the smallest version of all three requests | Re-split into core (~1,840) and extras (~310); per-run fill dropped; simplest version no longer relies on Unicode subscripts |
| 6 | A sub glyph rasterised against `top` sits off its shifted baseline | Runs nodes draw on the alphabetic baseline |
| 7 | Flow item boundaries undefined for components returning lists | Items are flattened nodes; wrap a component in `v.at({}, …)` |
| 8 | The A+B-only subscript workaround cancels its own shift | Scenario text corrected |
| 9 | Distance-to-polyline stroke hits ignore caps, joins and dashes | Plain strokes hit-test the renderer's stroke rings |
| 10 | `UnhandledFold` hides a named but unhandled click after an earlier miss | Folding keys on type plus target path |

## Round 2 — 3 findings, all accepted

| # | Finding | Change to the plan |
|---|---|---|
| 1 | The ink box also misses hit areas (`background` under `at` in a picture; tall text line boxes) | No box rejection; the three cases become B1 tests; the timing check decides if rejection is ever needed |
| 2 | "At most one display frame, cannot be seen" is not supported by the source | Claim removed; presentation delay recorded as an accepted gap with its reason (replay determinism) |
| 3 | Boxed text lines are laid out against `"middle"`, not the `valign` mode | Conversion uses the node's own pre-conversion baseline mode at the fitted size; `"H"` vs `["H"]` test |

Also fixed: a leftover distance-to-polyline sentence for plain strokes, and
`fill` left in the Ontology's `TextRun`.

## Round 3 — verification

All four checked fixes hold.
