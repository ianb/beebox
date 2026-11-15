# Stage 4 drawing round: findings

Three drawers ran the brief in `drawing-brief.md` on 2026-11-15:
- two fresh Opus agents, `opus-a` and `opus-b`;
- one Codex agent, gpt-6-sol (`sol`).

Each wrote the same three sketches in
`canvas-loop/src/examples/scene-drawers/<name>/`, rendered them with the spike,
and wrote `ACCOUNT.md`.

- **Renders used:** opus-a 14, opus-b 16, sol 9.
- **Sol's sandbox:** the first sol run had no GPU in its Codex sandbox. Its
  second run had GPU access.

Best frames:
- opus-a: market, night room, pendulum (`market6/frame-0060.png`,
  `room3/frame-0060.png`, `pend3/frame-0030.png`)
- opus-b: night room, market, pendulum (`room5/frame-0045.png`,
  `market6/frame-0030.png`, `pend3/frame-0030.png`)
- sol: market, night room, pendulum (`market/frame-0030.png`,
  `night-room/frame-0089.png`, `pendulum/frame-0000.png`)

All under `scratch/stage4/draw/<name>/`; scratch output is not kept in git.

## What worked

- **Familiar calls.** Shapes, styles, `at`, `group`, `clip` and `tube`
  carried over from today's API; no drawer looked them up.
- **Pictures with `deps`.** All three drew two vendors from one picture in
  different colours, first try. The `--scene` outline confirmed the
  versions.
- **One lit, washed group.** Lighting, wash and paper on one group turned
  flat fills into a painted picture in one render (all three).
- **`v.toCanvas`.** It hung a lantern from a hand two rotations deep on the
  first render (opus-b).
- **`v.noise` and `emissive`.** Flicker and glowing flames needed no model
  state.
- **Speed.** A 90-frame render took 0.5–3.7 s. No drawer rationed renders.
- **Error messages.** Every error named the call, the rule, the value and
  the sketch line. Examples: `dash` (opus-a, opus-b) and an emissive just
  above 1 (sol). Each drawer fixed theirs in one step.

## Findings

| # | Finding | Who | Proposal |
|---|---|---|---|
| 1 | `style.dash` throws "not supported yet" although the draft lists it as unchanged | opus-a, opus-b | Implement dashes in the spike: outline split into dash segments before coverage. |
| 2 | A wash treats the canvas edge as a region edge: a ragged rim along every side unless the scene is drawn 30–40 px past the canvas | opus-a, opus-b | The wash samples its region as continuous across the canvas edge (clamp-to-edge region field). No API change. |
| 3 | Light `energy` has no calibration: 1 is barely visible over a mid ambient; each drawer needed 2–3 renders | all three | Document a starting pair (ambient and energy) with a worked lamp. With `--scene`, report each light's peak added brightness. |
| 4 | Side-view scenes: casters throw shadows up into the sky, because lighting is top-down | opus-b | `material.receivesShadow: false` for a backdrop. Draft change, for Checkpoint 4. |
| 5 | A light in a picture lights only its nearest lit group, so a lantern cannot light neighbouring stalls that have their own wash | sol | Document it; the pattern is one lit group around the stalls with the washes inside it. A cross-group light is a draft question for Stage 5. |
| 6 | No warning for a shape or label entirely off the canvas, or for unboxed text that crosses the edge | opus-a, sol | Already a chunk 7 gap (dev-loop row "drawing entirely off the canvas"): one warning per run with the frames. Add unboxed text crossing the edge. |
| 7 | The section 10 performance hint for a placement whose scale changes every frame never appears | opus-a, opus-b | Emit the hint in testing mode. |
| 8 | Scripted `param` events have no transcript line | opus-a, opus-b | Write `param: name → value` as today's transcript does. |
| 9 | Headless control stand-ins draw a bare value box: no label, a number box for a slider | opus-a, opus-b, sol | Draw the label and a slider stand-in for `number` params. |
| 10 | `paper` 0.6 looks like paper at ratio 1 and coarse stucco at ratio 2; granulation speckle is strong at ratio 2 | opus-a, opus-b | Check whether paper grain scales with device ratio. It should be anchored to sketch coordinates, so the same picture at ratio 2 is the same paper, sharper. |
| 11 | Brush texture inside fills mostly disappears under wash and lighting | opus-a, opus-b | Look at in the Astra read; no change proposed yet. |
| 12 | Lamp shades with emissive and wash read almost paper-white | opus-a | Look at in the Astra read. Possible cause: emissive plus the wash lifts light colours toward paper. |
| 13 | `render.sh` resolved `--events` from `canvas-loop/` | opus-b, sol | Fixed in the script. |
| 14 | `--scene` is long (939 lines for 4 frames) | opus-a | `--scene first` writes the outline for the first captured frame only. |

## Silent failures found by eye

Each drawer found problems that no warning reported:
- opus-a: a label box off the right edge, and peppers placed off the canvas;
- opus-b: sky shadows, the canvas-edge rim, and the stucco speckle;
- sol: a lantern sinking into the apples, and the reader cropped at the end of the pan.

Findings 2, 6 and 10 cover the mechanical ones. The rest need a look at the
frames, which is the agent's job and the reason the headless runner writes
PNGs.

## Compared with Stage 2

Stage 2's paper probe (`../stage2-findings.md`) predicted the lighting
conventions and the glow vocabulary would cause trouble. With the draft 2.7
documentation, neither did. What Stage 2 could not predict came from
rendering:
- light calibration;
- the canvas-edge rim;
- paper grain against ratio;
- side-view shadows.
