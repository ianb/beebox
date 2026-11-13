---
title: "canvas-loop: text params, text measurement in update, radii for round shapes"
status: implemented
workstream: canvas-brushes
issues: []
---
# canvas-loop: text params, text measurement in update, radii for round shapes

The courseware box ported 16 chemistry widgets to canvas-loop figures and
reported what was hard (box feedback cards "Figure porting difficulties" and
"canvas-loop has no text param"). The boxholder picked three things to fix,
breaking compatibility where needed:

1. Text input should work: a `text` param with a native input.
2. `v.circle` takes a diameter while `v.arc` takes a radius. Pick one.
3. `update` should be able to measure text, through a throw-away canvas, with a cache.

The same pass fixes the two box-doc errors and the cheap doc gaps the review of
that feedback found.

**Issues addressed:** none filed. `issues/` searched for "text param",
"circle diameter", "textWidth": nothing.

## Design

No design section: this changes the sketch API that box agents write against.
What a learner sees changes only in that a figure can now show a real text box.

## Smallest fix and budget

- Smallest fix for (1): a `text` param type end to end (declaration, validation,
  panel and overlay inputs, headless stand-in, events files, beebox card mapping).
  About 250 source lines and 120 test lines across canvas-loop and beebox.
- Smallest fix for (2): change `circle`'s third argument to a radius. Chosen:
  also change `ellipse` and `ellipseGradient` to radii, so every centre-based
  round shape takes radii (`arc` and `radialGradient` already do). About 15
  engine lines plus a scripted rewrite of every call (about 500 call sites in
  sketches, examples, tests and beebox starters; generated, reported separately).
- Smallest fix for (3): `u.textWidth` and `u.textBounds`, sharing the painter's
  layout code and one cached measuring context. About 150 source lines and 60
  test lines.
- Docs: TEA.md, BRUSHES.md examples, beebox `figure.ts` instructions,
  agent-changes.md. About 120 lines.

Total hand-written is about 800 lines; with the generated call-site rewrite about
1,800. Not a BIG CHANGE.

## Stated preferences this plan trades against

- The boxholder: "Break compat if necessary." The radius change breaks silently:
  an old `v.circle(x, y, 20, …)` draws a circle twice as big. No signature
  trick can detect that. Handled by rewriting every call in the repo, an
  agent-changes entry box agents read, and an offer to the boxholder to rewrite
  box figures.
- Engineering principle: one convention. Canvas2D (`arc`, `ellipse`), SVG
  (`r`, `rx`, `ry`) and d3 all use radii for centre-based shapes; only p5 uses
  diameters, and canvas-loop already mixes both. Radii everywhere is the one
  rule an agent can hold.
- `update` stays pure: measuring text reads no drawing state and gives the same
  answer for the same input, so replay holds.

## What already exists

- Param kinds: `ParamDecl = NumberParam | BooleanParam | SelectParam | TriggerParam` (`canvas-loop/src/core/tea.ts:81`). Reuse; add `TextParam`.
- `Msg.param.value` already allows strings (`tea.ts:131`).
- One validation point for all param doors: `checkParam` (`src/browser/param-validate.ts`). Extend.
- One declaration→control mapping shared by DOM, React and headless: `controlModels` (`src/browser/controls-model.ts`). Extend with a `text` kind.
- DOM inputs, panel and over-canvas overlay: `src/browser/controls.ts` (`bareInput`, `controlFor`, `ControlOverlay`). Extend.
- React panel: `src/react/SketchFigure/figure/ParamControls.tsx`. Add a `TextRow`.
- Headless stand-in drawing: `drawStandIn` in `src/headless/tea-view.ts`. Extend: value, or a grey placeholder.
- Headless declaration parsing `parseParamKind` (`src/headless/tea-load.ts`) and events validation `validateParamValue` (`src/headless/tea-events.ts`). Extend.
- Keyboard msgs come only from the canvas element (`src/browser/mount.ts:386`, `canvas.addEventListener("keydown", …)`), and overlay inputs are siblings in the stage, so typing in a text input does not reach `update` as key msgs. No change needed.
- beebox: card `string` maps to module `select` (`beebox/src/frontend/src/lib/figure-canvas-loop.ts:28`, `MODULE_TYPE_FOR`). Change to accept `select` or `text`. `bbx figure run` passes an unknown-type override as its raw string (`beebox/src/cli/commands/figure/run-one.ts`, "else out[name] = raw"), which is what a text param needs.
- Activity: a param change becomes `set <name> = <value>` explored activity (capped at 200 characters), and a newer `explored` detail overwrites the older one (`beebox/src/core/chat/card-activity.ts:20`). Activity is a hint, not the full answer. No change.
- Text layout: the painter's private `#layText` / `#placeText` / `#insideShift` (`src/core/painter/engine.ts:170-240`) with `layoutText` (shared). Extract the measuring and placement into a module both `View` and `Util` use.
- Shapes: `circle` calls `ellipse(x, y, d, d)`; `ellipse` halves `w`, `h` (`engine.ts:88-98`). `ellipseGradient(x, y, w, h, stops)` (`src/core/paint.ts:271`).

## Prior art (external)

- Canvas2D `ellipse(x, y, radiusX, radiusY, …)` and `arc(x, y, radius, …)`; SVG `<circle r>`, `<ellipse rx ry>`. Evaluated-only: the convention adopted.
- p5 `circle(x, y, d)`: the convention left.
- No decision depends on other external premises.

## Ontology

- **text param** (new): `{ type: "text", default: string, placeholder?: string, multiline?: boolean, maxLength?: number }` plus the shared `label`, `hint`, `panel`. Its value is a string, empty allowed. NOT a select (no option list) and NOT a number field.
- **ControlModel `text` kind** (new, `controls-model.ts`): `{ kind: "text", value, placeholder, multiline, maxLength }`.
- **text measurer** (new): one cached `measureText` over a throw-away canvas context. Identified by the process (headless) or the page (browser). Not a View.
- `u.textWidth`, `u.textBounds` (new on `Util`): the same signatures and results as `v.textWidth`, `v.textBounds`, with no transform (update has none).
- circle, ellipse, ellipseGradient: arguments renamed to `radius`, `rx`, `ry`.

## Tracks / scope

### Track A: text params

- What: a fifth param type.
- Why: typed formulas, answers and predictions had to be drawn keypads or link-only factories.
- Direction:
  - `TextParam` in `tea.ts`; `ParamValue` gives `string`.
  - `checkParam`: a string; longer than `maxLength` is rejected with a reason (initial override falls back to the default with a warning, as other kinds do).
  - Browser: `<input type="text">`, or `<textarea>` with `multiline`; `placeholder`, `maxlength` attributes; sends on every `input` event (empty included). The overlay's `show` skips a focused input, as now.
  - React `TextRow`.
  - Headless stand-in: the value, or the placeholder in grey; multiline wraps.
  - `tea-load` parses it; `tea-events` validates `{ "type": "param", "name", "value": "…" }`.
  - beebox: card `string` maps to module `select` or `text`; `figure.ts` instructions document it.
- Vocabulary lock-ins: `type: "text"`, `placeholder`, `multiline`, `maxLength`.
- First chunk: core type, validation, controls model, DOM input, headless stand-in and events, tests.

### Track B: text measurement in `update`

- What: `u.textWidth(content, options?)` and `u.textBounds(content, box, options?)`.
- Why: hit areas under wrapped text and tiles sized to their labels sat on guessed constants.
- Direction:
  - Move `#layText` and `#insideShift` out of the painter into `src/core/painter/text-layout.ts`, as functions taking a `measure(text, font)`, the canvas size and a transform.
  - `TextMeasurer`: makes its context lazily from a factory (`@napi-rs/canvas` `createCanvas(1, 1)` headless; `document.createElement("canvas")` in the browser), caches widths in a `Map` keyed by font and text, cleared when it passes 10,000 entries.
  - The painter measures through the same measurer, so `u.` and `v.` agree exactly.
  - `Util` passes the identity transform, so `keepInside` works as it does for text drawn without `v.at`.
- First chunk: extract, painter switched, gallery check unchanged, then the `Util` methods and tests.

### Track C: radii

- What: `circle(x, y, radius, style)`, `ellipse(x, y, rx, ry, style)`, `ellipseGradient(x, y, rx, ry, stops)`.
- Direction: change the engine, then a one-off TypeScript-AST script rewrites each call's size arguments: a literal is halved, `2 * e` or `e * 2` becomes `e`, anything else becomes `(e) / 2`. Every rewrite is exact, so the gallery check (pixel-identical renders) proves the rewrite. History `.txt` files in the gallery are records, not code, and stay.
- First chunk: engine and script, run over canvas-loop and beebox, gallery check.

## Could this be simpler?

- Text param: the simplest version is a panel-only text box. It fails the box's
  main case, an answer box placed in the figure. The overlay is the existing
  mechanism, so adding the kind there costs one more `case`.
- Radii: changing only `circle` is smaller, but `ellipse(x, y, w, h)` would
  then be the one round shape that takes a size, and the rule would again need
  an exception. The extra cost is mechanical.
- Measurement: `Util` could hold its own measuring code. Sharing the painter's
  layout is what makes `u.textBounds` equal to what `v.text` then draws.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| An old box figure calls `v.circle(x, y, 40)` meaning a diameter | no (cannot be detected) | agent-changes entry; offer to rewrite box figures | silent: the circle is twice as big |
| A link gives a text param longer than `maxLength` | to add | default used, warning | console warning |
| An events file gives a number for a text param | to add | `EventScriptError` | clear |
| `u.textWidth` before the browser has loaded a web font | no | none: same as `v.textWidth` today | silent: a slightly different width; the next update measures again (cache keyed by font string, so a stale width can stay cached) |
| Rewrite script misses a call written through a variable (`const c = v.circle; c(…)`) | gallery check | typecheck does not catch it | silent; grep after the run |
| Cache grows without bound on generated text | to add | clears at 10,000 | n/a |

> **Accepted risk:** the web-font case. canvas-loop figures use system font
> stacks; no sketch in the repo loads a web font. Documented in TEA.md.

> **Accepted risk:** silent size change for box figures not in the repo. The
> boxholder asked for the break; the agent-changes entry tells box agents.

## Agent-flow / user-flow edge cases

- Wrong field: an agent uses `select` for free text. ADDRESSED by docs (TEA.md params table says when to use `text`).
- Hand-edit drift: an agent writes `v.circle(x, y, d)` from p5 memory. GAP that only docs address; the TEA.md signature names `radius`.
- Validation error UX: `checkParam` reasons read "… is longer than maxLength 40".
- Partial migration: repo rewritten in one commit; box figures stay old until their agents act.

## NOT in scope

- Rich text runs, cap/join, `u.setParam`, effects from `update`, dispatch handle, inline embeds, factory-aware `bbx figure run`: separate requests in the same feedback; not picked.
- A runtime warning for "circle looks like a diameter": no reliable signal.
- Debouncing text param activity: the activity log already keeps only the latest.

## Open design questions

None.

## Knowledge audits

Skip: no new box concept; the changes are API details in canvas-loop.md, and
agent-changes.md carries the break.

## What will hold this after it ships

- Unit tests in canvas-loop `test/` for `checkParam`, `controlModels`, events parsing, headless stand-in, and `u.textBounds` equal to `v.textBounds`.
- The gallery check holds the radius rewrite and the painter's switch to the shared measurer (all renders pixel-identical).
- beebox `figure-canvas-loop.test.ts` for the `string`→`text` mapping.
- A browser check in the playground and a figure for the real `<input>`.

## Implementation order

1. Track C engine and rewrite script; gallery check; commit.
2. Track B extract and painter switch; gallery check; `Util` methods and tests; commit.
3. Track A canvas-loop; tests; React row; commit.
4. beebox mapping, `figure.ts` instructions (and the two doc errors), TEA.md, BRUSHES.md, agent-changes.md, CHANGELOG; commit.
5. A playground example using a text param and `u.textBounds`; browser check.

## Rollout shape

Tests as listed. Done when canvas-loop tests, lint, typecheck and gallery check
pass, beebox typecheck, layout-check and the figure tests pass, and a text
input works in a browser figure. No data migration; box figures are the
boxholder's call.

## Plan review (codex gpt-6-sol) and decisions

1. React `TextRow` must keep a local draft updated on every keystroke, as the number `FieldRow` does (`canvas-loop/src/react/SketchFigure/figure/ParamControls.tsx:20`); otherwise the runtime's later echo reverts typing. Accepted.
2. Events-file text values go through `checkParam`, so `maxLength` holds headless as in the browser. Accepted.
3. The measurement cache would keep fallback-font widths after a web font loads; the runtime already redraws on font load (`canvas-loop/src/browser/runtime/engine.ts`, `watchVisibility`). Accepted: clear the measurer's cache there. Widths a sketch stored in its model stay as they were; TEA.md says to measure when needed rather than store widths.
4. "Same input, same answer" holds within one font environment only; headless and a browser can measure the same font differently, as they already draw it differently. Accepted as a doc statement; no cross-runtime guarantee.
5. Narrow the radius change to `circle` only. Declined: the boxholder asked whether mixing diameter and radius is proper design; `ellipse(w, h)` beside `arc(radius)` is the same mix. The extra call sites are rewritten by script and checked pixel for pixel.
6. The activity claim was too strong: the latest explored event wins, so a later handled press replaces the typed text, and details cap at 200 characters. Accepted: activity is a hint; no change to activity.

## Code review (codex gpt-6-sol), two rounds

- Fixed: a controlled React text box kept a stale draft; it now takes any value that is not an echo of its own typing (test in `canvas-loop/test/react-client.test.tsx`, checked to fail without the fix).
- Fixed: an over-canvas textarea's minimum height overrode its placed box.
- Fixed: BRUSHES.md described `ellipseGradient` with width and height.
- Fixed along the way: canvas-loop `pnpm test` skipped the two `.tsx` React test files (Node's default pattern); it now runs them.
- Accepted risk: a host that sets the text to a value the person typed a moment earlier, while that keystroke's echo is still pending, is read as an echo, and the box keeps the newer typing. Telling the two apart needs an edit id carried through `onParamsChange` and `params`; no host does this today.
