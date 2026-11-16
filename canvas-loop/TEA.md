# Writing a sketch (TEA)

A canvas-loop sketch follows The Elm Architecture (TEA). It is a pure fold:
`model = msgs.reduce(update, init())`, then `draw` returns the drawing of the
model. State changes only when `update` returns a new `Model`. Types, a
runtime deep-freeze, a double-run byte-diff and lint enforce this.

```sh
pnpm --dir canvas-loop run cli run src/examples/orbit-tea.ts \
  --events src/examples/orbit-tea-events.json --out out
```

Name sketch files `*-tea.ts`. The TEA lint applies to that suffix. The
[README](./README.md) covers running, the events file and the capture policy.

## Contract

A TEA sketch imports **only** `@ianbicking/canvas-loop` (types only) and,
for a large sketch, sibling helper files named `<name>-tea.ts` (imported as
`./<name>-tea.js`; the TEA lint applies to them too). It exports:

```ts
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, RootDrawing, Util, View } from "@ianbicking/canvas-loop";

export const params = { /* … */ } as const satisfies ParamsDecl;   // optional
export const canvas = { width: 500, height: 400 };                 // optional (default 400×300)

export type Model = { /* your state */ };                          // sketch-defined

export function init(u: Util<typeof params>): Model;
export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model;
export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): RootDrawing;
```

- **`init`** runs once, before frame 0, returning the initial `Model`.
- **`update`** folds one `Msg` into a new `Model`. Pure: same inputs → same
  output. Return a *new* value — never mutate `model` (it is deep-frozen; a
  mutation throws).
- **`draw`** returns the drawing of the `Model`. View-only: no randomness, no
  state store beyond the `p` argument. It cannot change the world.

A sketch without `params` writes `Util` (no type argument) and leaves out `p`.

`cli run` type-checks the sketch and the files it imports, and checks its
exports against this contract, before it runs: `update` and `draw` must take
the model `init` returns, and `draw` must return a drawing. A type error stops
the run and is listed in the transcript.

Capabilities are injected, not ambient — `update` gets `Util` (randomness,
params, log, `handled`) and no drawing; `draw` gets `View` (drawing, log,
snapshot) and no randomness. That withholding *is* the enforcement.

The lint preset caps functions at 2 parameters, except in `src/examples/`
and `src/gallery/`. Elsewhere, put this exact comment on `update` and `draw`:
`// eslint-disable-next-line max-params -- TEA contract signature`.

Every param may also carry `label` (the words its control shows; default: the
param's name) and `hint` (a short line shown with it).

`Util` also has `record(keys, value)`: `u.record(IDS, () => 0)` builds a
`Record<Id, number>` for id-keyed state without casts. `DeepReadonly` keeps
tuples as tuples, so `Vec2` points can live in a `Model`.

## The `Msg` union

Time is a message; input, param edits, and triggers are the rest. Switch
exhaustively on `msg.type` (the type-aware lint enforces it):

```ts
type Msg =
  | { type: "tick"; frame: number }
  | { type: "mousedown"; x: number; y: number; target: string | undefined; targets: readonly string[] }
  | { type: "mouseup"; x: number; y: number; target: string | undefined; targets: readonly string[] }
  | { type: "mousemove"; x: number; y: number; target: string | undefined; targets: readonly string[] }
  | { type: "keydown"; key: string }
  | { type: "keyup"; key: string }
  | { type: "param"; name: string; value: number | boolean | string }
  | { type: "trigger"; name: string };
```

In a browser, mouse, touch and pen all arrive as the `mouse*` messages, so
one sketch serves a phone too. A drag that starts on the canvas does not scroll
the page, and a press always ends with `mouseup`, even when the finger leaves
the canvas or the browser cancels the touch. A finger has no hover: a touch
sketch gets `mousemove` only while pressed. Hit areas a fingertip must land
on want to be about 40 pixels across.

## Frame-N guarantee

For each frame N, the runtime:

1. dispatches every scripted event for frame N, **in file order**, as msgs
   (a `param` event updates the runtime's param store *and* becomes a `param`
   msg; a `trigger` event becomes a `trigger` msg),
2. then dispatches `{ type: "tick", frame: N }`,
3. folding each through `update` in that order,
4. then calls `draw` **once** with the resulting model.

So the first event of frame N sees the state after frame **N−1**'s draw, and
each later event sees the folds before it. `draw` runs exactly once per frame headless. `init` runs once before frame 0.

In a browser, `draw` runs only when the frame's model is a new object, a
param changed, or input arrived; otherwise the canvas keeps the last picture.
So `draw` must read only `model` and `p`: a value from anywhere else (a module
`let`, the clock) would go stale. To animate, change the model on `tick`. A
figure scrolled off screen sleeps: its frames stop until it is back, as when
paused, and a sound playing when it left is cut off.

## Drawing

Each drawing call on `v` returns a node and draws nothing by itself. `draw`
returns the frame's drawing, and the renderer draws it on a clear canvas.
Later items draw over earlier ones. Nothing on `View` sets state that a later
call reads: each call says how it paints. The calls keep the Canvas2D and p5
names and argument order.

```ts
import type { DeepReadonly, Drawing, RootDrawing, Style, View } from "@ianbicking/canvas-loop";

const RING: Style = { stroke: "#f8fafc", weight: 2 };

function drawPlanet(v: View, planet: DeepReadonly<Planet>, selected: boolean): Drawing {
  return [
    v.circle(planet.x, planet.y, planet.r, { fill: planet.color }),
    selected && v.circle(planet.x, planet.y, planet.r + 4, RING),     // a condition is &&
  ];
}

export function draw(v: View, model: DeepReadonly<Model>): RootDrawing {
  return [
    v.background("#0b1020"),
    model.planets.map((planet, i) => drawPlanet(v, planet, model.selected === i)),  // a loop is .map
    v.at({ translate: [250, 200] }, [                                               // a scope takes its children
      v.circle(0, 0, 20, { fill: "#facc15" }),
      v.text("Sun", { x: 0, y: 30 }, { fill: "#e2e8f0", align: "center" }),
    ]),
  ];
}
```

- A **`Drawing`** is a node, a list of drawings (nested lists are flattened),
  or `null`, `undefined` or `false` for nothing. A component is a function
  that returns one. `draw` returns a **`RootDrawing`**: the same without
  `undefined`. An empty frame returns `null` or `[]`.
- A loop that carries state (a running total, the previous point) can push
  into a local `const out: Drawing[] = []` and return it. The gallery's
  sketches were converted to this form by a script and use `out.push`
  everywhere; write `.map`, `&&` and components instead. For pieces placed
  one after another, use [`v.row` and `v.column`](#layout), not a cursor.
- A scope copies its children when it is called: changing the array later
  changes nothing.
- A node belongs to the frame that made it. Make the drawing again in each
  `draw`; to keep a drawing across frames, record it as a
  [picture](#pictures).
- `log`, `snapshot`, `cursor` and `control` are not drawings: call them as
  statements before `return`.

### Mistakes and what you see

| Mistake | What you see |
| --- | --- |
| `draw` has no `return` | `cli run` stops on a type error: `TS2355: A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value`, or without a return type, `the export "draw" does not fit the sketch contract … Type 'void' is not assignable to type 'RootDrawing'`. With `--no-typecheck`: `RemovedCallError: … drawing calls as statements was removed: return the drawing from draw`. |
| A node made and not returned (`v.circle(…);` as a statement, a helper's result dropped) | The frame draws without it, and the transcript warns with its line: `warn: v.circle made a drawing that was not returned; put it in the list draw returns, or in a scope's children (at sketch-tea.ts:10:5)`. |
| A node kept and returned in a later frame | The frame fails: `group: this drawing was made in an earlier frame; make it again in draw, or record it once as a picture (at …)`. |
| A number where a child goes (`count && v.rect(…)` with `count` 0) | A type error: `Type 'number' is not assignable to type 'Drawing'`. With `--no-typecheck`: `a child must be a drawing …; got the number 0`. Write `count > 0 && …`. |
| A body function (`v.group(options, () => { … })`, the old form) | A type error. With `--no-typecheck`: `RemovedCallError: group(options, body function) was removed: group takes its children as a list`. |

### Styles

A shape call takes a `Style` as its last argument. A style is a plain object.
Keep the ones you reuse in `const`s and spread to vary them:

```ts
const CARD: Style = { fill: "#f8fafc", stroke: "#334155", weight: 2 };
const INK: Style = { stroke: "#1d2a44", weight: 3, brush: "ink" };
const LABEL: TextOptions = { size: 14, fill: "#334155", align: "center", valign: "middle" };

export function draw(v: View, model: DeepReadonly<Model>): RootDrawing {
  return [
    v.roundRect(20, 20, 160, 80, 8, model.hot ? { ...CARD, fill: "#fde68a" } : CARD),
    v.line(30, 80, 170, 80, INK),
    v.text("Sun", { x: 100, y: 50 }, LABEL),
  ];
}
```

| Key | Meaning | When left out |
| --- | --- | --- |
| `fill` | a CSS color string or a gradient handle | no fill |
| `stroke` | a CSS color string or a gradient handle | no stroke |
| `weight` | stroke width in logical pixels | 1 |
| `brush` | strokes become brushed marks: a preset name (`"ink"`), a preset with fields changed (`{ preset: "pencil", opacity: 0.6 }`), or a `Brush` | plain strokes |
| `gesture` | how the hand moves for brushed marks: `{ pressure, wobble, seed, faint }` | `{}` |
| `blend` | how the pixels combine with what is under them (`"multiply"`, `"screen"`, …) | `"normal"` |
| `erase` | `true` removes pixels instead of adding them | `false` |
| `dash` | lengths on, off, on, … for a plain stroke (`[6, 4]`); a brushed stroke cannot be dashed | solid |
| `cap`, `join` | line ends and corners of a plain stroke, as Canvas2D `lineCap` and `lineJoin` | `"butt"`, `"miter"` |
| `effects` | effects on this shape alone (see [BRUSHES.md](./BRUSHES.md#effects)) | none |
| `material` | how the shape takes light inside a lit group (see [BRUSHES.md](./BRUSHES.md#lighting)) | flat matte |

A brush preset kept in a variable needs its type, or TypeScript widens
`preset` to `string`: `const SHADE: BrushPreset = { preset: "bristle", load: 0.4 }`.
[BRUSHES.md](./BRUSHES.md) lists the presets, their fields and gestures.

Colors are CSS strings only (`"#38bdf8"`, `"tomato"`, `"rgb(…)"`).

The style is checked at each call. An unknown key, a negative `weight`, an
unknown brush name or a color that does not parse throws an error that names
the call and the key. After the run, a drawing that was off the canvas on
every frame, or text with no box (`w`) that crossed the canvas edge on every
frame, gets a warning naming its line.

### Shapes

```ts
v.background(paint)
v.rect(x, y, w, h, style)               v.roundRect(x, y, w, h, radius, style)
v.circle(x, y, radius, style)           v.ellipse(x, y, rx, ry, style)
v.line(x1, y1, x2, y2, style)           v.triangle(x1, y1, x2, y2, x3, y3, style)
v.arc(x, y, radius, start, end, style)  v.polygon(points, style)
v.path(commands, style)                 v.curve(points, closed, style)
```

- Points are `Vec2` tuples, `[x, y]`.
- `rect` and `roundRect` take the top-left corner and a width and height.
  `circle`, `ellipse` and `arc` take the centre and radii, as Canvas2D and SVG
  do (not p5's diameter): `v.circle(50, 50, 10, …)` is 20 across.
- `path` takes data-encoded commands: `["move", x, y]`, `["line", x, y]`,
  `["quad", cx, cy, x, y]`, `["bezier", c1x, c1y, c2x, c2y, x, y]`,
  `["close"]`.
- `curve` draws a smooth curve through every point. `closed` is required.
  `v.curvePath(points, closed?)` returns the same curve as path commands.
- `v.tube(points, { width, profile? })` and `v.offset(points, distance)` return
  outlines as data (see [BRUSHES.md](./BRUSHES.md#shape-helpers)).
- `v.linearGradient(x1, y1, x2, y2, stops)`, `v.radialGradient(x, y, radius,
  stops)` and `v.ellipseGradient(x, y, rx, ry, stops)` return gradient handles.
  Use a handle anywhere a color goes: `{ fill: v.radialGradient(…) }`.

### Text

```ts
v.text(s, { x, y, w?, h? }, options)       // a node
v.textBounds(s, { x, y, w?, h? }, options) // the bounds text draws, as data
v.textWidth(s, options)                    // width in logical pixels
u.textBounds(s, { x, y, w?, h? }, options) // in init and update: the same
u.textWidth(s, options)
```

| Option | Default |
| --- | --- |
| `size` | 12 |
| `font` (CSS family, e.g. `"Georgia, serif"`) | `"sans-serif"` |
| `style` (`"normal"`, `"italic"`, `"bold"`, `"bold italic"`) | `"normal"` |
| `fill` | `"#000000"` |
| `align` (`"left"`, `"center"`, `"right"`) | `"left"` |
| `valign` (`"top"`, `"middle"`, `"bottom"`, `"baseline"`) | `"top"` |
| `halo` (a color drawn as a band around the letters, under them) | none |
| `keepInside` (slide the text back inside the canvas, or a picture's box, 4px margin, when it would cross an edge) | off |
| `overlay` (the text floats over the drawing on purpose: the overlap check skips it) | off |
| `blend`, `erase` | as for a style |
| `wrap` | on when `w` is set |
| `fit` (shrink until the text fits the box) | off |
| `lineHeight` (multiple of `size`) | 1.25 |

- One line with no `w` draws at (x, y): `align` places it about `x` and
  `valign` about `y`. `"baseline"` puts the alphabetic baseline on `y`.
- With `w`, `x` is the box's left edge (not an anchor) and lines wrap at word
  breaks to the box width; `align` places each line inside the box. With `h`,
  `valign` places the lines inside the box.
- The bounds are `{ x, y, w, h, lines, size, overflow }`. `overflow` is true
  when the text does not fit the box.
- Use `textBounds` to place a label before drawing it, for example to size a
  backing box: measure, then return the box and the text in one list.
  `textBounds` measures where no transform moves the text; inside an `at`,
  the bounds are in the `at`'s coordinates.
- `u.textBounds` and `u.textWidth` measure in `init` and `update`, so a hit
  area or tile can be sized to its label instead of a guessed constant.
  Measure when you need it rather than storing widths in the model: a web
  font that loads later changes them. Headless runs and a browser can measure
  the same font slightly differently.
- Which fonts exist depends on the machine. Use common families, and end the list
  with a generic one (`"Georgia, serif"`); a list with no family the runtime
  has and no generic one gets a warning.
- Each character is drawn on its own: there are no ligatures, and scripts
  whose letters join or reorder (Arabic, Devanagari) are not shaped.
- The run warns, once per pair of texts, when two different texts overlap in
  a frame (the same text twice, as for a shadow, is not reported). A rotated
  text counts as the upright box around it. After ten pairs it stops
  reporting. A `halo` is part of the bounds; a `halo` in the background color
  keeps a label readable where it crosses a line. Text meant to float over
  other text (a tooltip, a hover hint by the pointer, a dragged label) takes
  `overlay: true`, and the check skips it; the text under it is still checked
  against the rest. Headless runs also warn when
  the font has no glyph for a character, which draws as an empty box or
  nothing; use a plain word or another character. Unicode subscript and
  superscript digits (`₂`, `⁻`) are missing in the headless fonts: write
  them as runs.

Text content can be a list of runs instead of a string, for formulas,
units and exponents. A run is a string or `{ text, sub?, sup?, style? }`:

```ts
const sub = (text: string) => ({ text, sub: true });
v.text(["H", sub("2"), "O"], { x: 40, y: 80 }, { size: 28, valign: "baseline" }) // H₂O
v.text(["10", { text: "−3", sup: true }, " mol L", { text: "−1", sup: true }], { x: 40, y: 120 }, UNITS)
v.text(["k", { text: "obs", sub: true, style: "italic" }], { x: 40, y: 160 }, LABEL)
```

- `sub` and `sup` draw at 0.7 × `size`; `sub` moves the baseline down by
  0.22 × `size`, `sup` up by 0.38 × `size`. `style` sets that run's style.
- Runs are one line, measured and drawn as one text: one box (the line box
  at `size`; sub and sup sit inside it), one baseline, one `fill`, one `name`.
  `textWidth` and `textBounds` (on `v` and `u`) take runs too.
- A `w` box aligns the line inside it and does not wrap; `fit` shrinks every
  run together.
- These throw at the call: `\n` in a run, `wrap: true`, a run with both `sub`
  and `sup`, and any other key (a run in another color is its own `v.text`).

### Scopes

Each scope takes its children as its last argument and returns one node.

- `v.at({ translate?: [x, y], rotate?: radians, scale?: n | [sx, sy], skew?:
  [x, y], matrix?: [a, b, c, d, e, f] }, children)` transforms its children.
  The options apply as Canvas2D calls in the order matrix, translate, rotate,
  skew, scale, so `scale` acts on the points first. For another order, nest
  `at` calls. It has no layer: `erase` inside it erases the canvas beneath.
- `v.group({ name?, opacity?, blend?, effects?, lighting?, clip? }, children)`
  draws its children on their own layer, then composites the layer once.
  `erase` inside a group erases only the group's pixels. `effects` adds blur,
  a glow, a drop shadow, colour adjustments, a wash or hatching; `lighting`
  lights it (see [BRUSHES.md](./BRUSHES.md#effects)). `name` labels the group
  in warnings and `--scene` outlines.
- `v.mask(maskArt, children)` keeps `children` where `maskArt` paints, in
  proportion to its alpha: a gradient in the mask fades them out. Unlike
  `clip`, the mask is any drawing and its edge can be soft. Like `group`, the
  children draw on their own layer.
- `v.clip(shape, children)` clips its children to a polygon or path, or to the
  union of an array of them.
- `v.paper(settings, children)` sets the paper grain for the brushes and
  effects in its children (see [BRUSHES.md](./BRUSHES.md#paper)).

### Layout

`v.bounds(drawing)` returns the layout box of any drawing of this frame:
`{ x, y, w, h, baseline }` in the coordinates where it is returned, or `null`
when it draws nothing. Measure a component's result instead of writing a
second function that computes its size.

- A shape is its geometry (a path by its curve) plus half its stroke weight.
  Miter spikes, brush wobble and effects are not counted.
- Text is exactly what `textBounds` gives. `baseline` is the first text's
  alphabetic baseline y, or `null` when the drawing has no text or a rotation
  or skew turns it.
- A placed picture is its declared `width × height`. Backgrounds, lights and
  `erase` shapes add nothing; a clip cuts the box.
- Measuring does not return the drawing: return it as well, or testing mode
  warns that it was not returned.

`v.row(options, children)` and `v.column(options, children)` place their
children one after another by their layout boxes and return one node, which
can go in another row or column. Options: `x`, `y` (default 0), `gap`
(default 0), `align`, `valign`, with `v.text`'s names. Draw each child at
`(0, 0)` and let the flow move it:

```ts
v.column({ x: 300, y: 330, gap: 6, align: "center" }, [
  v.text("Left pan", { x: 0, y: 0 }, LABEL),
  v.row({ gap: 4, valign: "baseline" }, model.left.map((w) => v.text(`${w} g`, { x: 0, y: 0 }, SMALL))),
])
```

- A row runs left to right. `valign` lines each child up and says what `y`
  is: `"top"` (default), `"middle"`, `"bottom"`, or `"baseline"` (each
  child's first text baseline on `y`; a child with no baseline sits on it by
  its bottom). `align` places the whole row about `x`: `"left"` (default),
  `"center"` or `"right"`.
- A column runs top to bottom. `align` lines each child up and says what `x`
  is; `valign` (`"top"`, `"middle"`, `"bottom"`) places the whole column about
  `y`. A column's baseline is its first child's, so a column sits in a
  baseline row by its first line.
- Each child is moved by its box, so a child drawn at its own `(0, 0)` and one
  drawn at `(240, 80)` land the same. A child that draws nothing a layout can
  place (`null`, a light) takes no room and no gap.
- Every node in the flattened children is one item. A component that returns
  a list (an arrow as a line and a head) becomes two items with a gap
  between; wrap it to make one: `v.at({}, arrow(v))`.
- The positions are fixed when the call returns. Text with `keepInside` that
  later slides back inside the canvas moves alone; the flow keeps the box
  from the call, so the text can then overlap its neighbour.

### Pictures

A picture records a drawing once and places it any number of times. Use one
for anything that does not change every frame: a background, a character
drawn in a few poses, a sign. A picture's drawing is reused across frames, so
a still part costs nothing to keep.

```ts
const STALL = (v: View, colour: string): Picture =>
  v.picture({ key: "stall", width: 120, height: 90, deps: [colour] }, () => [
    v.rect(0, 30, 120, 60, { fill: colour }),
    v.polygon([[0, 30], [60, 0], [120, 30]], { fill: "#7c2d12" }),
  ]);

export function draw(v: View, model: DeepReadonly<Model>): RootDrawing {
  const red = STALL(v, "#b91c1c");
  return [
    v.place(red, 20, 200),
    v.place(STALL(v, "#1d4ed8"), 160, 200),          // a second version
    v.at({ translate: [300, 200], scale: 0.5 }, v.place(red, 0, 0)),
  ];
}
```

- `v.picture({ key, width, height, deps?, paper? }, body)` returns a
  `Picture`. `body` returns the picture's drawing in the picture's own
  coordinates, 0..width and 0..height. `v.place(picture, x, y, { opacity?,
  blend?, erase?, material? }?)` puts its top-left at (x, y), under the scopes
  around it.
- A **version** is the key, the size, the `paper` and the values of `deps`. `body` runs
  only when the version is new. Put in `deps` everything the body reads that
  can change: a colour, a pose name, a param. `deps` are plain data (numbers,
  strings, booleans, `null`, and arrays and objects of these) compared by
  value. Leave `deps` out for a drawing that never changes.
- Call `v.picture` in every `draw` that places it: it returns the kept
  version without running `body`. A `Picture` from an earlier frame is
  refused at `place`. Versions not asked for stay kept for a while (within a
  memory budget), so poses that come back are not recorded again.
- Inside `body`, `v.width` and `v.height` are the picture's size, and
  `keepInside` text keeps inside the picture's box. Drawing outside the box
  is kept, so glows and shadows can spill over it.
- `log`, `snapshot`, `cursor` and `control` are errors inside `body`.
- A placed picture draws as if its drawing were drawn there: brush widths,
  effect lengths and text follow the scale of the scopes around it.
- Headless runs record every picture again each frame and compare it with
  the kept version. A body that reads a value not in `deps` warns, naming the
  picture and the first difference. A picture whose `deps` change in every
  frame warns too: it gains nothing.
- `paper` sets the paper the picture's brushes use. A picture never takes
  the paper of the scope it is placed in.

`v.pixels({ key, width, height, deps? }, fill)` makes a fixed-resolution
image: `fill({ data, width, height })` writes straight RGBA bytes (alpha is
every fourth byte; 255 is opaque) into a zeroed array when the version is
new. Place it like a picture; scaled up, it blurs as an image does.

### Names and hits

Give a drawing a `name`, and a mouse message says when the pointer is on it.
`update` reads the name instead of repeating `draw`'s position math. `name`
goes in a shape's style and in the options of `v.text`, `v.at`, `v.group`,
`v.place`, `v.row` and `v.column`; it adds no layer.

```ts
v.at({ translate: [150, 200], name: "pan-left" }, [
  v.arc(0, 0, 60, 0, Math.PI, { fill: "transparent", stroke: INK, weight: 3 }),
  model.left.map((w, i) => v.circle(-30 + 20 * i, 12, 9, { fill: GOLD, name: `weight-${w.id}` })),
]),
v.text("Left", { x: 150, y: 290 }, LABEL),        // unnamed: does not block the pan
```

```ts
case "mousedown": {
  const weight = msg.targets.find((t) => t.startsWith("weight-"));
  if (weight !== undefined) { u.handled("remove-weight"); return removeWeight(model, weight); }
  if (msg.targets.includes("pan-left")) { u.handled("add-weight"); return addWeight(model, "left"); }
  return model;
}
```

- `msg.target` is the innermost name under the pointer; `msg.targets` lists
  every name on its path, innermost first (`["weight-3", "pan-left"]`). Use
  `targets.includes(…)` for a name that can hold named drawings.
- A shape hits where it paints: its fill, and the band its stroke draws. A
  ring with only a stroke misses in its hole; add `fill: "transparent"` to
  fill it. Text hits in its `textBounds` box.
- Only named drawings take a hit. An unnamed label drawn over a named pan
  does not block it. To give a small control the 40-pixel area a fingertip
  needs, draw a larger `fill: "transparent"` shape under the same name.
- Build names from the model's ids (`weight-${w.id}`), and in `update` look
  the id up again: an item `update` has removed since the frame was drawn is
  not found, so ignore it.
- `v.clip` and `v.mask` take no options: wrap them in `v.at({ name }, …)`.
- The hit scene is the last frame drawn before the message: the first event
  of frame N hits frame N−1's drawing, as an events file sees it. At frame 0
  nothing is drawn, so `targets` is empty. A replay gives the same targets.
- `--scene` outlines print each node's name, so you can read the names a
  frame holds; the transcript prints `on weight-3 in pan-left` after the
  position.
- Known gaps. A headless run and a browser can measure text slightly
  differently, so a click a pixel inside a text's edge can miss in one of
  them. While the playground is paused, clicks hit the last running frame,
  not what the paused redraw shows. When the GPU is behind, a click hits the
  newest recorded frame, which can be one display frame ahead of the image
  on screen.

### Other `View` members

- `v.width`, `v.height`: the canvas size, or the picture's size inside a
  picture body.
- `v.tween(keys, t, ease?)`: a number moving through keyframes
  `[[time, value], …]` (sorted by time) at time `t`, eased within each span:
  `v.tween([[0, 40], [30, 260], [60, 260]], model.frame, "in-out")`. It holds
  the first and last values outside the keys. `v.tweenPoint` does the same
  for tuples (points, colour channels). Eases: `"linear"` (default), `"in"`,
  `"out"`, `"in-out"`, `"out-back"` (overshoots and settles), `"step"`
  (holds, then jumps at the span's end). A keyframe `[time, value, ease]`
  eases the span it starts with its own curve. Two keyframes at the same time
  make a jump. `v.ease(name, u)` is one curve at `u` in 0..1.
- `v.noise(x, y?, z?)`: smooth value noise, 0..1, of its coordinates, as p5's
  `noise`. The run's seed sets it. Use it for flicker and texture in `draw`,
  which has no `random`.
- `v.toCanvas(point, scopes)`: `point` in canvas coordinates, when it sits
  inside the `at` scopes listed outermost first:
  `v.toCanvas([0, -40], [{ translate: [200, 150] }, { rotate: angle }])`.
- `v.light(light)`: a light node for a lit group (see
  [BRUSHES.md](./BRUSHES.md#lighting)).
- `v.debugBox(label, x, y, w, h)`: a labelled box drawn only with
  `run --outline`. It is a node: return it.
- `v.control(name, box)`: see [Inputs over the canvas](#inputs-over-the-canvas).
- `v.cursor(kind)`: the pointer's look over a browser figure. It starts as
  the normal arrow. Set `pointer` over something a tap acts on, `grab` over
  something draggable, and back to `default` elsewhere. Headless, it does
  nothing.
- `v.log(...args)`: a frame-tagged transcript line. `console.log/warn/error`
  also land in the transcript.
- `v.snapshot(label?)`: capture this frame.

`v.ctx`, `v.cache`, `v.sprite`, `v.image` and `v.paperTexture` are gone; a
call throws `RemovedCallError` naming what replaces it. Use pictures for
`cache`, `sprite` and `image`, `effects: { paper }` for `paperTexture`, and the
`View`'s calls, `at({ matrix })` or `v.pixels` for `ctx`.

## Sound

An optional `sound(model, p)` export returns the sounds the model holds, as
voices. The runtime calls it after every tick, in both runtimes.

```ts
export function sound(model: DeepReadonly<Model>): readonly Voice[] {
  return model.hits.map((h) => ({ id: `hit-${h.n}`, at: h.frame, kind: "sample", name: "ding", variant: h.n }));
}
```

### Choosing sounds

You cannot hear the result, so choose by meaning. Use a recorded sound from
the library for an event, and an instrument note for anything musical or
anything that shows a value by pitch. Use `tone`, `noise` and `pluck` only
when nothing below fits.

| The figure… | Use |
|---|---|
| confirms a right answer, a match, a reward | `sample` `ding`, `confirm`, or `chime` |
| rejects a move or an answer | `sample` `error` (once; never repeat it rapidly) |
| responds to a press, a toggle, a selection | `sample` `click`, `toggle`, `select`, `tick` |
| shows objects landing, touching, dropping | `sample` `knock`, `thud`, `clink`, `metal`, `drop` |
| shows a value rising or a count growing | `note` with `u.scaleNote(count)` on `marimba` or `kalimba` |
| finishes a level or a whole task | `sample` `fanfare` or `steel-drum`, or a three-note `bell` or `epiano` run |
| needs a soft background chord | `note` on `pad`, with `duration`, at gain 0.1–0.2 |

Rules that keep a figure pleasant:

- Make a sound for an event the learner caused or should notice. Never make a
  sound every frame or on every hover.
- Keep gains low: 0.3–0.5 for one sound, 0.15–0.25 each when sounds overlap.
  Voices add up and clip at ±1.
- Space repeated sounds at least 4–6 frames apart, and vary `variant` (and a
  small `rate` change, 0.9–1.1) so a repeated sound does not sound mechanical.
- Use notes from one scale. `u.scaleNote(step)` gives the pentatonic scale on
  C4, where any notes sound well together.
- Prefer short sounds. Silence is fine: a figure with no sound is better than
  one with a harsh sound.

### Voice kinds

Every voice has `id`, `at` (the frame it starts on) and `gain` 0..1 (default 0.5).

- `sample`: a recorded sound. `name` (below), `variant` (which take, default 0;
  wraps around), `rate` 0.5–2 (playback speed: faster is higher and shorter).
- `note`: an instrument note. `instrument` (below), `note` (a name: a letter,
  an optional `#` or `b`, and an octave, as `"C4"`, `"F#5"`, `"Bb3"`;
  C0–C9), `duration` seconds (optional; a struck instrument rings at most this
  long; the `pad` holds this long, then fades over 0.4 s). Notes are scaled so
  their loudest sample is `gain`.
- `pluck` (`freq`, `decay` seconds, `brightness` 0..1), `tone` (`freq`,
  `duration`, `wave` sine/triangle/square), `noise` (`duration`): raw
  primitives. A `square` tone is harsh; avoid it.

`u.scaleNote(step, { root, scale })` returns a note name `step` scale steps
from `root` (default `"C4"`; negative steps go down). `scale` is `pentatonic`
(default), `major` or `minor`. A result outside C0–C9 is an error, so keep
the step in range (`count % 10` stays within two octaves). Call it in
`update` and keep the note in the model.

### Instruments

| Instrument | Sound | Default length |
|---|---|---|
| `marimba` | wooden bars, warm and short | 1.2 s |
| `bell` | a church-like bell, long ring | 3 s |
| `kalimba` | thumb-piano tines, a bright pluck | 1.5 s |
| `epiano` | electric piano, soft and round | 1.5 s |
| `pad` | a sustained, soft synth tone | `duration` (1.5 s) |

### Recorded sounds

Recordings from Kenney's audio packs (kenney.nl, CC0). "Takes" is how many
variants the name has.

| Name | Takes | Sound and use |
|---|---|---|
| `ding` | 4 | a short, clear glass ding: a correct answer, a match, a small reward |
| `chime` | 2 | a longer glassy chime that rings out: an arrival, a finished step |
| `bell` | 3 | a struck metal bell: an alarm, a timer done, a round over |
| `confirm` | 4 | a soft rising two-note confirmation: saved, accepted, done |
| `error` | 4 | a low buzzy 'no': a wrong answer, a blocked move |
| `question` | 4 | a short questioning blip: a hint, a prompt to look |
| `click` | 5 | a crisp button click: pressing a control |
| `tick` | 3 | a tiny tick, quieter than a click: a counter step, a clock, a slider notch |
| `select` | 4 | a light selection blip: picking an item |
| `toggle` | 4 | a switch flipping: turning something on or off |
| `open` | 4 | a short opening swipe: a panel or lid opening |
| `close` | 4 | a short closing swipe: a panel or lid closing |
| `rise` | 3 | an upward sweep: growing, zooming in, levelling up |
| `fall` | 3 | a downward sweep: shrinking, zooming out, going away |
| `drop` | 4 | a soft plop: dropping an item into place, a droplet |
| `pop` | 2 | a tiny pop: a bubble, a seed, something appearing |
| `knock` | 4 | a light knock on wood: a block landing, a tap on a table |
| `thud` | 4 | a soft, dull thud: something soft landing, a ball on grass |
| `clink` | 4 | a light glass clink: glassware touching, a test tube set down |
| `metal` | 4 | a light metal hit: a tool, a lid, a pipe |
| `step-grass` | 3 | a footstep on grass |
| `step-wood` | 3 | a footstep on a wooden floor |
| `step-stone` | 3 | a footstep on concrete or stone |
| `step-snow` | 3 | a footstep in snow |
| `page` | 2 | a page turning: a book, a card flipping over |
| `coins` | 2 | coins jingling: money, collecting a reward |
| `creak` | 2 | a wooden creak: a door, a branch, a floorboard |
| `chop` | 1 | a chop: an axe, a knife on a board |
| `card` | 3 | a card placed on a table |
| `dice` | 2 | dice thrown onto a table |
| `power-up` | 2 | an electronic rising arpeggio: a power-up, a level gained (game-like) |
| `zap` | 2 | an electronic zap: electricity, a laser, a spark (game-like) |
| `fanfare` | 2 | a short plucked-strings flourish: a win, a level complete |
| `steel-drum` | 1 | a short steel-drum flourish: a bright, cheerful success |

### The rules of voices

- A voice is one sound. Give each new sound a new id (keep a counter in the
  model). Returning a voice again is harmless; returning its id with
  different data is an error. Dropping it from the list does not stop it.
- `at` is the frame it starts on. A new voice may not start before the frame
  that first returns it, so a longer run never changes earlier audio. Events
  for frame N run before its tick, so a sound from a click on frame N starts
  at `model.frame + 1` when the model keeps the last tick's frame.
- At most 32 new voices a frame.
- A voice budget keeps busy moments from piling up: a new voice is dropped
  when 4 kept voices of the same sound, or 16 in all, start within 15 frames
  (a quarter second) of its start, before or after it. Each voice counts for
  that quarter second whatever its length, so a long tone repeated slowly is
  not limited. The same sound is a
  sample by name (any `variant` or `rate`), a note by instrument and note
  name, or a `pluck` or `tone` by `freq`. So a sketch can return a sound for
  every hit without counting them itself. A dropped voice stays dropped; the
  transcript shows `sound dropped "hit-9" thud: …`. Both runtimes drop the
  same voices.
- Headless runs write `sound.wav` and `sound.png` (the waveform, a red mark at
  each voice start, a grey line each second) beside the frames, and a
  transcript line per voice (`sound sample "hit-3" ding #3`). The same voice
  renders the same samples in both runtimes.
- In a browser, sound starts after the first click, key press or control
  change on the figure; that input's own sound plays. The recorded sounds load
  separately when the figure first appears; a `sample` voice due while they
  load waits up to 0.25 s, then is dropped with a console line. Restart stops
  sounding voices.
- Replay from the start is exact. Seeking to a frame is not supported yet.
- Examples: `canvas-loop/src/gallery/guitar-strings/`,
  `canvas-loop/src/examples/sound-tea.ts`.

## Params reference

`params` is a record of declarations. Five types:

| Type | Declaration | `p` value |
| --- | --- | --- |
| number | `{ type: "number", min, max, default, step?, control? }` | `number` — a slider, or with `control: "field"` a box the person types into (only a valid, in-range value is sent; `step: 1` requires a whole number) |
| boolean | `{ type: "boolean", default }` | `boolean` |
| select | `{ type: "select", options: [...] as const, default }` | union of `options` |
| text | `{ type: "text", default, placeholder?, multiline?, maxLength? }` | `string`, empty allowed — a text box (a textarea with `multiline`) for typed answers, formulas, predictions |
| trigger | `{ type: "trigger" }` | — (arrives only as a `trigger` msg) |

Declare with `as const satisfies ParamsDecl` so selects narrow to their option
union. Read values via `u.params.name` (in `update`) and the `p` argument (in
`draw`). Triggers carry no value — handle the `{ type: "trigger", name }` msg.

Every declaration also takes `label`, `hint` and `panel`. `panel: false`
keeps the param out of the side panel.

### Inputs over the canvas

`v.control(name, { x, y, w, h?, size?, align?, bold? })` in `draw` puts the
param's native input over the canvas at that box (logical pixels) for this
frame: a slider or number field, checkbox, select, text box or button. Browser
figures place the real `<input>`/`<select>`/`<textarea>` there and take it out
of the panel; headless renders draw a stand-in showing the current value, so
frames show the layout. Call it every frame the input should show: an input not
placed in a frame is hidden (a three-species equation places three boxes).
Scripted `param` events drive it headless as before. A text box sends every
edit (empty included) as a `param` msg, so `update` sees the answer as it is
typed; keys typed into it are not `keydown` msgs. Use `u.handled` and a check
button, or check on each edit, as the exercise needs. Only `mountSketch` figures
place inputs so far; the React figure and the playground keep the panel.

## Activity

An optional `activity(model)` export turns the state into a small data
object, the way `draw` turns it into pixels:

```ts
export function activity(model: DeepReadonly<Model>): Record<string, unknown> {
  return { molecules: model.molecules.map(formula), openBonds: openBonds(model) };
}
```

After an input `update` handled (it called `u.handled`) or a param change,
the runtime calls it on the new model and adds the result as `activity` to
the event it streams to the host (`onEvent`). Headless transcripts show it as
an `activity {…}` line. Keep it pure and small: what the state means, not
the whole model. If it throws or returns a non-object, the event goes without
it and the console warns once; the sketch keeps running. What the host does
with it is the host's business: a beebox figure logs it as the person's
activity for the chat agent.

## Events file

The format is in the [README](./README.md#events-file). A mouse entry can aim
at a named drawing with `"target": "pan-left"` instead of `x` and `y`.

## Engagement verdicts

Every scripted **interaction** event (mouse, key, trigger — not `tick`, not
`param`, not `snapshot`) gets an engagement verdict on its transcript line, so
an events file reads as a test of whether each input connected:

```
**[frame 30]** mousedown (180,216) on pan-left → add-weight
**[frame 40]** keydown ArrowUp → Δmodel
**[frame 55]** mousedown (200,150) → (unhandled)
```

- **a name**: `update` called `u.handled("add-weight")` (several calls
  join with `, `). `on pan-left` names the [drawings hit](#names-and-hits).
- **Δmodel**: no name, but `update` returned a different model reference.
- **(unhandled)**: no name and the same model. Nothing engaged.

A `tick` changes everything and handles nothing; an absorbed click (a toggle
already in its target state) handles and changes nothing. Call `u.handled`
when `Δmodel` is too coarse. A scripted click aimed at a moving target that
has drifted reads `(unhandled)`, so the miss shows in the transcript. `param`
changes keep their own `param: name → value` line. The browser runtime
streams the same signal on its `onEvent` entries as `handled?: readonly
string[]` and `changed?: boolean`.

## Dual-export entries (embedding as a figure)

A TEA module may ALSO carry a `default` export — a host-specific figure
factory that hands the named exports to the imperative browser API:

```ts
export default (cl, { mount, figure }) =>
  cl.mountSketch(mount, { module: { params, canvas, init, update, draw }, initialParams: figure.params });
```

The CLI reads only the contract exports and ignores `default`, so one file is
both the headless sketch and the figure entry.

`mountSketch(mount, opts)` lives at `@ianbicking/canvas-loop/browser` — the
React-free twin of `<SketchFigure>` (which delegates to the same runtime
attach). Its opts: `module` (validated TEA module object), `seed?`,
`autoplay?`, `panel?` (declaration-generated controls; default on when the
module declares params), `transport?` (play/pause/restart; default off —
embeds are frameless), `initialParams?` (validated against the declaration;
unknown names or mismatched types warn and fall back to defaults),
`onParamsChange?`, `onEvent?`, `onError?`. It draws with WebGPU: a browser
without it reports `NoWebGpuError` through `onError`, and one with no GPU
adapter `NoGpuAdapterError`. It injects no styles — hosts import
`@ianbicking/canvas-loop/browser/figure.css` (CSP-clean by construction).

A figure's log (`v.log` and warnings) goes to the browser
console as `[canvas-loop] frame N: …`. The figure shrinks to fit a narrow column; the
canvas keeps its aspect ratio and pointer input stays accurate.

## The discipline (one list)

- **All state in `Model`.** No module-level `let`/`var`; `const` for fixed
  data/functions only.
- **State changes only by `update` returning a new `Model`.** Never mutate
  `model` (assignment, `delete`, `push`/`splice`/`sort`/…).
- **`draw` returns its drawing.** Every node it makes goes into the list it
  returns.
- **Modes as a discriminated-union field** on the model
  (`mode: { type: "idle" } | { type: "dragging"; index: number }`) + exhaustive
  switch — a statechart's modal part, zero machinery.
- **No async.** No `async`/`await`/`.then`/`new Promise`; runs are synchronous.
- **Exhaustive switch on `msg.type`.** List every case; no `default`.
- **Import only `@ianbicking/canvas-loop`** (types only) and sibling
  `./<name>-tea.js` helpers.

Lint enforces most of it on `*-tea.ts` (`tea/no-module-state`,
`tea/no-model-mutation`, `tea/no-async-sketch`, `tea/no-classes`,
`no-restricted-imports`, and type-aware `switch-exhaustiveness-check`).

## Worked example

[`src/examples/orbit-tea.ts`](./src/examples/orbit-tea.ts) +
[`src/examples/orbit-tea-events.json`](./src/examples/orbit-tea-events.json) — a sun with
three orbiting planets. It exercises every param type (`speed-scale` number,
`show-orbits` boolean, `focus` select, `reset` trigger), a mode union
(`{ type: "idle" } | { type: "selected"; index }`), and direct pointer
manipulation (click a *moving* planet to select it; ArrowUp/Down nudge its
speed). It predates names and computes its hits from position math; a new
sketch names the planets and reads `msg.target`
([Names and hits](#names-and-hits)), as
[`src/examples/scale-tea.ts`](./src/examples/scale-tea.ts) does with
[its events file](./src/examples/scale-tea-events.json).

`draw` returns one list: a `.map` over the planets, `&&` for what a param or
the mode turns on, and small components (`drawPlanet`, `drawHud`):

```ts
return [
  v.background("#0b1020"),
  p["show-orbits"] && model.planets.map((planet) => v.circle(CENTER_X, CENTER_Y, planet.orbitRadius, ORBIT_RING)),
  v.circle(CENTER_X, CENTER_Y, SUN_RADIUS, { fill: "#facc15" }),
  model.planets.map((planet, i) =>
    drawPlanet({ v, planet, pos: planetPos({ planet, frame: model.frame, scale }), selected: mode.type === "selected" && mode.index === i }),
  ),
  drawHud({ v, model, p }),
];
```

Note the boundary: `reset` restores the *model* (planets, selection) but leaves
the *params* (`speed-scale`, `show-orbits`) at their current values — params are
the runtime's store, model is the sketch's.
