---
title: "canvas-loop: effects, masks, blend modes, easing (klad gaps)"
status: active
workstream: canvas-brushes
issues: []
---
# canvas-loop: effects, masks, blend modes, easing (klad gaps)

Subplan of [canvas-brushes.md](canvas-brushes.md). The boxholder asked to look
again at klad's drawing format (`docs/format.md`, read 2026-11-12, MIT) as a
completeness checklist and to "implement some of the brushes and stuff that's
easy to implement". This plan takes the gaps that Canvas2D already provides in
both runtimes (browser and `@napi-rs/canvas`), so each is a thin data API over
an existing primitive.

## Design

No design section: canvas-loop is a drawing library whose user is a sketch
author (an agent); nothing here changes what a box user meets.

## Smallest fix and budget

Smallest version: the extra blend modes only (one type union, one map). The
chosen scope adds group effects, a soft mask scope and easing/keyframe helpers.
Estimate: ~250 source lines, ~200 test lines, ~80 doc lines, plus one gallery
example.

## Stated preferences this plan trades against

- "Paint objects" / data over modal state (decision 2026-11-11, recorded in
  canvas-brushes.md): effects are plain-data options on `group`, not ctx state.
- `v.ctx` exists for what View does not cover (`canvas-loop/TEA.md`, "Other
  `View` members": *"Prefer the calls above: they are data"*). Today a shadow
  or blur needs `v.ctx`; this moves the common ones to data.
- Minimize invented concepts: CSS filter vocabulary (blur, drop-shadow,
  hue-rotate, saturate, brightness, contrast, grayscale, sepia, invert) is
  reused under plain names.

## What already exists

- `Painter.group` (`canvas-loop/src/core/painter/core.ts:198`) draws the body
  on a layer and composites it with `drawLayer(ctx, {image, opacity, op})`
  (`canvas-loop/src/core/painter/layers.ts:7`), which does
  `ctx.save(); ctx.resetTransform(); … drawImage … ctx.restore()`.
- `maskLayer(layer, {mask})` (`layers.ts:17`) keeps a layer's pixels inside
  another layer's alpha with `destination-in`; it is used by `clip` today.
- `BlendMode` (`canvas-loop/src/core/paint.ts:220`) lists ten modes;
  `compositeOp` maps `"normal"` to `source-over`.
- Probe 2026-11-12: `@napi-rs/canvas` 1.0.2 honours `ctx.filter` for
  `blur()`, `hue-rotate()`, `saturate()`, `drop-shadow()`, and accepts
  `lighter`, `hue`, `saturation`, `color`, `luminosity`, `difference`,
  `exclusion` as composite ops (pixels checked, not just the setter).
- Brush marks render as an alpha mask then tint once per mark (the tint is in
  `canvas-loop/src/core/brush/render/mark.ts`; stamps draw black dabs, e.g.
  `kinds.ts:65`), which is why per-dab colour variation is not in this plan.
- `maskLayer` serves `clip`'s union path only; a single-shape `clip` uses
  `ctx.clip()` on the current destination.

## Prior art (external)

klad `docs/format.md` (format `klad/6`): layer `blend` (adds `add`, `color`,
`luminosity` over ours), `effects` (blur, glow, outline, shadow, noise,
displace, haze, relief), `adjust` layers (hue/saturation, levels, curves,
colour balance, gradient map), layer `mask`, keyframes with eases. Only the
shape of the data is borrowed; no code was read.

## Ontology

- **Effect**: a post-process on a finished group layer, applied as it is
  composited. Options object `effects` on `GroupOptions`.
- **Adjustment**: a colour operation in the same `effects` object (hue,
  saturation, brightness, contrast, grayscale, sepia, invert).
- **Mask**: `v.mask(maskBody, body)` — body's pixels kept in proportion to the
  alpha the mask body paints. Differs from `clip` (hard shape union) by
  taking any drawing, including gradients, as a soft mask.
- **Ease / keyframes**: pure functions of a number; `v.tween(keys, t, ease?)`.

## Tracks / scope

1. **Blend modes.** Add `"add"` (→ `lighter`), `"difference"`, `"exclusion"`,
   `"hue"`, `"saturation"`, `"color"`, `"luminosity"` to `BlendMode`.
2. **Group effects.** `v.group({ effects: { blur?, shadow?, glow?, hue?,
   saturation?, brightness?, contrast?, grayscale?, sepia?, invert? } }, body)`.
   - `blur: px`; `shadow: { x?, y?, blur?, color }`; `glow: { blur, color }`
     (a centred drop-shadow); adjustments are numbers (degrees for `hue`,
     factors for the rest, 1 = unchanged for saturation/brightness/contrast,
     0..1 amounts for grayscale/sepia/invert).
   - Built into one CSS filter string in a fixed order: adjustments, blur,
     glow, shadow. Lengths are canvas pixels times the pixel ratio (the layer
     is drawn at device scale). Not scaled by an enclosing `at` scale; the
     docs say so.
   - Validation: unknown key or non-finite/negative value is a
     `SketchUsageError` naming the valid keys, like style keys
     (`canvas-loop/src/core/painter/style.ts:25`).
   - `drawLayer` gains an optional `filter`, set inside its save/restore.
3. **Soft mask.** `v.mask(maskBody, body)`: body on a layer, mask body on a
   pooled layer, `maskLayer`, composite with normal blend. Nestable inside
   groups.
4. **Easing.** `v.tween(keys, t, ease?)`: `keys` are `[t, value]` pairs sorted
   by `t`, value a number or a number tuple of equal length; clamps outside
   the range. `ease` names: `"linear"` (default), `"in"`, `"out"`,
   `"in-out"` (cubic), `"out-back"`. Also `v.ease(name, u)` for a 0..1 value.
5. **Docs and example.** TEA.md scopes + other members, BRUSHES.md groups
   section, CHANGELOG, a gallery or examples entry showing glow, shadow, mask
   and a tweened move; box docs regenerate from TEA.md/BRUSHES.md.

## Could this be simpler?

The simplest version is track 1 alone. Tracks 2–3 remove the main reason a
sketch reaches for `v.ctx` (shadows and blur), which keeps drawings as data;
track 4 replaces hand-written easing that every animator in the gallery wrote
inline. Each track is independent, so any can be dropped.

## Subplans

None.

## Failure modes

- Browser and Skia blur kernels differ slightly; the headless render is the
  reference and goldens are headless only. Accepted.
- Safari before 18 ignores `ctx.filter`; effects silently vanish there.
  Accepted for an experimental library; noted in docs.
- A big blur on a full-canvas layer each frame is slow; docs point to
  `cache`/`sprite` for static effected art.
- Effects on a group with `erase` inside: erase acts on the group's layer
  first, then the effect applies to what remains. Correct by construction.

## Agent-flow / user-flow edge cases

- An agent passes `effects: { shadow: "2px 2px black" }` (CSS habit): error
  names the object shape.
- `v.tween` keys unsorted or mismatched tuple lengths: `SketchUsageError`.

## NOT in scope

- Per-dab colour variation, image brush tips, smudge/wet paint, flood fill
  (pixel access), outline/noise/displace/relief effects, levels/curves/
  gradient-map adjustments, bones, an animation timeline object.

## Open design questions

None blocking.

## Knowledge audits

canvas-loop has no audit harness of its own; box docs regenerate from TEA.md
and BRUSHES.md, and the existing `figure-canvas-loop-api-docs` audit covers
finding them.

## What will hold this after it ships

Unit tests in `canvas-loop/test/` with pixel checks (effects change pixels
where expected; mask alpha proportional; blend `add` sums), tween value tests,
the gallery check, and lint/typecheck.

## Review decisions (cross-model plan review, codex gpt-6-sol, 2026-11-12)

1. *Mask is an isolated group, not a soft clip.* Kept isolated, like `group`:
   erase and blends inside the body act on the body only. Documented in TEA.md.
2. *Signed values.* `hue`, `shadow.x`, `shadow.y` are signed; nested
   `shadow`/`glow` keys are checked.
3. *Fixed order, narrow glow.* Order stays fixed (nest groups for another).
   A one-drop-shadow glow proved too faint on frames, so `glow` is painted
   separately: the group's silhouette blurred `strength` times (1–6, default
   2), tinted, drawn beneath the group.
4. *Mask diagnostics.* Faint-mark and text-overlap checks skip mask bodies.
5. *Cleanup on throw.* `#onLayer` returns a pooled layer on a body error;
   `LayerPool.borrow` releases in `finally`; `release` resets `filter`.
6. *Coordinates.* Docs say shadow offsets are canvas-aligned under `at`, and a
   group inside a sprite is cut at the sprite's edge.
7. *Easing.* Added `step` and a per-keyframe ease `[t, v, ease]`; equal times
   make a jump.
8. *Stale citations.* Corrected above.

## Implementation order

1, 2, 3, 4, 5. One commit.

## Rollout shape

canvas-loop is a workspace package bundled into `bbx`; it ships with the
branch when the boxholder lands it.
