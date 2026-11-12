---
title: "canvas-loop: per-call styles; retire the p5-style tier"
status: implemented
workstream: canvas-brushes
issues: []
---
# canvas-loop: per-call styles; retire the p5-style tier

canvas-loop copies p5: `fill`, `stroke`, `brush`, `textSize`, `translate` and
`push`/`pop` change hidden state that every later call reads. This plan
replaces that state with a style value passed to each drawing call, and
replaces transforms with a scoped `at`. The model is Skia's `SkPaint` and
Flutter's `Paint`, held in ordinary variables. It also retires the mutable
p5-style tier (`setup`/`draw(s)` sketches), so TEA is the only sketch form.

**Issues addressed:** none filed. Searched `issues/` for "p5", "modal" and
"paint object". The only canvas-loop hit is
`issues/bugs/2026-07-18-canvas-loop-figure-post-merge-followup.md`, which is
unrelated (figure mounting).

## Design

No design section: this changes a developer API for sketch authors (mostly
agents), not what a person meets in the box.

## Smallest fix and budget

**Smallest fix:** add an optional style argument to each primitive, and keep
the modal setters. This removes no hidden state. A call without a style still
reads whatever the last setter left. The text-state leak in the d3 comparison
came from exactly that, so this fix does not fix the reported problem.

**Chosen design:** three tracks.

| Track | Source | Tests |
| --- | --- | --- |
| A. Stateless Painter, `Style` per call, `at`, paste options, diagnostics | ~900 | ~500 |
| B. Retire the mutable tier: `Sketch` API, mutable runtime, events, CLI path | ~700 removed, ~200 changed | ~1,200 (tests move to the TEA harness) |
| C. Migrate 13 TEA and 11 mutable gallery sketches, and 4 examples | ~6,500 (mechanical) | — |
| Docs (TEA.md, README.md, BRUSHES.md, AGENTS.md, CHANGELOG.md) | ~500 | |

**BIG CHANGE, approved.** The boxholder approved the size on 2026-11-11:
- "OK, sounds good, let's do it"
- adding the retirement: "we can probably retire p5 modes as part of this, I
  feel confident we won't go back to them, only forward"

Adding the retirement roughly doubles the estimate. The gallery migration
drives the size:
- the 13 TEA sketches make 1,186 modal calls;
- the 11 mutable sketches are about 3,650 lines.

A cross-model review of the first draft
(`scratch/cross-model/2026-11-12T05-23-12-387Z-codex.md`) cut three things:
- the scripted `type` event, now a separate small change;
- folding `clip` into `group`;
- a `TextOptions.style` rename.

It also split transform scoping from compositing (`at` beside `group`).

## Stated preferences this plan trades against

- **Boxholder decisions in this workstream:**
  - "Don't worry about backward compatibility, there's no outstanding uses of
    this."
  - "I really like the paint objects. Let's use variables as scoping".
  - "we can probably retire p5 modes as part of this".

  The plan removes the modal methods and the mutable tier outright, with no
  deprecation period.
- **Pictures as values are deferred.** This interprets the boxholder's "The
  picture ones are pretty serious, especially those layout things".
- **engineering-principles.md §8, "One way to do each thing":**
  - one sketch form (TEA);
  - one way to style a call;
  - one transform scope (`at`).

  `group` and `clip` keep their different jobs: compositing and clipping.
- **§3, "Validate at boundaries":** each style is checked where the Painter
  receives it.
- **§4, "never silent":** a call that cannot draw anything (a fill-only
  `line`) logs a message in both runtimes.
- **Boxholder memory, "minimize invented concepts":** a style is a plain
  object literal. There is no constructor, registry or class.

## What already exists

- **Modal style state:** `src/core/painter/style.ts:5-40` (`StyleState`), with
  defaults in `initialStyle` (`style.ts:25-41`) and the `StyledPainter`
  setters (`style.ts:52-106`). **Remove.** A resolved style per call replaces
  it.
- **Push/pop, style stack and callback floor:** `src/core/painter/core.ts:94-106`
  (`push`: `this.ctx.save(); this.#styleStack.push({ ...this.style })`). `#onLayer`
  restores style and unwinds unmatched pushes (`core.ts:186-212`).
  **Remove the style half.** With no modal style there is nothing to snapshot.
  The ctx save/restore stays inside `at`, `group`, `clip`, `cache` and `sprite`.
- **Modal state consumers** (found with `grep this.style. / this.composite()`
  in `src/core/painter/`):
  - shapes, through `paintShape` → `#fillAndStroke`/`#strokeShape`
    (`core.ts:284-361`);
  - text (`engine.ts:141-186`);
  - the cache paste (`core.ts:224`);
  - `image` (`core.ts:252-255`).

  Each one takes a resolved style below.
- **Groups composite through a layer:** `core.ts:176-183`. **Keep as is.**
- **Per-call text styling already exists:** `text(s, box, options)` with
  `size`, `font`, `style`, `fill` (commit 782d90536, `engine.ts` `#boxText`).
  **Reuse** as the only text form, with a native single-line path.
- **The headless `Sketch`** (`src/headless/sketch.ts`) is both the mutable
  API and the canvas owner that `TeaView` draws through (`readPixels`,
  `debugBox`, `finishFrame`). **Rebuild** as a TEA-only surface (canvas,
  Painter, recorder hooks) with no drawing API of its own.
- **Byte-identical renders per runtime** (README, "deterministic"). **Reuse**
  as the migration gate. `cli diff` reports differing regions.
- **`Paint`** (`src/core/paint.ts:269`, "a CSS color string or a gradient
  handle") stays the colour value. The new bundle is `Style`, which avoids
  the name collision.

## Prior art (external)

- **Skia `SkPaint`**, one value passed to each `SkCanvas::draw*`:
  https://api.skia.org/classSkPaint.html. Evaluated-only.
- **Flutter `Canvas.drawCircle(center, radius, Paint paint)`**:
  https://api.flutter.dev/flutter/dart-ui/Canvas-class.html. Evaluated-only.
- **Elm `collage` and Haskell `gloss`** (pictures as values): deferred.
  Evaluated-only.

Nothing is copied, so ACKNOWLEDGEMENTS.md does not change.

## Ontology

- **Style** (new, `src/core/paint.ts`): a plain readonly object describing how
  one call paints.
  - Keys: `fill?`, `stroke?`, `weight?`, `brush?`, `gesture?`, `blend?`,
    `erase?`.
  - It is not stateful.
  - Points at Paint, Brush and Gesture.
- **ResolvedStyle** (new, internal to `src/core/painter/`): a Style with every
  default filled in. It replaces `StyleState`, and only the Painter sees it.
- **Paint** (exists, `paint.ts:269`): a colour string or gradient handle.
- **Brush**, **BrushName**, **BrushOverrides** (exist, `src/core/brush/`).
  `Style.brush` is a `BrushName` or a `Brush`. `v.brushOf(name, overrides)`
  builds a `Brush`.
- **TextOptions** (exists, `paint.ts`): layout keys plus text styling. It
  gains `blend`, `erase` and `valign: "baseline"`.
- **GroupOptions** (exists, `paint.ts:260`, `{opacity?, blend?}`):
  unchanged.
- **AtOptions** (new): `{ translate?, rotate?, scale? }`.
- **Removed:** `SketchModule`, the mutable `Sketch` API, `run` (the mutable
  runtime), the mutable event dispatch.

## Tracks / scope

### Track A: stateless Painter and `Style` per call

- **What:** every drawing call takes its style explicitly. Transforms get a
  scope of their own. The Painter keeps no style state.
- **Why this needs to change:** a helper that sets `textAlign("center")` and
  returns changes every later caller's text. The periodic-trends agent hit
  exactly this in the d3 comparison ("text-state leaks"). The boxholder: "I do
  dislike the modal nature of p5 like in the text leak."
- **Direction:**
  ```ts
  interface Style {
    readonly fill?: Paint;
    readonly stroke?: Paint;
    readonly weight?: number;            // stroke width; default 1
    readonly brush?: BrushName | Brush;
    readonly gesture?: Gesture;
    readonly blend?: BlendMode;          // default "normal"
    readonly erase?: boolean;
  }
  v.rect(x, y, w, h, style)
  v.roundRect(x, y, w, h, radius, style)  // replaces rect's 5th radius argument
  v.circle(x, y, d, style); v.ellipse(x, y, w, h, style)
  v.line(x1, y1, x2, y2, style); v.triangle(…, style); v.arc(…, style)
  v.polygon(points, style); v.path(commands, style)
  v.curve(points, closed, style)
  v.text(s, {x, y, w?, h?}, options)
  v.textWidth(s, options)
  v.at({ translate?: [x, y], rotate?: radians, scale?: number | [sx, sy] }, body)
  v.image(sprite, x, y, { opacity?, blend?, erase? })
  v.cache(key, body, { blend?, erase? })
  v.brushOf(name, overrides): Brush
  ```
  **Two scopes, two jobs.**
  - `at` only transforms. It wraps `body` in `ctx.save()`, the transform,
    and `ctx.restore()` in a `finally`. It takes no layer. Erasing inside
    `at` erases the canvas beneath.
  - `group({opacity, blend}, body)` stays as it is (`core.ts:171-182`). It
    is always on its own layer, so erasing inside a group erases only the
    group, at any opacity.
  - `clip(shape, body)` stays as it is.

  **Defaults:**
  - **Shapes:** no fill, no stroke, weight 1, no brush, gesture `{}`, blend
    `"normal"`, no erase.
  - **Text:** size 12, font `"sans-serif"`, style `"normal"`, fill
    `"#000000"`, align `"left"`, valign `"top"`.

  **Single-line text keeps the old drawing path.** Text with no `w` and no
  `"\n"` draws with the context's own alignment:
  - `align` sets `textAlign`;
  - `valign` top/middle/bottom/baseline sets `textBaseline`
    top/middle/bottom/alphabetic;
  - one `fillText` at `(x, y)`.

  This is exactly what the old point form drew. Other text uses the box
  layout.

  **Diagnostics:** a pure function `styleProblem(kind, style)` returns a
  message when a call cannot draw anything:
  - an open shape (`line`, an open `curve`) with no stroke;
  - a closed shape with neither fill nor stroke.

  Both runtimes log each distinct message once: headless to the transcript,
  browser through `log`. Neither reads pixels.

  **Validation** (`assertStyle`, at the Painter boundary):
  - `weight` is finite and ≥ 0;
  - `brush` is a known preset name;
  - no unknown keys.

  Errors name the call and the key, e.g. `circle: style.weight must be ≥ 0
  (got -2)`.

  **Removed from `View`:**
  - styles: `fill`, `noFill`, `stroke`, `noStroke`, `strokeWeight`, `brush`,
    `noBrush`, `gesture`, `blendMode`, `erase`, `noErase`;
  - text: `textSize`, `textAlign`, `textFont`, `textStyle`;
  - transforms: `push`, `pop`, `translate`, `rotate`, `scale`.
- **Vocabulary lock-ins:**
  - `Style` and its seven keys;
  - `at` and its three keys;
  - the names `roundRect` and `brushOf`;
  - style as the last required argument.
- **First implementation chunk:** capture the baselines (Implementation order,
  step 0). Then add `Style`, `ResolvedStyle`, the defaults, `assertStyle`,
  `styleProblem`, and a resolved-style parameter through `paintShape`, text,
  `cache` and `image`. The modal setters build a `ResolvedStyle` from their
  state for now, so no caller changes. **Done when** all existing tests and
  `gallery check` pass unchanged.

### Track B: retire the mutable tier

- **What:** remove `setup`/`draw(s)` sketch modules and their runtime. TEA is
  the only sketch form.
- **Why:** two tiers means two APIs over one Painter. The boxholder: "I feel
  confident we won't go back to them, only forward."
- **Direction:**
  - **Remove:** the mutable API in `src/headless/sketch.ts`,
    `src/headless/runtime.ts`, the mutable branch of `src/headless/events.ts`,
    the `SketchModule` type, the CLI and gallery branches that detect a
    mutable module, and their exports.
  - **Keep, renamed:** `sketch.ts` becomes the TEA runtime's surface: the
    canvas, the Painter, `readPixels`, `debugBox`, `finishFrame` and the
    recorder hooks. It moves into `tea-runtime`'s unit, following the
    layout-check rules.
  - **Tests:** library tests that use `new Sketch()` as a harness move to a
    small TEA harness in `test/helpers.ts` that gives a `View` over a fresh
    canvas.
  - **Loader errors:** a module with `setup` gets a loader error naming the TEA
    form.
- **Vocabulary lock-ins:** none new; names are removed.
- **First implementation chunk:** the TEA test harness, and the move of the
  primitive and brush tests onto it, while `Sketch` still exists.

### Track C: migrate the gallery and examples

- **What:** rewrite the 13 TEA gallery sketches and 3 TEA examples to the new
  API, and convert the 11 mutable gallery sketches and the mutable examples
  (`bounce.ts`, `brushes.ts`, `alien-reference.ts`) to TEA.
- **Why:** `gallery check` runs every entry. The mutable alien and open
  rounds are the brush engine's regression set.
- **Direction:** one worker per sketch, using a mid-tier model, against the
  baselines from step 0.
  - **Gate:** every captured frame is byte-identical to its baseline. A
    worker fixes any difference, unless it shows the difference in a zoom crop
    and the driver accepts it in writing.
  - **Expected exception:** `alien-scene-opus-b` calls `random()` 14 times.
    TEA `draw` has no random source, so its values move into the model, and
    its frames may differ.
  - **Inherited state:** the worker traces state that helpers inherit. For
    example, `pell-anim`'s `litShape` sets a fill outside a group and relies
    on it inside.
  - **Records:** `history/` and `runs.jsonl` stay as written. `meta.yaml`
    notes that the code was migrated mechanically after the run.
- **First implementation chunk:** three pilots by hand:
  - `clock` (top and middle text baselines);
  - `pell-anim` (helper-heavy);
  - `alien-curve` (mutable to TEA).

  These shape the workers' brief.

## Could this be simpler?

- **Simplest version:** optional style arguments beside the setters (see
  *Smallest fix*). It fails the reported case: a helper's
  `textAlign("center")` still leaks into the caller's next text.
- **Keep the mutable tier as an adapter.** The first draft did this. It keeps
  `StyleState`, `push`/`pop` and the style floor alive for one tier. The
  boxholder chose one form. Removing the tier also removes that state
  machinery, so the Painter gets simpler while the plan gets longer.
- **Delete the mutable gallery entries instead of converting them.** They are
  the brush regression set; their exhibits survive either way. Converting
  them costs worker time, not design.
- **Keep `translate`/`push`/`pop`.** Transforms leak the same way styles do.
  `at` is small and does not touch compositing.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A fill-only style on `line`, or an empty style on a shape | new: `styleProblem` table test | logged in both runtimes | clear |
| `weight: -2`, `brush: "inc"`, `{ color: "red" }` | new: `assertStyle` tests | throws SketchUsageError at the call | clear |
| `at` leaks its transform after `body` throws | new: throw-inside-`at` test | `try`/`finally` restore | clear |
| Erase or a gradient mark inside a rotated `at` (napi quadrant bug, CHANGELOG "Erase and gradient marks under transforms") | `sketch.erase-transform.test.ts`, moved to the TEA harness | `#viaLayer` | clear |
| Single-line text drifts from the old point form | baselines (clock, periodic-trends) | native `fillText` path | clear (gate) |
| A cache hit ignores paste options | new: cached paste with `erase` | — | silent without the test |
| A migration worker changes a picture | byte compare against the step 0 baselines | the report lists every accepted difference | clear |
| A test's coverage is lost when it moves off `Sketch` | test count and names compared before and after in step 3's report | — | clear |
| A mutable module is loaded after the retirement | new: loader test | loader error naming the TEA form | clear |

No critical gaps.

## Agent-flow / user-flow edge cases

- **Wrong field:** an agent writes `{ color: "red" }`. ADDRESSED: TypeScript
  rejects the excess key in a literal, and `assertStyle` rejects unknown keys
  at runtime.
- **Old API by habit:** `v.fill("red")`, or a `setup` export. ADDRESSED:
  - `v.fill("red")` is a type error;
  - a `setup` export gets the loader error;
  - canvas-loop's AGENTS.md is rewritten.
- **`stroke` without `weight`:** the default is 1, the same as today's
  `strokeW: 1` (`style.ts:31`).
- **Stale ref, two writers, hand-edit drift, fabricated value:** not
  applicable; no stored records change.
- **Transition state:** ADDRESSED. The steps run in this order:
  1. New `View` signatures land beside the old ones.
  2. All sketches migrate.
  3. The modal methods and the mutable tier are removed.

  Every step builds, and `gallery check` passes throughout.

## NOT in scope

- **Folding `clip` into a scope option.** Union clips use a backdrop and mask
  layer (`core.ts:155-168`, `layers.ts:37-69`), which is not a plain
  `ctx.clip()`. Consolidating them needs its own design.
- **The scripted `type` event.** A separate small change.
- **Pictures as values, or a recorded display list for hit testing.**
  Deferred.
- **The React figure and the playground placing `v.control` inputs.**
  An unrelated follow-up.
- **Rich text runs** (subscripts, mixed weights).
- **Object-shaped primitive arguments** (`rect({x, y, w, h}, style)`).
  Positional arguments stay to keep the migration mechanical.

## Open design questions

- **`at` and `group` as two scopes.** This follows the review's main finding:
  transform scoping and compositing isolation behave differently. The
  boxholder can still merge them, at the price of erase behaving differently
  depending on opacity. Lean: keep two.

## Knowledge audits

Skipped: canvas-loop guidance is loaded by dev-repo agents writing sketches,
not by box agents. The check for the guidance is the acceptance exercise
below.

## What will hold this after it ships

- **Unit tests:**
  - `assertStyle`;
  - the `styleProblem` table;
  - `at` restores after a throw;
  - erase in a rotated `at`;
  - a cached paste with `erase`;
  - single-line text through the native path;
  - the mutable-module loader error.
- **`gallery check`** runs every entry for determinism and lint.
- **Acceptance exercise:** one fresh Opus agent writes a sketch.
  - Its brief is a labelled diagram with a brushed illustration.
  - It gets only canvas-loop's AGENTS.md and TEA.md.
  - It must finish with no style-leak bugs, and it reports what it found
    awkward.

  This repeats the drawing rounds this workstream already runs.

## Implementation order

0. **Baselines:** render every gallery entry (TEA and mutable) and every
   example at HEAD with their events files, seed and frame count. Store the
   frames under `scratch/styles-baseline/<entry>/`.
1. **Resolved style inside the Painter** (Track A, first chunk). No caller
   changes.
2. **New `View` signatures beside the old ones** in `tea.ts`, `TeaView` and
   `BrowserView`: style arguments, `at`, `roundRect`, `brushOf`, text defaults
   and the native single-line path, paste options, diagnostics.
3. **TEA test harness;** move library tests off `Sketch` (Track B, first
   chunk).
4. **Track C:** the pilots, then parallel workers, each gated on the baselines.
5. **Remove:** the modal `View` methods, the mutable tier (Track B), and the
   Painter's `StyleState`, setters, style stack and floor.
6. **Docs:** TEA.md, README.md, BRUSHES.md, canvas-loop AGENTS.md,
   CHANGELOG.md.
7. **Acceptance exercise and cross-model review** of the branch diff.

## Rollout shape

- **Tests first:**
  - `test/core/paint.style.test.ts` (`assertStyle`, `styleProblem`);
  - `test/headless/tea-view.style.test.ts` (`at`, paste options, native
    single-line text).
- **Done when:**
  - those tests pass, plus `pnpm typecheck`, `pnpm lint` and `layout-check`;
  - every migrated entry is byte-identical to its baseline, or has a written,
    accepted difference;
  - `gallery check` passes;
  - no `setup`/`Sketch` drawing API remains;
  - the acceptance agent's sketch has no state-leak bugs.
- **Migration:** done by agents, one sketch per worker, in the worktree.
  There is no stored data and no deploy.
