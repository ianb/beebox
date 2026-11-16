---
title: "canvas-loop: layout boxes, text runs and named hits"
status: active
workstream: canvas-brushes
issues: []
---
# canvas-loop: layout boxes, text runs and named hits

A subplan of [canvas-brushes.md](canvas-brushes.md). It adds three things to
canvas-loop's returned-drawing API: a way to measure any drawing and to lay
drawings out in a row or a column; text made of runs, so that a subscript or
a superscript measures and draws as one text; and names on drawings, so that
a pointer message says which named drawing is under the pointer. A box agent
that moved 18 chemistry figures to the returned-drawing API asked for all
three.

**Issues addressed:** none filed. Searched `issues/` (open and closed) for
`hit test`, `hittest`, `subscript`, `superscript`, `rich text`, `v.bounds`,
`flow layout` and `textBounds`: no canvas-loop item matches (the hits were
unrelated words in other features).

## Design

No design section: canvas-loop is a developer library, and these are API
additions for the agents that write figures. What a learner sees of a figure
does not change. The audience is the agent; "Agent-flow" below covers it.

## Smallest fix and budget

**Source of the request** (a box agent's report after migrating 18 chemistry
figures; paraphrased, the box is private):

1. Helpers that drew and returned a measurement now split into a draw
   function plus a measure function that must agree; stacked text repeats its
   options into `v.textBounds`; running layout needs a mutable cursor in a
   `.map` or the discouraged push form.
2. Subscripted formulas and raised exponents are drawn piece by piece with
   matching width functions.
3. Almost every figure has a layout function that `update` calls (to find
   what was clicked) and `draw` calls (to draw it there).

**Boxholder decisions (2026-11-16):** measure/layout "Seems fixable, yes";
rich text "That would be helpful for our uses, but might be kind of
extensive"; named hits "Yes, this seems important".

**Approved (2026-11-16, boxholder: "okay, make those changes" to the full
~2,150-line scope).** This is the BIG CHANGE approval for everything in the
table below: Tracks A, B (with scripted aim and the host's activity detail),
C, and the example sketch. Click timing is accepted as planned: a click
resolves against the last recorded frame, for determinism (Failure modes,
"presentation delay"). The courseware box prompt is written at finish as a
deliverable text in this plan ("Courseware box prompt" below); nothing is
sent.

**Smallest fix per problem:**

- Measure: `v.bounds(drawing)` alone, no flow layout. It removes the second
  measure function; it does not remove the cursor.
- Text runs: no code. Unicode has subscript and superscript digits (`H₂O`,
  `10⁻³`). Rejected as the answer, by a probe of the headless rasteriser
  (`scratch/layout-text-hits-plan/glyph-probe.ts`, output beside it):
  in `sans-serif` and `serif`, `₂`, `₃`, `⁻` and `⁴` measure exactly as the
  missing-glyph mark U+10FFFD (width 18.00, ascent 15.00 at 24 px), so they
  draw as empty boxes headless; only Latin-1 `¹` and `³` have glyphs. Even
  where a font has them, only digits, a few letters and `+ − = ( )` exist,
  so a figure cannot write `k_obs` or an italic variable.
  The smallest real fix is therefore Track C below: one-line runs with
  `sub`, `sup` and `style`, one paint per call.
- Hits: names on drawings and `msg.target`/`msg.targets` resolved against the
  last frame's drawing (Track B core), with no scripted aiming by name and no
  host change.

**Chosen design and estimate** (changed lines, additions plus deletions; this
plan file and its review are not counted):

| Piece | Source | Tests | Docs | Total |
| --- | --- | --- | --- | --- |
| A. Layout boxes: `v.bounds`, `v.row`, `v.column` | ~370 | ~260 | ~70 | ~700 |
| B core. `name`; the hit walk; hit scene in both runtimes; `msg.target`/`msg.targets`; transcript `on …`; outline names | ~370 | ~290 | ~60 | ~720 |
| C. Text runs: `sub`, `sup`, `style`; one line; one paint per call | ~230 | ~150 | ~40 | ~420 |
| **Core of all three requests** | **~970** | **~700** | **~170** | **~1,840** |
| B extra 1. Scripted aim by name in events files | ~60 | ~40 | ~10 | ~110 |
| B extra 2. `EmittedEvent.targets` and the beebox host's activity detail | ~20 | ~25 | ~5 | ~50 |
| Example sketch and events file (`src/examples/`) | ~150 | (gallery check) | — | ~150 |
| **Everything** | **~1,200** | **~765** | **~185** | **~2,150** |

The core of all three requests is about 1,840 lines: under the BIG CHANGE
line. **Everything is about 2,150 lines: a BIG CHANGE, which needs the
boxholder's approval** (Open design questions 1). The existing approval on the
parent plan ("Big change is fine anywhere here", 2026-11-11, `canvas-brushes.md`,
"Smallest fix and budget") was given for the brush work; this plan does not
stretch it to new scope. Track C is separable: it needs only A1's baseline
measure, and A and B ship without it. What drives the size: the hit walk (one
point test per geometry kind under transforms, clips and placed pictures, plain
strokes through the renderer's own outlines) and the tests that pin each kind;
the text-run track touches the measurer, the text node, the glyph quads and the
`keepInside` re-layout. A per-run `fill` would add about 40 lines to the text
lowering (`gpu/lower.ts:245-256` emits one paint per line); it is left out
because no chemistry case needs it. The fuller rich text (wrapping across runs,
mixed families, inline drawings) would add roughly another 400–600 lines and is
not proposed (NOT in scope).

What the full plan buys over the smallest fix: `v.row`/`v.column` remove the
cursor (problem 1's third half); scripted aim by name (`"target": "pan-left"`
in an events file) removes the coordinate arithmetic TEA.md asks for today
(`canvas-loop/AGENTS.md`: *"compute click coordinates from the sketch's own
position math"*); the transcript names what each click landed on.

## Stated preferences this plan trades against

The boxholder's five principles for this library: agent DX; art that does not
look like lazy digital art; composability; speed for animation in the
browser; familiar APIs. "Don't worry about backward compatibility."

- **Agent DX.** Each feature removes a pair of functions that must agree
  (draw + measure, draw + hit). Named hits move the "what is under the
  pointer" question out of the sketch.
- **Familiar APIs.** Row/column options reuse `v.text`'s own `align`/`valign`
  names and meanings; `msg.target`/`msg.targets` follow the DOM's
  `event.target` and `composedPath()`; runs follow HTML `<sub>`/`<sup>`.
- **Speed.** A name must not cost a layer. `group` always draws into its own
  layer (`canvas-loop/src/gpu/lower.ts:162-171`, `#group` always calls
  `this.#job(...)` and then `this.#layer(...)`), so `name` goes on `at`,
  shapes, text and placements too, which add no layer. The hit walk runs on
  the CPU once per pointer message and skips subtrees that hold no name.
- **Composability.** `v.bounds` takes any drawing; `row`/`column` take any
  drawings and return one node, which can go in another row.
- **Minimal invented concepts** (boxholder memory). One new noun on drawings,
  `name`, which `group` already has (`canvas-loop/src/core/paint.ts:180-182`:
  *"Names the group in warnings, scene outlines and diffs; draws nothing."*).
  There is no separate `hit: true` flag: every name is a target.
- **No backward compatibility.** Mouse messages gain fields; text content
  widens to `string | TextRun[]`. Existing sketches compile unchanged, but
  this is not a goal.
- **Determinism** (`canvas-loop/README.md`, byte determinism per runtime). A
  target is a pure function of the scene and the point; the scene is a pure
  function of model and params. A replay recomputes it.

## What already exists

- **Nodes are plain data stamped with their frame.**
  `canvas-loop/src/scene/nodes.ts:194`: *"export type SceneNode = ShapeNode |
  BackgroundNode | AtNode | GroupNode | ClipNode | MaskNode | TextNode |
  PlaceNode | DebugNode | LightNode;"*. Each constructor returns a node with
  its geometry in the coordinates of its enclosing `at` scopes
  (`nodes.ts:3-4`). So a drawing can be measured when its constructor
  returns. Reuse.
- **Text is laid out at the call.** `canvas-loop/src/scene/recorder/text.ts:1-4`:
  *"laid out and measured … so `v.text` returns its bounds at once. The node
  keeps each glyph and its pen position"*. `TextNode` keeps `lines` of glyphs
  and pen positions but not its box (`nodes.ts:128-141`). Reuse; Track B adds
  the box to the node.
- **`textBounds` and `textWidth`** on `View` (`scene/recorder/view.ts:236-241`)
  and on `Util` (`headless/tea-util.ts:70-74`, `browser/runtime/browser-util.ts:65-69`),
  one measurer for both (`core/text/measure.ts:1-4`). Reuse.
- **A conservative ink box.** `scene/recorder/bounds.ts:1-6`: *"Conservative
  boxes around what a drawing can put on the canvas, for the off-canvas
  check … A box may be larger than the ink, never smaller"*. `shapeBox` pads
  by `5 * s.weight` for a miter join and `2 * s.weight` for a brush
  (`bounds.ts:80-83`); `geomBox` bounds a path by its control points
  (`bounds.ts:64-67`). Reuse `geomBox`'s rect/ellipse/arc/poly cases and
  `transformed` (`bounds.ts:39-42`); do not reuse `shapeBox` for layout (too
  large on purpose); bound paths by flattening (`scene/geometry/flatten.ts:111`,
  `polylines(g, scale)`).
- **Matrix helpers.** `scene/mat.ts:35` `invert`, `:46` `maxScale`, plus
  `apply`/`mul`/`matrixOf` (`view.ts:21`). Reuse.
- **Child lists.** `scene/recorder/children.ts:59-63` flattens children and
  calls `taken(x)`, which clears the node from testing mode's made-and-not-
  returned set. `v.bounds` needs the flattening without `taken`. Reuse with a
  flag.
- **The last scene is kept by both surfaces.** Headless:
  `headless/scene/surface.ts:121-125` (`this.#last = rec` after each `draw`).
  Browser: `browser/scene/surface.ts:140-149` (`this.#kept = rec`), kept for
  waking. Reuse as the hit scene.
- **The input path.** Headless: `headless/tea-runtime/runner.ts:157-172`,
  events of frame N dispatch, then the tick, then `draw`; `#toMsg` builds the
  mouse message (`runner.ts:254-262`). Browser: `browser/runtime/engine.ts:301-316`
  (`#flushPending`), `:331-339` (`#toMsg`), `:367-371` (`#draw`); pointer
  positions arrive in logical canvas pixels rounded to integers
  (`browser/canvas-dom.ts:100-105`). Extend both `#toMsg`s.
- **Engagement and activity.** `core/engagement.ts:39-50` (`describeInput`:
  *"`mousedown (297,288)`"*), `browser/runtime/engine-types.ts:28`
  (`EmittedEvent` with `handled`, `changed`, `activity`), and the beebox host
  `beebox/src/frontend/src/lib/figure-canvas-loop.ts:43-46` (*"pressed
  ${event.handled.join(", ")}"*). Extend.
- **`--scene` outlines.** `scene/outline.ts:123-129` prints a group's name;
  other nodes have none to print. Extend.
- **Events file.** `headless/tea-events.ts:7`: *"{ frame: number; type:
  "mousedown" | "mouseup" | "mousemove"; x?: number; y?: number }"*. Extend
  with `target`.
- **Fill rule.** The renderer fills with nonzero winding
  (`gpu/shader-draw.ts:5`: *"the exact covered area with nonzero winding"*).
  The hit test uses the same rule.
- **The pattern this replaces**, in the public gallery:
  `src/gallery/balance-reaction-2/draw-tea.ts:33-57` (`formulaWidth` and
  `drawFormula`, a mutable `x` and `out.push`), and
  `src/gallery/balance-reaction-2/layout-tea.ts:1-35` (*"Shared positions:
  `draw` paints with them and `update` hit-tests with them."*, `tallyRowAt`).
- **The glyph atlas keys each glyph by its CSS font.** `gpu/glyphs.ts:66`
  (*"`${key.font}\n${key.ch}\n…`"*); `gpu/text.ts:23` builds that font from
  the node's `style`, `size` and `family`. So a glyph in another size or
  style is just another key. Reuse for Track C.
- **Box agents read TEA.md.** `beebox/src/core/docs-gen/package-docs/canvas-loop-doc.ts:1-4`:
  *"canvas-loop's own drawing reference (TEA.md, BRUSHES.md), shipped as box
  docs"*. So the TEA.md changes are the box guidance.

## Prior art (external)

No decision depends on an external library's limits; these set familiar
names and semantics. All **evaluated only**; nothing is copied.

- **SVG `getBBox()`**: the shape only by default; `stroke`, `markers` and
  `clipped` are opt-in, and the box is in the element's own user space,
  without its own transform.
  https://developer.mozilla.org/en-US/docs/Web/API/SVGGraphicsElement/getBBox
  — `v.bounds` follows the "geometry, in the coordinates where you are" part,
  and includes half the stroke (see Ontology: layout box).
- **CSS flexbox / CSS 2.1 inline-block baseline**: row and column directions,
  `gap`, `align-items: baseline`; a box with no baseline aligns by its bottom
  edge (CSS 2.1 §10.8.1). Followed for `v.row({ valign: "baseline" })`.
- **DOM events**: `event.target` is the innermost element; `composedPath()`
  lists it and its ancestors, innermost first. Followed by `msg.target` and
  `msg.targets`.
- **Paper.js `project.hitTest(point, options)`**: returns one hit or null;
  options include `fill`, `stroke` ("taking into account the setting of
  stroke color and width") and `tolerance`.
  http://paperjs.org/reference/project/#hittest-point — the fill-and-stroke
  rule matches; no tolerance here (see Ontology: hit area).
- **Konva**: shapes take `name`/`id`; `listening: false` removes a node from
  hits, via a separate "hit graph" redrawn with `drawHit()`.
  https://konvajs.org/docs/events/Listen_for_Events.html — canvas-loop has
  no retained hit canvas; the scene is data, so the hit test walks it.
- **Canvas `TextMetrics.alphabeticBaseline`**: *"the distance from the
  horizontal line indicated by … textBaseline to the alphabetic baseline"*.
  https://developer.mozilla.org/en-US/docs/Web/API/TextMetrics/alphabeticBaseline
  — the sign convention is not stated on that page. `@napi-rs/canvas`
  declares the field (`node_modules/@napi-rs/canvas/index.d.ts:95`); the probe
  above measured `-18.625` from `textBaseline = "top"` and `-6.625` from
  `"middle"` for 24 px `sans-serif`, so headless reports a baseline below
  the reference line as negative. Track A's first chunk pins this with a
  test, and A3 checks the browser gives the same sign.
- **p5.js / Processing**: no hit testing and no layout; `textWidth`,
  `textAscent`. Nothing to follow beyond the existing `textWidth`.

## Ontology

Existing names kept: `Drawing`, `DrawingNode`, `SceneNode`, `Scene`,
`TextBounds`, `TextOptions`, `Style`, `AtOptions`, `GroupOptions`,
`PlaceOptions`, `Msg`, `EmittedEvent`, `TeaScriptEvent`, `u.handled`.

- **Layout box** (new; public type `Bounds`): `{ x, y, w, h, baseline }`, in
  the coordinates where the drawing is returned (inside the drawing's own
  `at` scopes, outside any scope around the call). `baseline` is a y or
  `null`. It is what layout needs, not the ink: shape geometry plus half the
  stroke weight; text's line boxes (exactly what `textBounds` gives); a
  placed picture's declared `width × height`. It is NOT the off-canvas
  check's ink box (`bounds.ts`, internal, padded for miters, brushes and
  effects). Rules per node:
  - shape: the tight box of its geometry (paths flattened, arcs by their
    swept part), grown by `weight / 2` when it has a stroke (plain or
    brushed). Miter spikes, brush wobble and effects (glow, blur, shadow,
    wash) are left out. An `erase` shape adds nothing.
  - text: `{x, y, w, h}` of its `TextBounds`; `baseline` is the first line's
    alphabetic baseline.
  - `at`: each child's box through the matrix, as the box around the four
    corners. `baseline` survives a translate or axis-aligned scale; any
    rotation or skew makes it `null`.
  - `group`, `clip`, `mask`: the children's union (a mask's body only),
    cut by the group's `clip` option or the clip shapes' box.
  - `place`: `(x, y)` to `(x + width, y + height)`.
  - `background`, `light`, `debugBox`, and `keepInside` text's later move:
    nothing (`background` ignores transforms, so it has no place in a
    layout).
  - A container's `baseline` is the first child's that has one, in order.
  - A drawing that draws nothing (`null`, `[]`, all of the above): `null`.
- **Flow** (new): `v.row(options, children)` and `v.column(options,
  children)` place each child by its layout box, in order, with `gap`
  between. It returns one `at` node with each child inside its own
  translating `at`. It is NOT a container that re-lays out later: the
  positions are fixed when it returns, from the boxes at that moment.
- **Name** (extends the existing group `name`): a non-empty string on a
  drawing (`Style.name`, `TextOptions.name`, `AtOptions.name`,
  `GroupOptions.name`, `PlaceOptions.name`, and the flow options). It
  draws nothing. It shows in warnings, `--scene` outlines and pointer
  messages. Not unique: two nodes may share a name (each placement of a
  picture repeats the names inside it).
- **Named node** (new term): a node with a name.
- **Hit scene** (new): the scene `draw` returns for the model and params as
  they stood at the end of frame N−1, for a message dispatched at frame N.
  Messages at frame 0 have none. It is a logical frame, not the GPU's
  presented image: in a browser, presentation is queued and asynchronous
  (`browser/scene/surface.ts:175-190`; a superseded scene is dropped, which
  bounds the queue, not the delay), so the image on screen can be older than
  the recorded scene. Usually that is one display frame; a slow GPU makes it
  longer, with no fixed bound. It is NOT the model `update`
  holds when a later message of the same frame arrives.
- **Hit area** (new): where a drawn node takes the pointer: a shape's fill
  (when it has a `fill`, at any alpha, `"transparent"` included) by nonzero
  winding, and its stroke (when it has a `stroke`): a plain stroke's own
  outline, caps, joins and dashes included, as the renderer builds it
  (`scene/geometry/stroke.ts:117` `dotRings`, `:126` `strokeRings`, dashes via
  `dash.ts`, as `gpu/shape-geometry.ts:37-45` does); a brushed stroke's band of
  `weight / 2` either side of its path, without wobble; text's line boxes; a `background`'s whole canvas (or a picture
  body's box); a `pixels` placement's box. Clips cut it; a group's `clip`
  option cuts it; a mask's artwork does not. Effects, wobble, opacity and
  `erase` shapes do not count (an `erase` shape has no hit area).
- **Target** (new; `msg.target: string | undefined`): the name of the
  innermost named node around the topmost hit area under the pointer, among
  hit areas inside some named node. Unnamed drawings are not candidates: a
  label drawn over a named pan does not hide the pan.
- **Targets** (new; `msg.targets: readonly string[]`): that node's name and
  the names of its named ancestors, innermost first, through placements into
  picture bodies. `msg.target === msg.targets[0]`. Empty when nothing named
  is under the pointer.
- **Scripted aim** (new): an events-file mouse entry with `"target":
  "pan-left"` and no `x`/`y`. The runtime aims at the centre of the layout
  box of the topmost hit area named so in the hit scene.
- **Text run** (new, Track C; type `TextRun`): `string | { text, sub?, sup?,
  style? }`. Text content becomes `string | readonly TextRun[]`. A run
  is NOT a node; the whole list is one text node with one box and one
  baseline.

## Tracks / scope

### A. Layout boxes: `v.bounds`, `v.row`, `v.column`

- **What:** measure any drawing; lay drawings out in a row or a column.
- **Why this needs to change:** today a helper that draws must have a twin
  that measures (`balance-reaction-2/draw-tea.ts:33-39` `formulaWidth` beside
  `:43-57` `drawFormula`), and placing pieces one after another needs a
  mutable cursor and `out.push`, which TEA.md asks agents not to write
  (`canvas-loop/TEA.md:145-148`: *"write `.map`, `&&` and components
  instead"*).
- **Direction:**

  ```ts
  interface Bounds { x: number; y: number; w: number; h: number; baseline: number | null }
  interface FlowOptions {
    x?: number; y?: number;               // default 0, 0
    gap?: number;                         // default 0
    align?: "left" | "center" | "right";  // as text: where x is
    valign?: "top" | "middle" | "bottom" | "baseline"; // as text: where y is
    name?: string;
  }
  v.bounds(drawing: Drawing): Bounds | null
  v.row(options: FlowOptions, children: Drawing): DrawingNode
  v.column(options: Omit<FlowOptions, "valign"> & { valign?: "top" | "middle" | "bottom" }, children: Drawing): DrawingNode
  ```

  - `row`: children left to right. `valign` aligns each child's box to the
    others and says what `y` is: `"top"` (default) tops at `y`; `"middle"`
    middles at `y`; `"bottom"` bottoms at `y`; `"baseline"` baselines at `y`,
    a child with no baseline by its bottom (CSS 2.1). `align` places the
    whole row about `x`: left edge, centre or right edge.
  - `column`: children top to bottom. `align` aligns each child to the
    others and says what `x` is; `valign` places the whole column about `y`.
    The column's baseline is its first child's.
  - Items are the children after the usual flattening
    (`children.ts:49-53`): every node is one item. A component that returns
    a list (an arrow as a line plus a head) is one item only when wrapped:
    `v.at({}, arrow(v))`. TEA.md says so beside the row example.
  - A child whose box is `null` takes no place and no gap.
  - Each child is placed by moving its box: `dx = cursor − box.x`, so a child
    drawn at its own `(0, 0)` or at `(240, 80)` lands the same.
  - The text baseline comes from the measurer: `TextMeasurer` gains
    `baselineGap(font, textBaseline)` from `measureText(…).alphabeticBaseline`
    (cached as widths are, `core/text/measure.ts:50-60`); `Ctx2D.measureText`'s
    type (`core/ctx2d.ts:91`) grows by that field. `TextNode` gains
    `baselineY`, its first line's alphabetic baseline (distinct from the
    existing string field `baseline`, the Canvas2D `textBaseline` mode).
  - `v.bounds` flattens its argument as a scope does but does not take the
    nodes: they must still be returned, and testing mode still warns for a
    node made and not returned. A node from an earlier frame is refused with
    the scope's message.
  - `v.bounds` is on `View` only. `update` does not need it once hits are
    named (Track B); `u.textBounds`/`u.textWidth` stay.

  Example (the scale's caption under two pans):

  ```ts
  v.column({ x: 300, y: 330, gap: 6, align: "center" }, [
    v.text("Left pan", { x: 0, y: 0 }, LABEL),
    v.row({ gap: 4, valign: "baseline" }, model.left.map((w) => v.text(`${w} g`, { x: 0, y: 0 }, SMALL))),
  ])
  ```
- **Vocabulary lock-ins:** `Bounds` (with `baseline: number | null`),
  `v.bounds`, `v.row`, `v.column`, `FlowOptions` with `x`, `y`, `gap`,
  `align`, `valign`, `name`. The layout-box rules above.
- **First implementation chunk (A1):** the layout box. `scene/recorder/layout-box.ts`
  with `layoutBox(nodes): Bounds | null` per the Ontology rules, the measurer's
  `baselineGap` with a test that pins `alphabeticBaseline`'s sign (headless;
  the browser half joins the existing browser test tier in A3), `TextNode`
  gains `baselineY`, `View.bounds`, `Children.list` gains a no-take mode, and
  tests: `v.bounds(v.text(s, box, o))` equals `v.textBounds(s, box, o)`'s
  `x, y, w, h` for one line, a wrapped box and `fit`; a rect with `weight: 4`
  grows by 2; an `ellipse` under `at({ rotate })`; a path with a bezier is
  bounded by its curve, not its control points; a `place` is its declared box;
  `null` for `[]`; a node made in an earlier frame throws.
- **As built (A1).** Logs are in `scratch/layout-text-hits/a1-*.log`.
  - **Layout box.** `scene/recorder/layout-box.ts` (`layoutBox(nodes)`) per
    the Ontology rules. Paths are flattened with `polylines(g, 1)`; rect,
    ellipse, arc and poly reuse `geomBox`, with corners ordered for a negative
    width or radius. A baseline survives an `at` whose matrix has no
    rotation or skew terms (`b` and `c` exactly 0).
  - **Measurer.** `TextMeasurer.baselineGap(font, textBaseline)` returns the
    distance down from the `textBaseline` line to the alphabetic baseline,
    `0 − measureText("H").alphabeticBaseline`, cached per font and mode and
    cleared with the widths. `test/core/text/measure.test.ts` pins the
    headless sign (positive from `top` and `middle`, 0 at `alphabetic`,
    negative from `bottom`).
  - **Deviation: `TextNode.box` lands here, not in B1.** The layout box of a
    text node needs its rectangle, and `layoutBox` is a pure function of
    nodes, so `recordText` sets `box` (the `TextBounds` rectangle) beside
    `baselineY`. The `keepInside` re-layout already calls `recordText`, so the
    resolved node carries the moved box; B1 has nothing left to add for `box`.
  - **`View.bounds`** uses `Children.look`, a no-take twin of `list` (a
    method, not a flag, because of the two-parameter cap). `Bounds` is in
    `core/paint.ts` beside `TextBounds`, re-exported from `core/tea.ts` and
    so from the package root. `SceneRecorder` is the only `View`; the browser
    runtime uses it too.
  - **Docs.** TEA.md gains a "Layout" section under "Drawing" (after
    "Scopes") with `v.bounds`, so the View-members doc test passes; A2 and A3
    add to it.
  - **Lines:** source 182, tests 154, docs 17 (353; plan ~700 for all of A).

### B. Named hits

- **What:** a `name` on any drawing; mouse messages carry the names under
  the pointer, resolved against the last drawn frame; events files can aim
  by name; transcripts and host events say what was hit.
- **Why this needs to change:** each interactive figure keeps a layout
  function that `update` and `draw` both call, and they must agree
  (`balance-reaction-2/layout-tea.ts:1`, `tallyRowAt` at `:32-35`, used by
  `sketch-tea.ts:62-66` `elementAt` on every `mousemove` and `mousedown`).
  A click on a moving target is "a calculation" (`TEA.md:689-691`), and a
  scripted click needs coordinates computed from the same math
  (`canvas-loop/AGENTS.md`, "Script interactions as events").
- **Direction:**

  ```ts
  // Msg (core/tea.ts:139-147), the three mouse variants:
  | { type: "mousedown"; x: number; y: number; target: string | undefined; targets: readonly string[] }
  // likewise mouseup, mousemove. Key messages are unchanged.

  // name on drawings:
  v.circle(x, y, 14, { fill: ATOM_FILL, name: `atom-${atom.id}` })
  v.text("Reset", box, { ...BUTTON, name: "reset" })
  v.at({ translate: [pan.x, pan.y], name: "pan-left" }, [...])
  v.group({ name: "tray", opacity: 0.9 }, [...])     // existing key, now also a target
  v.place(weightPicture, x, y, { name: `weight-${i}` })
  ```

  1. **Names.** `name` joins `STYLE_KEYS` (`scene/recorder/style.ts:14`),
     `TextOptions`, `AtOptions`, `PlaceOptions`; it is stored on the node
     (`ShapeNode`, `TextNode`, `AtNode`, `PlaceNode` gain `name: string |
     undefined`; `GroupNode` has it, `nodes.ts:94`), not in the resolved
     style. An empty or non-string name throws at the call, naming the
     call. Group, `at`, place and flow options reject unknown keys, as
     styles do. `TextNode` gains `box` (its `TextBounds` rectangle), set by
     `recordText` and again by the `keepInside` re-layout
     (`resolve.ts:231-234`).
  2. **The hit walk.** `scene/hit.ts`: `hitTest(scene, point): { target,
     targets }`, pure. It walks children last to first (topmost first) with
     the matrix and the clips in force, enters `place` nodes' versions under
     their translation, and returns at the first hit area that has a named
     node on its path. Point tests in the node's own coordinates (the point
     through the inverted matrix): rect and ellipse exactly; arc as its
     chord-closed fill and its open stroke; poly and path by `polylines(g,
     maxScale(matrix))` with nonzero winding; a plain stroke by its stroke
     rings (Ontology: hit area); a brushed stroke by distance to its
     polylines; text by its `box`. A non-invertible matrix hits nothing. A
     subtree with no name anywhere (computed once per node, kept in a
     `WeakMap`) is skipped unless an ancestor is named. There is no box
     rejection in this plan: neither the layout box nor the off-canvas ink
     box contains every hit area (a picture body drawing outside its declared
     box, `TEA.md:359-360`; a `background` under an `at`, which the renderer
     draws on the unmoved ground, `gpu/lower.ts:123` while `bounds.ts:119`
     moves it; a text line box taller than the ink estimate,
     `bounds.ts:115`). The B2 timing check decides whether rejection is
     needed; if it is, it gets its own containing bounds.
  3. **The hit scene in each runtime** (the contract is the logical frame,
     decided: replay determinism is a stated preference, and an events file
     must give the same targets headless and in a browser; the cost is that
     a click during a presentation delay resolves against positions newer
     than the image on screen, accepted gap below). Headless: `FrameSurface` gains
     `hitScene(): Scene | undefined`, the `#last` record's scene
     (`headless/scene/surface.ts:121-125`), which is frame N−1's while frame
     N's events dispatch (`runner.ts:157-172`); the runner's `#toMsg`
     (`runner.ts:254-262`) adds `target`/`targets`. Browser: at the end of
     each `#doFrame` (`engine.ts:281-286`) the runtime notes the frame's end
     state, the `(model, params)` pair (both are replaced, never mutated:
     `engine.ts:344`, `:363`). When frame N's messages dispatch, the hit scene
     is the surface's kept record (`browser/scene/surface.ts:140-149`) if that
     record was drawn from the same pair; otherwise the surface records the
     pair's scene again without presenting it, its logs and warnings
     dropped. The usual case needs no extra record: a still figure's tick
     returns the same model, so the constructor's draw (`engine.ts:107`) stays
     the hit scene through frame 100 (the case the review found the first
     draft missed). Paused draws (`engine.ts:252-255`) present a newer state
     but do not move the frame, so clicks while paused resolve against the
     last running frame (accepted gap below). At frame 0 both runtimes give
     `undefined`/`[]`; `restart` returns to frame 0. A recorded session
     therefore replays to the same targets.
  4. **Scripted aim.** `TeaScriptEvent`'s mouse entry gains `target?:
     string`. An entry with `target` and with `x` or `y` is an
     `EventScriptError`. The runner finds the topmost node named so in the
     hit scene (any depth, inside placements too), takes the centre of its
     layout box in canvas coordinates (rounded to whole pixels, as the
     browser rounds, `canvas-dom.ts:105`), and hit-tests that point. When
     the name is not in the hit scene, or the point's `targets` do not
     include it (a ring's centre, or another named node on top), the run
     stops with an error naming the frame, the name and what the centre hit
     ("frame 30: mousedown target "pan-left": its centre (210,182) lands on
     "weight-2"; aim with x and y"). The browser's recorded log keeps `x`
     and `y` only.
  5. **What the transcript and the host see.** `describeInput`
     (`engagement.ts:39-50`) prints `mousedown (297,288) on pan-left` and,
     nested, `on weight-2 in pan-left` (targets joined with ` in `).
     `UnhandledFold` (`engagement.ts:17-30`) today shows the first
     "(unhandled)" line per message type and counts the rest; it keys on the
     type plus the target path instead, so a named click the sketch did not
     handle (the sketch checks `"left-pan"`, the drawing says `"pan-left"`)
     still shows once after an earlier miss in empty space.
     `EmittedEvent` (`engine-types.ts:28`) carries `targets` on mouse entries.
     The beebox host's activity detail (`figure-canvas-loop.ts:43-46`) adds
     ` on <target>` after `pressed …` when the sketch handled the input and a
     target exists; an unhandled input stays silent, as now.
  6. **`--scene` outlines** print ` "name"` on every named node line
     (`outline.ts:115-145`), so a box agent can read the names a frame holds.
  7. **Docs:** TEA.md "The `Msg` union", a new "Names and hits" section
     (fill/stroke rule, transparent pads for 40-pixel touch targets, unnamed
     drawings do not block, `targets.includes(…)` for nested names, names
     from model ids), "Events file" (aim by name), CHANGELOG.
- **Vocabulary lock-ins:** `name` on `Style`, `TextOptions`, `AtOptions`,
  `GroupOptions`, `PlaceOptions`, `FlowOptions`; `msg.target`, `msg.targets`
  (innermost first); events-file `"target"`; transcript `on X in Y`;
  `EmittedEvent.targets`; the hit-area rules; the hit scene is the last frame
  drawn before the message.
- **First implementation chunk (B1):** names and the hit walk, with no
  runtime wiring: the `name` keys and node fields, `TextNode.box`,
  `scene/hit.ts`, and its unit tests on recorded scenes: topmost of two
  overlapping named circles wins; an unnamed label drawn over a named pan
  does not block it; `targets` order for a named shape inside a named `at`;
  a click in a ring's hole misses a stroke-only circle and hits it with
  `fill: "transparent"`; a stroke band at `weight / 2`; a point outside a
  `clip` misses; a rotated `at`; a name inside a picture placed twice
  returns the placement it is in; a non-invertible `at({ scale: 0 })` hits
  nothing; an `erase` shape is not a hit area.

### C. Text runs (one line; separable from A and B)

- **What:** `v.text` (and `textBounds`, `textWidth`, `u.textBounds`,
  `u.textWidth`) take a list of runs. One line; each run may be a subscript,
  a superscript, bold or italic. The whole text keeps one fill.
- **Why this needs to change:** formulas and exponents are drawn piece by
  piece with a matching width function (`balance-reaction-2/draw-tea.ts:33-57`,
  sub size `size * 0.62` and shift `size * 0.22`, chosen by hand per figure).
- **Direction:**

  ```ts
  type TextRun = string | { text: string; sub?: boolean; sup?: boolean; style?: TextStyle };
  v.text(["H", { text: "2", sub: true }, "O"], { x: 40, y: 80 }, { size: 28, valign: "baseline" })
  v.text(["10", { text: "−3", sup: true }, " mol L", { text: "−1", sup: true }], at, UNITS)
  ```

  - `sub` and `sup` draw at 0.7 × the call's `size`; `sub` lowers the
    baseline by 0.22 × `size`, `sup` raises it by 0.38 × `size`. `style`
    replaces the call's style for that run. Both `sub` and `sup` on one run
    throws, and so does any other key (`fill` names the reason: one paint per
    text).
  - One line: a run containing `\n` throws; `wrap: true` throws; a `w` box
    aligns the line in the box and does not wrap (wrap defaults off for
    runs); `fit` shrinks every run together.
  - Measured as one: width is the sum of the runs' widths, each in its own
    font; the box is the base size's line box (sub/sup inside it); the
    baseline is the base baseline.
  - The node: `TextNode.content` stays the joined string (warnings,
    outlines, the overlap check), and the node gains `runs: readonly {
    from: number; to: number; size: number; style: TextStyle; dy: number
    }[] | undefined` over line 0's glyph indices. The text lowering keeps one
    paint per line.
  - **Glyphs of a runs text are placed on the alphabetic baseline.** Plain
    text rasterises each glyph against the node's Canvas2D `textBaseline`
    (`top` for unboxed text, `scene/recorder/text.ts:53-57`; `gpu/text.ts:44`;
    `glyphs.ts:75-80`), and the distance from `top` to the alphabetic baseline
    depends on the font size. So a smaller glyph rasterised against `top` and
    moved by `dy` would sit `gap(small) − gap(base)` off. A runs node
    therefore stores `baseline: "alphabetic"` and each line's `y` as its
    alphabetic baseline, converted once with A1's `baselineGap` for the
    mode the line's `y` was laid out against before conversion (the node's
    own `baseline` field: the `valign` mode for unboxed one-line text,
    `"middle"` for boxed or multi-line text, `text.ts:53-62`) at the fitted
    size; `dy` then moves the baseline exactly. Test: `"H"` and `["H"]`
    land in the same place for unboxed and boxed `top`, `middle`, `bottom`,
    `baseline`, and with `fit`. Tests cover
    `valign` `top`, `middle` and `baseline`, a `w` box, and `fit`. (The
    string `TextNode.baseline` mode and A's numeric baseline y stay distinct
    names: the y is `baselineY`.)
  - `gpu/text.ts:23` takes each glyph's font size and style from its run and
    adds its `dy`; the missing-glyph check uses each run's style.
  - **`keepInside`.** The resolve walk lays `keepInside` text out again from
    its kept inputs (`resolve.ts:224-234`, `recordText(n.content, …)`), which
    would turn runs back into a plain string. `TextFacts.keep` keeps the
    original content, runs included, and the walk passes it to
    `recordText`. Test: a named runs formula with `keepInside` under an `at`
    keeps its run sizes and its box.
- **Vocabulary lock-ins:** `TextRun`, `sub`, `sup`, the 0.7 / 0.22 / 0.38
  factors, one line only.
- **Depends on:** A1 (`baselineGap`).
- **First implementation chunk (C1):** measurement only: `TextMeasurer`
  lays runs out (widths, pen positions, `dy`) and `textWidth`/`textBounds`
  accept runs; tests: `["H", {text:"2", sub:true}, "O"]` is as wide as
  `H` + `2` at 0.7 size + `O`; the box height equals a plain text's; `\n` in
  a run, `wrap: true` and `sub`+`sup` each throw with the call named.

## Could this be simpler?

- **Simplest version:** `v.bounds` only; `name` plus `msg.target` only;
  one-line `sub`/`sup` runs. About 1,100 lines with tests. (Unicode
  subscripts are not a version: the probe above shows they draw as empty
  boxes headless.)
- **What `row`/`column` buy:** the bounds-only version still needs a cursor
  for any run of pieces (a formula and its coefficient boxes, a stack of
  tallies), which is the push form TEA.md tells agents to avoid; per agent
  DX and composability, a returned node composes into other layouts.
- **What `targets` buys over `target`:** a named weight inside a named pan;
  without the list the sketch cannot ask "was this in the left pan?".
- **What scripted aim buys:** an events file that survives a layout change
  and aims at a moving target; it removes the remaining reason to keep
  position math in a form the events file can repeat (agent DX).
- **What the unblocked-by-unnamed rule buys:** labels drawn over controls
  are common; making every drawing a blocker would force `name`s or an
  opt-out flag on labels.
- **Over-builds avoided:** no retained hit canvas (Konva) and no GPU pick
  pass; no hit tolerance option; no `hit: true` flag; no wrap, `justify` or
  grow/shrink in flows; no rich-text wrapping.

## Subplans

none

## Failure modes

> **Critical gap (accepted):** cross-runtime text width. A text's hit box and
> layout box use the runtime's font measurements, which can differ between
> headless and a browser (`TEA.md:277-279`, *"Headless runs and a browser can
> measure the same font slightly differently"*). A click a pixel inside a
> text's edge headless can miss in the browser. No handling; documented with
> the existing sentence.

> **Critical gap (accepted):** paused playground. While paused, the browser
> draws after each input (`engine.ts:252-255`), but the frame does not
> advance, so the hit scene stays the last running frame's. A click on something that moved while paused
> resolves against where it was. Only the playground has a pause control
> (`mountSketch`'s `transport` defaults off, `TEA.md:650`), so beebox
> figures never reach it. Accepted with one sentence in TEA.md.

> **Critical gap (accepted):** presentation delay. Targets follow the logical
> frame, and the browser presents a recorded scene asynchronously
> (`browser/scene/surface.ts:175-190`; `gpu/renderer.ts` awaits the GPU with
> no frame deadline). A click on a fast-moving small target while the GPU is
> behind resolves against where the target is in the newer recorded frame,
> not in the image on screen. Usually the gap is one display frame. Accepted
> because the alternative (resolving against the presented image) makes a
> recorded session replay to different targets than it had, which the
> determinism preference rules out. The report to the boxholder names it.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `alphabeticBaseline`'s sign differs from the assumption, so baseline rows misalign | Planned A1 (headless), A3 (browser) | the test pins it before use | Clear |
| `v.bounds` marks nodes as returned, hiding a dropped node | Planned A1 | no-take flattening | Clear (warning still given) |
| A child drawn at `(240, 80)` placed by `row` lands offset | Planned A2 | `dx = cursor − box.x` | Clear in frames |
| `keepInside` text moves after layout, so a row overlaps | No | documented: layout uses the call's box | Silent → documented in TEA.md |
| Frame-0 click: headless has no hit scene but the browser drew init | Planned B2 | both runtimes give no targets at frame 0 | Clear (`targets` empty in both) |
| Several events in one frame: the second sees a scene older than the model | Planned B2 | by design: the scene is frame N−1's | Clear (documented) |
| The browser presents a scene later than it records it | B2 engine test with a fake surface pins which scene a click uses | by design: targets follow the logical frame | Silent; usually one display frame, longer on a slow GPU; documented in TEA.md |
| A label over a pan blocks the click | Planned B1 | unnamed drawings are not candidates | Clear |
| A ring outline (stroke only) misses clicks in its middle | Planned B1 | documented: give a `fill` (`"transparent"`) | Clear in transcript (`(unhandled)`, no `on`) |
| A picture placed twice reports the wrong placement | Planned B1 | the walk enters each placement under its own matrix | Clear |
| Hit walk too slow on `mousemove` in a large scene | Planned B2: a 2,000-node scene under 1 ms in a unit timing check | name-free subtrees skipped | Clear (timing test) |
| Scripted aim lands on another node | Planned B3 | the run stops with an error naming both | Clear |
| A sketch keeps checking `msg.target === "pan-left"` but a nested name is innermost | No | TEA.md: use `targets.includes` | Silent → documented, and the transcript shows `on weight-2 in pan-left` |
| A `name` key on a style const shared by many shapes gives them one name | No | allowed (duplicates are legal) | Clear in transcript |
| Run glyphs in a size the atlas has not seen | Planned C2 | the atlas keys by font string (`glyphs.ts:66`) | Clear |
| A sub run rasterised against `top` sits off its baseline | Planned C2 (`valign` top, middle, baseline, box, `fit`) | runs nodes draw on the alphabetic baseline | Clear in frames |
| `keepInside` re-layout turns runs into plain text | Planned C2 | `TextFacts.keep` keeps the runs | Clear (test) |
| A still browser figure never redraws, so the first click finds no hit scene | Planned B2 (a still figure, first click at frame 100) | the kept record counts when its `(model, params)` matches | Clear (test) |
| A stroke hit outside a butt cap, or in a dash gap | Planned B1 | plain strokes hit-test the renderer's own stroke rings | Clear (test) |
| A hit area outside a declared or estimated box is skipped | Planned B1 (a picture body outside its box; a `background` under `at` in a picture; a text with `lineHeight: 4`) | no box rejection | Clear (test) |
| A named click the sketch ignores is hidden after an earlier miss | Planned B2 | unhandled lines fold per type and target path | Clear (test) |
| A two-shape component in a row splits into two items with a gap | Planned A2 | documented: wrap with `v.at({}, …)` | Clear in frames |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** `name` on a `clip` or `mask` (no options
  object) — ADDRESSED: wrap in `v.at({ name })`; TEA.md says so. `hit: true`
  (the reporter's spelling) on a group — ADDRESSED in B1: today
  `resolveGroup` copies the keys it knows and ignores the rest
  (`scene/recorder/style.ts:157-163`), and `resolvePlace` likewise
  (`:166`), so an option kept in a variable passes TypeScript's
  excess-property check and is dropped silently. B1 gives group, `at`, place
  and flow options the unknown-key error styles have (`style.ts:119`), and
  the message for `hit` says every `name` is a target. Text runs
  with `\n` — ADDRESSED (Track C throws).
- **Stale ref:** the named node moved between the drawn frame and the click
  — ADDRESSED: the hit scene is the drawn frame; `update` maps the name to a
  model id, which stays valid. A name for an item `update` has since removed
  — ADDRESSED in docs: look the id up and ignore a missing one.
- **Two agents touching the same card:** not applicable; a sketch is one
  file run by one runtime.
- **Hand-edit drift:** an events file with `"target"` and `"x"` — ADDRESSED
  (error). A name typed differently in the events file — ADDRESSED (error
  listing the frame and name).
- **Fabricated free-form value:** an agent invents names in `update` that
  `draw` never sets — GAP, softened: the transcript's `on …` shows the names
  that exist, and `--scene` lists them.
- **Validation error UX:** errors name the call and the key, as style errors
  do today (`style.ts:119`).
- **Partial migration:** existing sketches keep working; mouse messages gain
  fields they ignore. No transition state.

## NOT in scope

- **Keyboard focus and activation.** Named nodes are the natural focus list
  (Tab in paint order, Enter as a press), but focus needs a visible ring,
  host DOM focus and screen-reader wiring. Next step after this ships.
- **A semantic scene description for a tutor or screen reader.** Names in
  `--scene` outlines are the first piece; a description format is its own
  design.
- **Making `v.control` a node** so a row can place a param input. `control`
  stays a statement in canvas coordinates (`TEA.md:571-575`); a figure that
  needs an input inside a row measures the slot with `v.bounds`.
- **Wrapping flows, `justify`, grow/shrink** (flexbox's rest). No figure
  asked; add when one does.
- **Fuller rich text:** per-run `fill` (about 40 lines), wrapping across
  runs, mixed font families per run, underline, per-run halo, inline drawings
  in text, a markup string form.
  Roughly 400–600 more lines; the chemistry cases need none of it.
- **A hit tolerance option.** TEA.md's 40-pixel advice and a transparent pad
  cover touch; a tolerance would make hits differ from what is drawn.
- **Converting gallery sketches.** The gallery records past runs; the new
  example shows the API.
- **Migrating the courseware box's figures.** The boxholder decides when to
  give the box agent a prompt (Open design questions).

## Open design questions

Both answered on 2026-11-16 (see "Smallest fix and budget"): the whole plan
is approved, and the courseware prompt is written at finish.

1. **Approve the whole plan as a BIG CHANGE (~2,150 lines), or keep the
   core under 2,000 (~1,840)?** The core is all three requests: layout boxes
   and flows, named hits with the transcript, and one-line sub/sup runs. The
   ~310 lines beyond it buy: an events file can click `"pan-left"` by name
   instead of by computed coordinates (~110), the box's activity log says
   `pressed add-weight on pan-left` (~50), and a worked example sketch that
   `gallery:check` keeps running (~150). Lean: approve all; scripted aim
   removes the most common reason an agent's scripted click misses. Under
   the 2,000 line, drop scripted aim and the example (~1,890).
2. **Prompt the courseware box agent to adopt names, flows and runs once this
   ships?** Lean: yes; write the prompt at finish, as the box-figures
   subplan did for the scene renderer.

## Knowledge audits

Box agents learn the API from TEA.md, shipped as box docs
(`canvas-loop-doc.ts:1-4`). Add two `knows_directly` entries beside the
figure audits in `beebox/src/dev/knowledge-audits.yaml` (`:1392` onward) and
run them on the worktree's test1 with `--filter figure`:

- `figure-named-hits`: "In a canvas-loop figure, how does `update` find which
  of several drawn pans the learner clicked?" — names the pan with `name` and
  reads `msg.target`/`msg.targets`; does not write a hit-test function.
- `figure-formula-runs` (with Track C): "How do you draw H₂SO₄ with a real
  subscript in a canvas-loop figure?" — one `v.text` with runs `{ text: "2",
  sub: true }`.

## What will hold this after it ships

- Unit tests (`canvas-loop/test/`, no GPU) hold the decisions, which are pure
  functions: `layoutBox`, flow placement, `hitTest`, scripted-aim
  resolution, run layout. They need no new tier.
- One `*.gpu.test.ts` case for Track C's glyph path (a sub run draws smaller
  and lower), following the existing GPU text tests.
- The browser runtime's hit-scene rule (constructor and paused draws do not
  count) gets an engine test in the existing browser runtime tests with a
  fake surface.
- The new example (`src/examples/scale-tea.ts` with its events file, using
  names, a row, a column and scripted aim) runs in `gallery:check` and is the
  walk written down.

## Implementation order

1. **A1** layout box, baseline gap, `v.bounds` (above).
2. **A2** `v.row`, `v.column`; tests for each `align`/`valign`, null
   children, a child not at its origin, nested rows.
3. **A3** TEA.md "Layout" section and CHANGELOG; the browser baseline-sign
   test.
4. **B1** names and the hit walk (above).
5. **B2** runtime wiring: `Msg` fields, headless and browser hit scenes,
   transcript `on …`, `EmittedEvent.targets`, outline names, the timing check.
6. **B3** scripted aim in events files.
7. **B4** beebox host activity detail (`figure-canvas-loop.ts`) and its test;
   TEA.md "Names and hits", "Events file"; CHANGELOG; knowledge audit
   `figure-named-hits`, run.
8. **B5** the example sketch and events file; `gallery:check`.
9. **C1–C3** run measurement (needs A1's `baselineGap`); the node on the
   alphabetic baseline, glyph quads, the `keepInside` path; TEA.md and
   CHANGELOG, audit `figure-formula-runs`, run. Track C is core scope; only
   B3, the host half of B4 and B5 wait on the BIG CHANGE answer.

## Rollout shape

Tests first per chunk, as named above. Done when: the A and B unit tests pass;
`pnpm --dir canvas-loop test` passes (GPU tests one at a time, per
`canvas-loop/AGENTS.md`); `gallery:check` passes with the new example; the
beebox `figure-canvas-loop` test passes; `pnpm typecheck` and
`pnpm layout-check` from `beebox/`; the knowledge audits pass. No data
migration: sketches are code, and no stored shape changes.

### Scenario walks

**1. A balance with two pans; clicking a pan adds a weight.**

- `draw` (frame 29) returns `v.at({ translate: [180, 200 + tilt], name:
  "pan-left" }, [v.arc(0, 0, 60, 0, Math.PI, { fill: "transparent", stroke:
  INK, weight: 3 }), model.left.map((w, i) => v.place(WEIGHT, -20 + 14 * i,
  -18, { name: \`weight-${w.id}\` }))])`, and the same for `"pan-right"`,
  then a text label "Left" drawn over the pan, unnamed.
- The recorder stamps the nodes (`view.ts:160-166`); `at` gets `name`; the
  resolve walk copies it through (`resolve.ts:176-178` returns the node or a
  copy with its fields). The headless surface keeps the record as `#last`
  (`surface.ts:121-125`).
- Frame 30's events: `{ "frame": 30, "type": "mousedown", "target":
  "pan-left" }`. The runner (B3) finds the `at` named `pan-left` in frame
  29's scene, its layout box (arc box grown by 1.5 plus the placed weights'
  boxes) in canvas coordinates, its centre (180, 216), and hit-tests it: the
  walk goes topmost first, passes the unnamed label (not a candidate), enters
  `pan-left`'s `at`, tests the weights (miss), tests the arc's chord-closed
  fill (`"transparent"` counts): hit. `targets = ["pan-left"]`.
- `update` gets `{ type: "mousedown", x: 180, y: 216, target: "pan-left",
  targets: ["pan-left"] }`, returns a model with a new weight in `left`, and
  calls `u.handled("add-weight")`. The transcript line: `mousedown (180,216)
  on pan-left → add-weight`, then `activity {…}` (`runner.ts:224-231`).
- Frame 30's tick tilts the beam; `draw` records frame 30. A click at frame
  31 on a weight resolves to `targets: ["weight-7", "pan-left"]`; `update`
  can remove weight 7.
- In a beebox figure, the same click streams `{ frame, type: "mousedown",
  x, y, handled: ["add-weight"], changed: true, targets: ["pan-left"],
  activity }`; the host's activity detail reads `pressed add-weight on
  pan-left`. Nothing else is left behind; the scene is replaced next frame.

**2. A formula label `2 H₂ + O₂ → 2 H₂O` laid out in a row.**

- With Track C: `v.row({ x: 320, y: 120, gap: 10, align: "center", valign:
  "baseline" }, [v.text(["2 H", SUB("2")], o, F), v.text("+", o, F),
  v.text(["O", SUB("2")], o, F), v.at({}, arrow(v)), v.text(["2 H", SUB("2"),
  "O"], o, F)])` where `o = { x: 0, y: 0 }`, `F` has `valign: "baseline"`,
  and `arrow(v)` returns a line and a path drawn at `(0, 0)`–`(34, 0)`
  (`balance-reaction-2/draw-tea.ts:77-83` returns such a list). Unwrapped,
  the line and the head would be two row items with a gap between them;
  `v.at({}, …)` makes them one.
- Each `v.text` lays out at the call (`text.ts:40-67`), now with runs: the
  measurer sums widths per run font, records glyph positions on the
  alphabetic baseline and each run's `dy`, and sets the node's `box` and
  `baselineY` (0, since `valign: "baseline"` puts the baseline on `y = 0`). The arrow's layout box is
  `{ x: 0, y: −10.5, w: 35, h: 21, baseline: null }` (the path's points
  grown by half its weight).
- `row` reads each child's layout box, places child 1 at `dx = 0 − box.x`,
  advances by `w + 10`, and so on; the arrow has no baseline, so its bottom
  sits on the shared baseline (CSS rule): its line rides 10.5 px above the
  baseline, about the height of the `+`. The row's width is known, so
  `align: "center"` shifts every child by `320 − width / 2`, and `valign:
  "baseline"` puts the shared baseline at `y = 120`.
- The row returns one `at` holding five translating `at`s; `draw` returns it.
  The renderer draws each text node's glyphs from the atlas: a subscript `2`
  is the key `bold 19.6px …` instead of `bold 28px …` (`gpu/text.ts:23`,
  `glyphs.ts:66`), placed at its run's `dy`.
- Without Track C, a `formula(v, "H2O")` component cannot use a baseline row
  for its own subscripts: the row would move each subscript's baseline back
  onto the shared one, undoing its shift (the review caught this in the first
  draft). The component instead places each piece by hand from
  `v.bounds(...).w` widths inside one `v.at({}, …)`, whose baseline is its
  first child's; the outer row then works. The cursor arithmetic stays inside
  the component, with a hand-set sub size per figure: this is what Track C
  replaces.

## Courseware box prompt

Written at finish, after the work ships; not sent from this plan.
