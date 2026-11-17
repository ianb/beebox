# Plan review — canvas-loop examples

Cross-model plan review of
[canvas-loop-examples.subplan.md](canvas-loop-examples.subplan.md),
2026-11-16. Reviewer: codex gpt-6-sol, two rounds (a full review, then
verification of the fixes).

## Round 1: findings and adjudication

| # | Finding | Adjudication |
|---|---|---|
| 1 | The target set is too large: `figure-shading` repeats the BRUSHES.md shading recipe; `lamps`, `pendulum`, `paint` each combine several lessons | Accepted. `figure-shading` dropped (13 examples). `lamps` keeps only start frames per id; `pendulum` drops the trail and label box; `paint` drops speed-to-pressure |
| 2 | A position-pure `v.pixels` field (seamless tiles) teaches something TEA.md does not | Declined: it serves tiled maps, which box figures rarely draw. Recorded as Open design question 3 for the boxholder |
| 3 | "The events file is its test" overstates the check: a scripted input can be ignored, `(unhandled)`, and still pass | Accepted. The check fails on any `(unhandled)` input verdict; `scale`'s deliberate miss moves into its GPU test |
| 4 | A warning check on lines beginning `warn:` misses the transcript's `**[frame N]** warn:` form (`canvas-loop/src/headless/transcript.ts:71`) | Accepted. A pure `transcriptProblems` matcher on the framed form |
| 5 | A rendered-warning test does not belong in a non-GPU test file | Accepted. The matcher is unit-tested on sample lines; no render |
| 6 | The run-length rule is not enforced; the parser does not require sorted entries | Accepted. Run length from the parsed max frame, whose entry must be a `snapshot` |
| 7 | The speed claim for the subset issue has no gate | Accepted. Over two minutes, the issue leaves the plan's list and stays open |
| 8 | The link-test scope differs between Track F and Failure modes | Accepted. TEA.md, BRUSHES.md and README.md in both |
| 9 | Order of the generated doc stated two ways; busy-town citation in the wrong file; a count off by one | Accepted. Name order; citation to `busy-town-opus/sketch-tea.ts:50-62`; counts fixed |

## Round 2: verification

Fixes 3–6, 8 and 9 held. Three further points, all accepted:

- NOT in scope and Rollout shape gave different outcomes for a slow check;
  both now say the issue stays open and the filter is its own work.
- `paint` still taught two mechanisms; it now teaches the picture chain only,
  and sets the stroke seed without comment.
- `pendulum`'s claim that substeps make motion independent of frame rate was
  wrong; it now advances a fixed 1/60 s per tick, with substeps for stability.

## Left for the boxholder

- Open design questions 1–3 in the plan: a committed gallery page under
  `dev/`, whether archived entries stay browsable outside git, and the
  declined `v.pixels` example.
- The size: about 2,600 changed lines excluding the gallery deletion
  (BIG CHANGE, within the workstream's 2026-11-11 approval).
