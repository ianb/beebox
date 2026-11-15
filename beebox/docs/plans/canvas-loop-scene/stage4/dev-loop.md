# Stage 4, chunk 7: the dev-loop checklist

Part of `beebox/docs/plans/canvas-loop-scene/stage4-plan.md`, item 7. Written
2026-11-15.

The spike's first principle is agent DX: when a sketch has a mistake, the
tools say what is wrong, where, and how to fix it. Each row below is one
mistake an agent makes, written as a deliberately bad sketch. Each sketch runs
through the headless runner, as `run` does, and its output is compared with
what the row expects.

- **Sketches:** `canvas-loop/test/scene-spike/dev-loop/cases.ts`, one entry per
  row, with the channel and the patterns the text must match.
- **Test:** `canvas-loop/test/scene-spike/gpu.test.ts`, one test per row
  (`dev loop, <id>: …`). A row whose gap is left is a `todo` test with its
  proposal as the reason.
- **Channels:** *error* is the error the run throws (a `SketchRunError` naming
  the frame, the step and the sketch's line) and its `error in <step>` line
  in the transcript; *warning* is a `frame N: warning:` line in the
  transcript; *none* means no error and no warning.

## Result

46 rows: **18 pass** as they were, **22 gaps fixed**, **6 gaps left** with
proposals. All 46 tests run in the one GPU test process; the 6 left are todo.

## Fixes that apply to every row

- **An error leaves a transcript.** Before, a throw in `init`, `update`,
  `draw` or the render ended the run with no transcript, and the error named
  neither the frame nor the step. Now the transcript ends with
  `frame N: error in <step>: <Name>: <message>` and the sketch's own stack
  lines (`at path:line:col`), and the run throws `SketchRunError` with the
  same text and the first sketch line. beebox's `figure run-one` reports that
  message unchanged.
- **Warnings name the sketch's line** (`… (at path:line:col)`), found from the
  stack (`canvas-loop/src/scene-spike/call-site.ts`), and each is given once
  per run instead of every frame.
- **Testing mode guards, as today's runtime has them:** the model is frozen
  after `init` and each `update`; `init`, `update` and `draw` must not return
  a Promise; reading a param the sketch does not declare is an error.

## The checklist

| # | Mistake (id) | Expected: channel, and what the text must name | Result | Fix |
|---|---|---|---|---|
| 1 | Picture body reads model state not in `deps` (`stale-picture`) | warning: the picture, its deps, the first differing node, the line | gap fixed | Warned every frame, without a line, with one message for two causes. Now once, with the line, and the message says the kept version is stale. |
| 2 | Two drawings under one key with equal deps (`shared-key`) | warning: the picture, "two drawings share the key", the line | gap fixed | Now told apart from row 1: a key asked for twice in one frame that draws differently. |
| 3 | Deps or size change every frame (`deps-every-frame`) | warning: the picture, "every frame", the line | gap fixed | Was silent (the draft's deferred warning). Now warns once when a key records a new version three frames running. |
| 4 | NaN coordinate (`nan-coordinate`) | error: the call, the argument, NaN | gap fixed | Drew nothing, silently. Shape calls now check every number and name the argument, with a hint that NaN comes from `undefined`. |
| 5 | Infinity size (`infinite-radius`) | error: the call, `radius`, Infinity | gap fixed | Was `RangeError: Invalid array length` from deep in the geometry code. |
| 6 | NaN in a point list (`nan-point`) | error: the call, `points[1]`, NaN | gap fixed | Was silent. |
| 7 | NaN in `at` (`nan-transform`) | error: `at`, `rotate`, NaN | gap fixed | Hid everything inside, silently. |
| 8 | Negative radius (`negative-radius`) | error: the call, `radius`, -5 | gap fixed | Was silent (Canvas2D throws here). |
| 9 | Zero-width rect (`zero-size`) | none: draws nothing, as Canvas2D | pass | — |
| 10 | Unknown brush (`unknown-brush`) | error: the brush name and the presets | pass | — |
| 11 | Unknown blend (`unknown-blend`) | error: the blend name and the list | pass | — |
| 12 | Unknown effect (`unknown-effect`) | error: the effect name and the list | pass | — |
| 13 | Misspelt style key (`unknown-style-key`) | error: the call, the key, the valid keys | pass | — |
| 14 | Colour that does not parse (`bad-colour`) | error: the call, the field, the colour, the line | gap fixed | Failed at render, after `draw`, as `"#ggg" is not a CSS colour` with no call or line. The runner's recorder now parses colours at the call. |
| 15 | Effect colour that does not parse (`bad-effect-colour`) | error: `effects.glow.color`, the colour, the line | gap fixed | As row 14. |
| 16 | `v.*` after `draw` returned (`view-after-draw`) | error: the call, "outside draw" | gap fixed | Silently added to the previous frame's scene. |
| 17 | `place` of a Picture kept from an earlier frame (`old-picture`) | error: `place`, the picture, "earlier frame", what to do | gap fixed | Was accepted, bypassing deps. |
| 18 | A group body throws (`throw-in-group`) | error: the frame, the step, the message, the line | gap fixed | No transcript; see "Fixes that apply to every row". |
| 19 | `update` throws (`throw-in-update`) | error: the frame, `update`, the message, the line | gap fixed | As row 18. |
| 20 | `async draw` (`async-draw`) | error: `draw`, "Promise", "synchronous" | gap fixed | Was accepted, and the body after its first `await` drew into a finished frame. |
| 21 | `draw` changes the model (`mutate-model`) | error: `draw`, the property, "model is frozen", the line | gap fixed | Was allowed (today's runtime freezes the model). |
| 22 | Reads an undeclared param (`undeclared-param`) | error: `params.speed`, the declared params, the line | gap fixed | Was `undefined`, then NaN. |
| 23 | `control` for an undeclared param (`undeclared-control`) | error: the control and the param | pass | — |
| 24 | `v.log` in a picture body (`log-in-picture`) | error: `v.log`, the picture, why | pass | — |
| 25 | A function in `deps` (`function-dep`) | error: the picture, `deps[0]`, "function" | pass | — |
| 26 | Smudge brush with effects (`smudge-with-effects`) | error: the call, smudge, effects, "group" | pass | — |
| 27 | A light outside any lit group (`light-unlit`) | warning: the light, "outside any lit group", the line | pass | Now also names the line and says what to do. |
| 28 | A lit group with no light (`lit-no-light`) | warning: "lit group", "no light", the ambient, the line | gap fixed | Was silent. |
| 29 | A material outside a lit group (`material-unlit`) | none: ignored silently by design (R8) | pass | — |
| 30 | Text in a font that is not installed (`unknown-font`) | warning: the font, the line | gap fixed | Drew in a fallback font, silently. Headless only: the browser loads web fonts later. |
| 31 | `pixels` fill leaves alpha 0 (`transparent-pixels`) | warning: the pixels key, "transparent", the line | pass | Now also names the line and where alpha is. |
| 32 | `pixels` fill replaces `image.data` (`pixels-replaced`) | error: the pixels key, `data`, "write into" | gap fixed | Was a Dawn error about texture data layout. |
| 33 | Canvas wider than the GPU's largest texture (`huge-canvas`) | error: render, the canvas, its size, the limit | gap fixed | Was "a shape 9000×20 device px is larger than the atlas", which named neither the canvas nor the limit. |
| 34 | A 40000×40000 picture mostly off the canvas (`huge-picture`) | none: tiles only where seen | pass | — |
| 35 | Picture with zero width (`zero-size-picture`) | error: the picture, `width`, "> 0", 0 | pass | — |
| 36 | One key at two sizes in a frame (`same-key-sizes`) | none: two versions, by design (section 5) | pass | — |
| 37 | Clip with no area (`empty-clip`) | warning: the clip, "no area", the line | gap left | Proposal below. |
| 38 | Drawing entirely off the canvas (`offscreen`) | warning: "off the canvas" | gap left | Proposal below. |
| 39 | Point light without `at` (`point-light-no-at`) | error: `light (point)`, `at: [x, y]` | pass | — |
| 40 | Hatching without `amount` (`hatching-no-amount`) | error: `effects.hatching.amount`, the range | pass | — |
| 41 | Hatching over one flat tone (`flat-hatching`) | warning: hatching, tone | gap left | Proposal below. |
| 42 | A brushed mark too faint to see (`faint-mark`) | warning: faint | gap left | Proposal below. |
| 43 | A character the font has no glyph for (`missing-glyph`) | warning: glyph, the code point | gap left | Proposal below. |
| 44 | Blur under a skew (`skewed-effects`) | error: skew, group, "not supported", the line | gap fixed | Failed at render with no line. Now checked at the call too; a picture placed under a skew still fails at render. |
| 45 | Effect groups nested 30 deep (`deep-nesting`) | warning: passes, cost | gap left | Proposal below. |
| 46 | Group opacity 50 for 50% (`opacity-out-of-range`) | error: opacity, 0..1, 50 | pass | — |

## Gaps left, with proposals

Each needs a decision before it is built.

- **`empty-clip`:** warn when a clip has no area on every frame of a run.
  One frame is not a mistake: an animated wipe starts at zero width.
- **`offscreen`:** after the run, warn about captured frames where nothing
  drawn lands on the canvas, using the bounds the renderer already culls by.
  Proposal: report it once per run, listing the frames.
- **`flat-hatching`:** the draft's "no tone variation" warning. Read back the
  histogram pass that hatching already runs, and warn when its tone range is
  empty. This costs one readback per hatched group in testing mode.
- **`faint-mark`:** port today's faint-mark check (`core/painter/faint.ts`).
  It needs each mark's peak alpha, which the spike computes on the GPU. In
  testing mode, read back a per-mark maximum.
- **`missing-glyph`:** port today's missing-glyph check
  (`core/painter/text-watch.ts`) to the glyph atlas, which already draws each
  glyph on the CPU.
- **`deep-nesting`:** the transcript prints `passes N` for each captured
  frame (91 here), but does not mark it as high. Proposal: warn above a pass
  budget per frame (a number to choose, for example 64) and name the deepest
  group path.

## Other finds

- **Render errors do not name the node.** Draft section 10 says a message
  names the node by its path (`group "room" > place "citizen" … > circle #4`).
  Errors raised at the call do this through the sketch's line. Errors raised
  at render (an effect under a placed picture's skew, a layer over the
  texture limit) name only the picture or nothing. Proposal: the renderer
  keeps the path while lowering and adds it to `GpuRenderError`.
- **The browser parses colours at render.** The browser mount's recorder is
  made before the GPU code loads, so it has no colour parser; a bad colour
  there fails at render, without the call. Proposal: give it a parser from
  the page's 2D canvas.
- **A canvas exactly as wide as the largest texture (8192) fails** for a shape
  across its width: the atlas piece is the canvas plus 4 px of padding.
  `failedFrames` uses this case to fail a frame late.

## Actual output, verbatim

Captured with the runner at this commit. Paths are relative to `canvas-loop/`;
line numbers are those of `cases.ts`.

**stale-picture**

```
frame 1: warning: picture "swatch" drew differently from its kept version with the same key and no deps: the body reads a value (a model field, a param, the frame) that is not in deps, so the kept version is stale; first difference at picture "swatch" > rect #1 (at test/scene-spike/dev-loop/cases.ts:51:31)
```

**shared-key**

```
frame 0: warning: picture "icon" was asked for twice this frame with the same key and no deps and drew differently: two drawings share the key, or the body reads a value (such as a loop variable) that is not in deps; first difference at picture "icon" > rect #1 (at test/scene-spike/dev-loop/cases.ts:60:17)
```

**deps-every-frame**

```
frame 2: warning: picture "bar" recorded a new version in each of the last 3 frames (now deps [3], 23×10): its deps or size change every frame, so it is never reused; keep per-frame values out of the picture and apply them with at, place or a drawing beside it (at test/scene-spike/dev-loop/cases.ts:69:31)
```

**nan-coordinate**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: rect: y must be a finite number, got NaN (NaN usually comes from undefined in arithmetic: a model field or param that is not there)
  at test/scene-spike/dev-loop/cases.ts:76:23
```

**infinite-radius**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: circle: radius must be a finite number ≥ 0, got Infinity
  at test/scene-spike/dev-loop/cases.ts:83:23
```

**nan-point**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: curve: points[1] must be [x, y] with finite numbers, got [NaN, 4] (NaN usually comes from undefined in arithmetic: a model field or param that is not there)
  at test/scene-spike/dev-loop/cases.ts:90:20
```

**nan-transform**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: at: rotate must be a finite number, got NaN (NaN usually comes from undefined in arithmetic: a model field or param that is not there)
  at test/scene-spike/dev-loop/cases.ts:97:20
```

**negative-radius**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: circle: radius must be a finite number ≥ 0, got -5
  at test/scene-spike/dev-loop/cases.ts:104:20
```

**zero-size**

```
(nothing: no warning, no error)
```

**unknown-brush**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: unknown brush "pen" (presets: ink, marker, pencil, chalk, airbrush, wash, bristle, smudge, wet)
  at test/scene-spike/dev-loop/cases.ts:118:20
```

**unknown-blend**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: blend "lighter-ish" is not one of: normal, multiply, screen, overlay, darken, lighten, soft-light, hard-light, color-dodge, color-burn, add, difference, exclusion, hue, saturation, color, luminosity
  at test/scene-spike/dev-loop/cases.ts:125:20
```

**unknown-effect**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: group effects: unknown effect "blurr" (hue, saturation, brightness, contrast, grayscale, sepia, invert, blur, glow, shadow, wash, hatching, paper)
  at test/scene-spike/dev-loop/cases.ts:132:20
```

**unknown-style-key**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: rect: unknown style key "colour" (fill, stroke, weight, brush, gesture, blend, erase, dash, cap, join, material, effects)
  at test/scene-spike/dev-loop/cases.ts:139:20
```

**bad-colour**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: rect fill "#ggg" is not a CSS colour (for example "#2a9d8f", "rgba(42,157,143,0.5)" or "teal")
  at test/scene-spike/dev-loop/cases.ts:146:20
```

**bad-effect-colour**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: group effects.glow.color "warm yellow" is not a CSS colour (for example "#2a9d8f", "rgba(42,157,143,0.5)" or "teal")
  at test/scene-spike/dev-loop/cases.ts:153:20
```

**view-after-draw**

```
frame 1: error in update: SketchUsageError: Sketch API misuse: v.rect called outside draw: the View records only while draw runs; keep what you need in the model and draw it from draw
  at test/scene-spike/dev-loop/cases.ts:162:57
```

**old-picture**

```
frame 1: error in draw: SketchUsageError: Sketch API misuse: place(picture "dot"): this Picture came from an earlier frame; call v.picture in each draw (it hands back the kept version without recording again) and place what it returns
  at test/scene-spike/dev-loop/cases.ts:178:9
```

**throw-in-group**

```
frame 0: error in draw: RangeError: boom in group
  at test/scene-spike/dev-loop/cases.ts:188:28
  at test/scene-spike/dev-loop/cases.ts:187:23
```

**throw-in-update**

```
frame 2: error in update: TypeError: boom in update
  at test/scene-spike/dev-loop/cases.ts:199:57
```

**async-draw**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: draw() returned a Promise: sketches must be synchronous (no async, no await)
```

**mutate-model**

```
frame 0: error in draw: TypeError: Cannot assign to read only property 't' of object '#<Object>' (the model is frozen: update returns a new model, and draw only reads it)
  at test/scene-spike/dev-loop/cases.ts:221:16
```

**undeclared-param**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: params.speed: the sketch declares no param "speed" (declared: size); add it to the params export
  at test/scene-spike/dev-loop/cases.ts:231:56
```

**undeclared-control**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: control("speed"): no param named "speed" is declared
  at test/scene-spike/dev-loop/cases.ts:238:20
```

**log-in-picture**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: v.log inside the body of picture "p": a body runs only when its version records, so log would come and go with the cache (draft section 8)
  at test/scene-spike/dev-loop/cases.ts:245:81
  at test/scene-spike/dev-loop/cases.ts:245:28
```

**function-dep**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: picture "p": deps must be plain data compared by value, but deps[0] is a function
  at test/scene-spike/dev-loop/cases.ts:252:28
```

**smudge-with-effects**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: line: a smudge brush with effects has nothing to read (R2): draw it without effects, or put it in a group
  at test/scene-spike/dev-loop/cases.ts:259:20
```

**light-unlit**

```
frame 0: warning: light point at (20,20) is outside any lit group and does nothing (R8); put it inside group({ lighting: {} }, …) (at test/scene-spike/dev-loop/cases.ts:266:20)
```

**lit-no-light**

```
frame 0: warning: lit group has no light inside it, so only its ambient (#4d4d4d) lights it (R8); add v.light({ kind: "point", at: [x, y] }) inside the group (at test/scene-spike/dev-loop/cases.ts:273:20)
```

**material-unlit**

```
(nothing: no warning, no error)
```

**unknown-font**

```
frame 0: warning: text "hello": no font family in "Comic Neuee" is installed here, so it draws in a fallback font; name an installed family or end the list with a generic one (sans-serif, serif, monospace) (at test/scene-spike/dev-loop/cases.ts:287:20)
```

**transparent-pixels**

```
frame 0: warning: pixels "field": the fill left every pixel transparent (alpha is every 4th byte, data[i + 3]; 255 is opaque) (at test/scene-spike/dev-loop/cases.ts:294:28)
```

**pixels-replaced**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: pixels "field": the fill replaced image.data; write into the array it is given (data[(y * width + x) * 4 + channel] = …), which holds 4×4×4 bytes
  at test/scene-spike/dev-loop/cases.ts:303:28
```

**huge-canvas**

```
frame 0: error in render: GpuRenderError: GPU renderer: the canvas 9000×20 at pixel ratio 1 is 9000×20 device px, larger than this GPU's largest texture (8192 px a side)
```

**huge-picture**

```
(nothing: no warning, no error)
```

**zero-size-picture**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: picture "label": width must be a number > 0, got 0
  at test/scene-spike/dev-loop/cases.ts:327:28
```

**same-key-sizes**

```
(nothing: no warning, no error)
```

**empty-clip**

```
(nothing: no warning, no error)
```

**offscreen**

```
(nothing: no warning, no error)
```

**point-light-no-at**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: light (point): needs at: [x, y]
  at test/scene-spike/dev-loop/cases.ts:359:52
  at test/scene-spike/dev-loop/cases.ts:359:20
```

**hatching-no-amount**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: effects.hatching.amount: must be a number in 0..1, got undefined
  at test/scene-spike/dev-loop/cases.ts:366:20
```

**flat-hatching**

```
(nothing: no warning, no error)
```

**faint-mark**

```
(nothing: no warning, no error)
```

**missing-glyph**

```
(nothing: no warning, no error)
```

**skewed-effects**

```
frame 0: error in draw: UnsupportedCallError: scene spike: group effects under a rotated non-uniform scale or a skew is not supported yet (effects follow axis-aligned scales and rotations with a uniform scale only)
  at test/scene-spike/dev-loop/cases.ts:397:51
  at test/scene-spike/dev-loop/cases.ts:397:20
```

**deep-nesting**

```
passes 91, effect passes 60, copies 0, draws 31
```

**opacity-out-of-range**

```
frame 0: error in draw: SketchUsageError: Sketch API misuse: group opacity must be a number in 0..1, got 50
  at test/scene-spike/dev-loop/cases.ts:418:20
```
