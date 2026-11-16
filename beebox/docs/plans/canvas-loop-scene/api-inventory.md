# canvas-loop API inventory (Stage 0)

Part of [canvas-loop-scene](../../implemented-plans/canvas-loop-scene.md), Stage 0. It lists every
`View` call and option and the `Util` helpers, with counts from the corpus.
The counts decide what the scene vocabulary must carry and what it can drop.

## Method

- Sources read: `canvas-loop/TEA.md`, `canvas-loop/BRUSHES.md`,
  `canvas-loop/src/core/tea.ts` (the contract), `canvas-loop/src/core/view.ts`
  (the shared drawing half), `canvas-loop/src/core/paint.ts` (`Style`,
  `TextOptions`, `AtOptions`, `GroupOptions`), `canvas-loop/src/core/compose.ts`
  (blend modes, `Effects`), `canvas-loop/src/core/brush/types.ts` (brush and
  gesture fields).
- Corpus: 131 gallery sketch files (`*-tea.ts` and `sketch*.ts`, `history/`
  excluded) in 39 exercises; 10 files in `canvas-loop/src/examples/`; the
  canvas-loop block of `beebox/src/templates/builtins/starters.ts`.
  `templates.ts` only names the runtime and has no drawing calls (0 hits).
- Counter: a TypeScript script, run from `canvas-loop/`. Its source is
  `scratch/stage0-inventory/count.ts` (not committed; the parent may copy it
  to `canvas-loop/` if it should stay). Command:
  `node --import tsx ../scratch/stage0-inventory/count.ts`.
- Every gallery file names its View parameter `v` and its Util parameter `u`,
  so regexes on `v.NAME(` and `u.NAME` count calls. Option counts read the
  argument text of the call (balanced parentheses, string aware).
- Limits: a call made through a helper that takes `v` counts once, at the
  helper, not once per use. A key such as `opacity` or `seed` also appears in
  non-drawing code; rows marked "noisy" overcount. "Files" counts files; "calls"
  counts matches.

## Summary

- The core is small. Eight shape calls, `at`, `clip`, `text`, gradients and
  `background` cover nearly every sketch.
- Effects, `erase`, `textBounds`, `ease`, `snapshot`, `wrap`, `keepInside`,
  `u.textBounds` appear in no gallery sketch. Of the 17 blend modes, only `multiply` and `screen` appear in the gallery.
- Effects appear only in `canvas-loop/src/examples/effects-tea.ts`, written to
  show them. No gallery exercise uses a group effect.
- The starter uses `background`, `circle`, `width`, `height`, `u.params`. Nothing else.
- Raw `v.ctx` is used by 10 gallery files. Five of them write pixels, which is
  where a lit scene or an image node is needed.

## View: drawing calls

Sorted by gallery files. Counts: files / calls.

| Call | Gallery | Examples | Starter | Notes |
|---|---:|---:|---:|---|
| `v.circle` | 83 / 524 | 7 / 18 | 2 calls | radius, not diameter |
| `v.line` | 81 / 432 | 4 / 5 | 0 | open, no fill |
| `v.rect` | 71 / 495 | 5 / 16 | 0 | |
| `v.text` | 57 / 331 | 7 / 14 | 0 | see text options |
| `v.ellipse` | 52 / 240 | 2 / 10 | 0 | |
| `v.at` | 49 / 136 | 0 / 0 | 0 | transform scope, no layer |
| `v.curve` | 43 / 378 | 3 / 5 | 0 | Catmull-Rom through points |
| `v.clip` | 43 / 106 | 2 / 5 | 0 | single shape 43 files; union of shapes 1 file |
| `v.path` | 33 / 105 | 3 / 9 | 0 | |
| `v.polygon` | 32 / 89 | 3 / 4 | 0 | |
| `v.background` | 31 / 31 | 10 / 10 | 1 | ignores transforms |
| `v.linearGradient` | 24 / 49 | 2 / 5 | 0 | |
| `v.curvePath` | 23 / 57 | 1 / 1 | 0 | helper: returns commands |
| `v.ellipseGradient` | 21 / 47 | 1 / 1 | 0 | |
| `v.radialGradient` | 20 / 48 | 0 / 0 | 0 | |
| `v.roundRect` | 19 / 65 | 3 / 3 | 0 | |
| `v.arc` | 19 / 31 | 0 / 0 | 0 | |
| `v.cache` | 16 / 33 | 0 / 0 | 0 | keyed full-canvas layer |
| `v.triangle` | 16 / 32 | 0 / 0 | 0 | |
| `v.paperTexture` | 16 / 16 | 1 / 1 | 0 | reads the whole backdrop |
| `v.group` | 15 / 38 | 1 / 6 | 0 | opacity 15 files, blend 8, effects 0 |
| `v.tube` | 12 / 25 | 0 / 0 | 0 | helper: returns commands |
| `v.paper` | 10 / 10 | 1 / 1 | 0 | |
| `v.mask` | 8 / 12 | 1 / 1 | 0 | |
| `v.textWidth` | 7 / 19 | 1 / 1 | 0 | measure only |
| `v.control` | 6 / 15 | 1 / 1 | 0 | native input over the canvas |
| `v.sprite` | 5 / 28 | 0 / 0 | 0 | |
| `v.offset` | 5 / 11 | 0 / 0 | 0 | helper: returns points |
| `v.image` | 5 / 11 | 0 / 0 | 0 | draws a sprite |
| `v.cursor` | 4 / 4 | 0 / 0 | 0 | browser only |
| `v.debugBox` | 3 / 7 | 0 / 0 | 0 | only with `run --outline` |
| `v.log` | 1 / 1 | 0 / 0 | 0 | `u.log` is used more (below) |
| `v.tween` | 0 / 0 | 1 / 1 | 0 | helper |
| `v.tweenPoint` | 0 / 0 | 1 / 1 | 0 | helper |
| `v.textBounds` | 0 / 0 | 0 / 0 | 0 | measure only |
| `v.ease` | 0 / 0 | 0 / 0 | 0 | helper |
| `v.snapshot` | 0 / 0 | 0 / 0 | 0 | headless only; the CLI captures frames itself |

Helpers (`curvePath`, `tube`, `offset`, `tween`, `tweenPoint`, `ease`,
`textWidth`, `textBounds`) draw nothing. Gradients also draw nothing: they
return plain data used as a `Paint`. In a scene design they need no node.
`v.width`: 1 gallery file, 1 starter. `v.height`: 1 gallery file, 1 starter.

## View: properties and escape hatch

| Member | Gallery | Examples | Starter |
|---|---:|---:|---:|
| `v.width` | 1 / 1 | 0 | 1 |
| `v.height` | 1 / 1 | 0 | 1 |
| `v.ctx` | 10 / 18 | 0 (one comment) | 0 |

Most sketches use fixed numeric canvas sizes from the `canvas` export, not
`v.width`.

## Util: `u.*` in `init` and `update`

| Member | Gallery | Examples | Starter |
|---|---:|---:|---:|
| `u.params` | 14 / 26 | 2 / 3 | 1 |
| `u.handled` | 11 / 43 | 3 / 7 | 0 |
| `u.log` | 7 / 13 | 2 / 8 | 0 |
| `u.random` | 6 / 74 | 2 / 5 | 0 |
| `u.randomChoice` | 2 / 5 | 0 | 0 |
| `u.record` | 1 / 1 | 0 | 0 |
| `u.scaleNote` | 0 | 1 / 2 | 0 |
| `u.textWidth` | 0 | 1 / 2 | 0 |
| `u.textBounds` | 0 | 0 | 0 |

Only 14 of 131 gallery files read `u.params`, so most exercises have no
controls. `u.*` is not drawing, so the scene change does not touch it. Two
helpers matter to the scene: `u.textWidth` and `u.textBounds` share the text
layout used in `draw` (`canvas-loop/src/core/painter/text-measure.ts:39`).
Scene text layout must stay callable from `update`.

## Style options

Mentions of the key in a file. "Noisy" keys share a name with model fields.

| Key | Gallery | Examples | Starter | Notes |
|---|---:|---:|---:|---|
| `fill` | 105 / 2308 | 10 / 59 | 1 | noisy (also a text option) |
| `stroke` | 91 / 749 | 7 / 18 | 1 | |
| `weight` | 95 / 1160 | 6 / 18 | 0 | |
| `brush` | 42 / 314 | 3 / 8 | 0 | 45 files of 141 use any brush |
| `gesture` | 38 / 276 | 3 / 6 | 0 | |
| `blend` | 31 / 69 | 1 / 4 | 0 | by mode below |
| `dash` | 4 / 6 | 0 | 0 | plain strokes only |
| `erase` | 0 (one comment) | 0 | 0 | never used as `erase: true` |

Brush presets named as `brush: "x"` or `preset: "x"`:

| Preset | Gallery | Examples |
|---|---:|---:|
| `ink` | 28 / 114 | 1 / 1 |
| `pencil` | 21 / 36 | 1 / 1 |
| `wash` | 21 / 57 | 0 |
| `bristle` | 21 / 51 | 1 / 1 |
| `chalk` | 19 / 21 | 0 |
| `airbrush` | 6 / 22 | 0 |
| `marker` | 2 / 2 | 0 |
| `smudge` | 0 | 1 / 1 |
| `wet` | 0 | 1 / 1 |

Smear brushes (`smudge`, `wet`) appear in `examples/paint-mixing-tea.ts` and in
three `busy-town-opus` files (`paint-tea.ts`, `folk-tea.ts`, `actors-tea.ts`;
the counter's regex missed them, checked by hand). They are the only brushes
that read the backdrop.

Gesture fields: `pressure` 36 files, `wobble` 35, `faint` 9. `seed` shows 66
files but is noisy (model seeds). Brush override fields seen: `thinning` 17
files, `load` 14 (noisy), `flow` 5, `bristles` 5, `tip` 8, `spread` 4,
`hueJitter` 4, `lightJitter` 4, `grain` 3, `strength` 1 (example). Never
overridden: `spacing`, `sizeByPressure`, `opacityByPressure`, `scatter`,
`sizeJitter`. The scene can keep them in the brush data at no cost; they
need no new feature.

Blend modes (`blend: "name"`, style, group, text, paste):

| Mode | Gallery | Examples |
|---|---:|---:|
| `screen` | 22 / 48 | 1 / 2 |
| `multiply` | 14 / 19 | 0 |
| `add` | 0 | 1 / 2 |
| other 14 modes | 0 | 0 |

The other 14 are `overlay`, `darken`, `lighten`, `soft-light`, `hard-light`,
`color-dodge`, `color-burn`, `difference`, `exclusion`, `hue`, `saturation`,
`color`, `luminosity` (and `normal`, the default). Brushes set `blend` too:
`marker` is `multiply` by preset.

## Scopes, groups, effects

| Feature | Gallery | Examples |
|---|---:|---:|
| `v.at` `translate` | 47 / 155 | 0 |
| `v.at` `rotate` | 37 / 97 | 0 |
| `v.at` `scale` | 16 / 23 | 0 |
| `v.group` `opacity` | 15 / 42 | 1 / 2 |
| `v.group` `blend` | 8 / 10 | 1 / 2 |
| `v.group` `effects` | 0 | 1 / 6 |
| effect `blur` | 0 | 1 / 6 |
| effect `glow` | 0 | 1 / 2 |
| effect `shadow` | 0 | 1 / 2 |
| effect `saturation`, `sepia` | 0 | 1 / 1 each |
| effects `hue`, `brightness`, `contrast`, `grayscale`, `invert` | 0 | 0 |
| `v.clip`, one shape | 43 / 105 | 2 / 5 |
| `v.clip`, union of shapes | 1 / 1 (`canvas-loop/src/gallery/pendulum-lab/stage-tea.ts:62`, a union of one) | 0 |
| `v.mask` | 8 / 12 | 1 / 1 |
| `v.cache` | 16 / 33 | 0 |
| `v.sprite` | 5 / 28 | 0 |
| `v.image` | 5 / 11 | 0 |
| paste `opacity` | 2 / 5 | 0 |
| paste `blend` | 2 / 4 | 0 |
| paste `erase` | 0 | 0 |
| gradient used as paint | 40 / 144 | 3 / 6 |

`v.at` has no matrix form, so skew needs `v.ctx.transform` (see below). The
union clip is used once and with a single shape; the code path that reads the
whole canvas back (`canvas-loop/src/core/painter/core.ts:172`) is in the API
for a feature the corpus does not test.

## Text options

Counted inside `v.text(...)` calls.

| Option | Gallery | Examples |
|---|---:|---:|
| `align` | 53 / 256 | 4 / 5 |
| `valign` | 53 / 274 | 6 / 9 |
| `size` | 51 / 274 | 6 / 10 |
| `fill` | 53 / 272 | 6 / 11 |
| `style` | 46 / 209 | 0 |
| `font` | 24 / 34 | 0 |
| `lineHeight` | 2 / 2 | 0 |
| `fit` | 1 / 2 | 0 |
| `halo` | 1 / 3 | 0 |
| `wrap` | 0 | 0 |
| `keepInside` | 0 | 0 |
| `blend`, `erase` | 0 | 0 |

`wrap` is on by default when the box has `w`, so a zero count does not show
that wrapping is unused. Box text (`w`, `h`) is not counted here.

## Raw context: the 10 `v.ctx` files

All paths are under `canvas-loop/src/gallery/`. A raw context writes into
whatever layer is current, so each use also depends on `group` and `mask`
nesting.

| File | What the raw context does | Proposed replacement |
|---|---|---|
| `pelican-bicycle/sketch-tea.ts:250` | `beginPath`, `moveTo`, `quadraticCurveTo` (10), `fill`, `stroke`, `lineCap` for the pelican body | `v.path` with `quad` commands and a `Style`; `lineCap` is the only gap (plain strokes have no cap option). Add `cap` to the scene stroke. |
| `pell-anim/sketch-tea.ts:2105` | `fillText` with italic Georgia 25px, right aligned, alpha fill | `v.text` with `style: "italic"`, `font`, `align: "right"`, `fill` (the existing call does all of it) |
| `fjord-tides/sketch-tea.ts:443` | `fillStyle`, `fillRect` for the distant water | `v.rect` |
| `intra-lounge/screens-tea.ts:11` | `save`, `transform(a..f)`, `restore` around drawing: a face-on-wall matrix (`faceTransform`) | matrix transform on `at` (`{ matrix: [a,b,c,d,e,f] }`); needed by `intra-lounge-drawn/light-tea.ts` too |
| `intra-lounge-drawn/light-tea.ts:33` | same: `transform(0.894, 0.447, 0, 1, e, f)`, a skew for a screen | matrix transform on `at` |
| `intra-lounge/scene-tea.ts:555` | `createImageData(W, H)` and `putImageData`: per-pixel lit room, one colour per pixel from lights and sky, filmic tone map | lighting (lights and a material on the room's shapes); or an image node from pixel data as an interim |
| `intra-lounge/dabs-tea.ts:108` | `createImageData` and `putImageData`: per-pixel colour from baked dab owner arrays and per-frame light colours | image node from pixel data (a baked texture, with a per-frame tint); lighting for the tint |
| `intra-lounge/walker-tea.ts:72` | `createImageData`, `putImageData` inside `v.mask`: a depth mask (alpha 255 where the room is further than the walker) | image node from pixel data used as the `mask` body; or depth from a light/occlusion model |
| `intra-atrium/room-tea.ts:354` | `getTransform`, `createImageData`, `putImageData`: per-pixel lit room at device resolution, shadow casters | lighting; the per-pixel function is the "lit panning room" the plan targets |
| `game-world-tiles/field-tea.ts:210` | `getTransform`, `createImageData`, `putImageData`: per-pixel terrain colour field over a map rectangle at device scale | image node from pixel data sized in map units (renderer chooses resolution); or a shader-like per-pixel field node. Open question for Stage 1. |

Counts by kind: plain drawing 3 files (`pelican-bicycle`, `pell-anim`,
`fjord-tides`); matrix transform 2 (`screens`, `light`); pixel writes 5
(`scene`, `dabs`, `walker`, `room`, `field`).

Two pixel files read `getTransform` to find the device scale. That is the
renderer's job in a scene: a pixel-data node should declare a size in scene
units and let the renderer pick the pixel density. Today the sketch sees the
pixel ratio, which makes its output depend on the screen.

## Gaps the inventory shows

| Gap | Evidence | Where it lands |
|---|---|---|
| Matrix transform | 2 files use `ctx.transform` for skew | `at` gets `matrix` |
| Round or square line caps on plain strokes | `pelican-bicycle` | stroke option `cap` (and `join`) |
| Image from pixel data | 5 files | new image node |
| Per-pixel lighting | `scene`, `dabs`, `room` | light and material nodes |
| Effects in real sketches | 0 gallery uses | the effect list can stay short at first; wash and hatching are new effect kinds |

## Not covered

`canvas-loop/src/core/sound/` (voices), `activity`, `params` declarations and
the events file are outside the drawing API. The scene change does not affect them.
