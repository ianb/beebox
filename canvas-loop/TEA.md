# Writing a sketch (TEA)

A canvas-loop sketch follows The Elm Architecture (TEA). It is a pure fold:
`model = msgs.reduce(update, init())`, then `draw` renders the model. State
changes only when `update` returns a new `Model`. Types, a runtime deep-freeze,
a double-run byte-diff and lint enforce this. TEA is the only sketch form: a
module that exports `setup` gets a loader error that names the TEA form.

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
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "@ianbicking/canvas-loop";

export const params = { /* … */ } as const satisfies ParamsDecl;   // optional
export const canvas = { width: 500, height: 400 };                 // optional (default 400×300)

export type Model = { /* your state */ };                          // sketch-defined

export function init(u: Util<typeof params>): Model;
export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model;
export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void;
```

- **`init`** runs once, before frame 0, returning the initial `Model`.
- **`update`** folds one `Msg` into a new `Model`. Pure: same inputs → same
  output. Return a *new* value — never mutate `model` (it is deep-frozen; a
  mutation throws).
- **`draw`** paints the `Model`. View-only: no randomness, no state store beyond
  the `p` argument. It cannot change the world.

Capabilities are injected, not ambient — `update` gets `Util` (randomness,
params, log, `handled`) and no drawing; `draw` gets `View` (drawing, log,
snapshot, `ctx`) and no randomness. That withholding *is* the enforcement.

[Drawing](#drawing) below covers `View`.

The lint preset caps functions at 2 parameters. Sketch directories
(`src/examples/`, `src/gallery/`) turn that cap off, so a sketch there needs
nothing. Elsewhere, if lint reports `max-params` on `update` or `draw`, the
contract signatures are the one sanctioned exception; put this exact comment
on each:

```ts
// eslint-disable-next-line max-params -- TEA contract signature
```

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
  | { type: "mousedown"; x: number; y: number }
  | { type: "mouseup"; x: number; y: number }
  | { type: "mousemove"; x: number; y: number }
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

So the world an event sees is exactly the state after frame **N−1**'s draw, and
`draw` runs exactly once per frame headless. `init` runs once before frame 0.

In a browser, `draw` runs only when the frame's model is a new object, a
param changed, or input arrived; otherwise the canvas keeps the last picture.
So `draw` must read only `model` and `p`: a value from anywhere else (a module
`let`, the clock) would go stale. To animate, change the model on `tick`. A
figure scrolled off screen sleeps: its frames stop until it is back, as when
paused, and a sound playing when it left is cut off.

## Drawing

`draw(v, model, p)` paints through `v: View`. Nothing on `View` sets state
that a later call reads: each call says how it paints.

### Styles

A shape call takes a `Style` as its last argument. A style is a plain object.
Keep the ones you reuse in `const`s and spread to vary them:

```ts
import type { DeepReadonly, Style, TextOptions, View } from "@ianbicking/canvas-loop";

const CARD: Style = { fill: "#f8fafc", stroke: "#334155", weight: 2 };
const INK: Style = { stroke: "#1d2a44", weight: 3, brush: "ink" };
const LABEL: TextOptions = { size: 14, fill: "#334155", align: "center", valign: "middle" };

interface Model {
  hot: boolean;
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.roundRect(20, 20, 160, 80, 8, model.hot ? { ...CARD, fill: "#fde68a" } : CARD);
  v.line(30, 80, 170, 80, INK);
  v.text("Sun", { x: 100, y: 50 }, LABEL);
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

A brush preset kept in a variable needs its type, or TypeScript widens
`preset` to `string`: `const SHADE: BrushPreset = { preset: "bristle", load: 0.4 }`.
[BRUSHES.md](./BRUSHES.md) lists the presets, their fields and gestures.

Colors are CSS strings only (`"#38bdf8"`, `"tomato"`, `"rgb(…)"`).

The style is checked at each call. An unknown key, a negative `weight` or an
unknown brush name throws an error that names the call and the key. A call
that can draw nothing logs a line to the transcript once per distinct message:
a `line` or open `curve` with no stroke, or a closed shape with neither fill
nor stroke.

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
v.text(s, { x, y, w?, h? }, options)    // returns the bounds drawn
v.textBounds(s, { x, y, w?, h? }, options) // the same bounds, nothing drawn
v.textWidth(s, options)                 // width in logical pixels
u.textBounds(s, { x, y, w?, h? }, options) // in init and update: the same, without v.at
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
| `keepInside` (slide the text back inside the canvas, 4px margin, when it would cross an edge) | off |
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
- Which fonts exist depends on the machine. Use common families.
- Use `textBounds` to place a label before drawing it, for example to move it
  clear of another label or to size a backing box.
- `u.textBounds` and `u.textWidth` measure in `init` and `update`, so a hit
  area or tile can be sized to its label instead of a guessed constant. They
  give exactly what `draw` then gets for the same text at no `v.at` transform.
  Measure when you need it rather than storing widths in the model: widths
  are cached, and a web font that loads later changes them. Headless runs and
  a browser can measure the same font slightly differently. A `halo` in the background
  color keeps a label readable where it crosses a line.
- The run warns, once per pair of texts, when two different texts overlap in
  a frame (the same text twice, as for a shadow, is not reported). A rotated
  text counts as the upright box around it. After ten pairs it stops
  reporting. A `halo` is part of the bounds. Headless
  runs also warn when the font has no glyph for a character, which draws as
  an empty box or nothing; use a plain word or another character.

### Scopes

Each scope takes a body function. Its effect ends when the body returns.

- `v.at({ translate?: [x, y], rotate?: radians, scale?: n | [sx, sy] }, body)`
  transforms the drawing in `body`: translate, then rotate, then scale. For
  another order, nest `at` calls. It has no layer: `erase` inside it erases
  the canvas beneath.
- `v.group({ opacity?, blend?, effects? }, body)` draws `body` on its own
  layer, then composites the layer once. `erase` inside a group erases only
  the group's pixels. `effects` adds blur, a glow, a drop shadow or colour
  adjustments: see [BRUSHES.md](./BRUSHES.md#effects).
- `v.mask(maskBody, body)` keeps `body` where `maskBody` paints, in
  proportion to its alpha: a gradient in the mask fades the body out. Unlike
  `clip`, the mask is any drawing and its edge can be soft. Like `group`, the
  body draws on its own layer: `erase` inside it erases only the body, and
  blends inside it blend with the body only.
- `v.clip(shape, body)` clips `body` to a polygon or path, or to the union of
  an array of them.
- `v.cache(key, body, { blend?, erase? }?)` draws `body` once into a stored
  layer and pastes it on later calls with the same `key`.
- `v.sprite({ key, width, height }, body)` draws `body` once in its own
  coordinates and returns a handle. `v.image(sprite, x, y, { opacity?, blend?,
  erase? }?)` draws it with its top-left at (x, y), under the current `at`.

[BRUSHES.md](./BRUSHES.md#animation-and-interaction) covers cache and sprite
keys.

### Other `View` members

- `v.width`, `v.height`: the canvas size.
- `v.tween(keys, t, ease?)`: a number moving through keyframes
  `[[time, value], …]` (sorted by time) at time `t`, eased within each span:
  `v.tween([[0, 40], [30, 260], [60, 260]], model.frame, "in-out")`. It holds
  the first and last values outside the keys. `v.tweenPoint` does the same
  for tuples (points, colour channels). Eases: `"linear"` (default), `"in"`,
  `"out"`, `"in-out"`, `"out-back"` (overshoots and settles), `"step"`
  (holds, then jumps at the span's end). A keyframe `[time, value, ease]`
  eases the span it starts with its own curve. Two keyframes at the same time
  make a jump. `v.ease(name, u)` is one curve at `u` in 0..1.
- `v.paper({ scale, contrast, seed })` and `v.paperTexture(amount)`: see
  [BRUSHES.md](./BRUSHES.md#paper).
- `v.control(name, box)`: see [Inputs over the canvas](#inputs-over-the-canvas).
- `v.cursor(kind)`: the pointer's look over a browser figure. It starts as
  the normal arrow. Set `pointer` over something a tap acts on, `grab` over
  something draggable, and back to `default` elsewhere. Headless, it does
  nothing.
- `v.debugBox(label, x, y, w, h)`: a labelled box drawn only with
  `run --outline`.
- `v.log(...args)`: a frame-tagged transcript line. `console.log/warn/error`
  also land in the transcript.
- `v.snapshot(label?)`: capture this frame.
- `v.ctx`: the raw `@napi-rs/canvas` context, for what `View` does not cover
  (shadows, `drawImage`). It follows `at`, `group` and `clip`. Prefer the
  calls above: they are data, so a `draw` stays serializable in principle.
  [`src/examples/fjord-tea.ts`](./src/examples/fjord-tea.ts) draws a full
  scene without `ctx`.

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

`params` is a record of declarations. Four types:

| Type | Declaration | `p` value |
| --- | --- | --- |
| number | `{ type: "number", min, max, default, step?, control? }` | `number` — a slider, or with `control: "field"` a box the person types into (only a valid, in-range value is sent; `step: 1` requires a whole number) |
| boolean | `{ type: "boolean", default }` | `boolean` |
| select | `{ type: "select", options: [...] as const, default }` | union of `options` |
| trigger | `{ type: "trigger" }` | — (arrives only as a `trigger` msg) |

Declare with `as const satisfies ParamsDecl` so selects narrow to their option
union. Read values via `u.params.name` (in `update`) and the `p` argument (in
`draw`). Triggers carry no value — handle the `{ type: "trigger", name }` msg.

Every declaration also takes `label`, `hint` and `panel`. `panel: false`
keeps the param out of the side panel.

### Inputs over the canvas

`v.control(name, { x, y, w, h?, size?, align?, bold? })` in `draw` puts the
param's native input over the canvas at that box (logical pixels) for this
frame. Browser figures place the real `<input>`/`<select>` there and take it out
of the panel; headless renders draw a stand-in showing the current value, so
frames show the layout. Call it every frame the input should show: an input not
placed in a frame is hidden (a three-species equation places three boxes).
Scripted `param` events drive it headless as before. Only `mountSketch` figures
place inputs so far; the React figure and the playground keep the panel.

## Events file

The format is in the [README](./README.md#events-file).

## Engagement verdicts

Every scripted **interaction** event (mouse, key, trigger — not `tick`, not
`param`, not `snapshot`) gets an engagement verdict on its transcript line, so an
events file reads as a test of whether each input actually connected:

```
**[frame 30]** mousedown (297,288) → select-planet
**[frame 40]** keydown ArrowUp → Δmodel
**[frame 55]** mousedown (200,150) → (unhandled)
```

The verdict is one of:

- **a name** — `update` called `u.handled("select-planet")` (allowed multiple
  times per dispatch; names join with `, `). The explicit acknowledgment that
  this input engaged.
- **Δmodel** — no name, but `update` returned a *different* model reference than
  before the fold. State changed; the free signal, zero author cost.
- **(unhandled)** — no name and the model reference was unchanged. Nothing
  engaged.

`u.handled(name)` is distinct from both "code ran" and "state changed": a `tick`
changes everything and handles nothing; an absorbed click (a toggle already in
its target state) handles and changes nothing. Reach for it when the free
`Δmodel` signal is too coarse.

The motivating case: a scripted click aimed at a *moving* target that has drifted
by the time the frame arrives reads `(unhandled)` — the miss is visible in the
transcript instead of having to be inferred from later frames.

`param` changes keep their own `param: name → value` line (a param change is
definitionally applied, so it carries no separate verdict). The browser runtime
streams the same signal on its `onEvent` entries as structured
`handled?: readonly string[]` / `changed?: boolean` fields.

## Dual-export entries (embedding as a figure)

A TEA module may ALSO carry a `default` export — a host-specific figure
factory that hands the named exports to the imperative browser API:

```ts
export default (cl, { mount, figure }) =>
  cl.mountSketch(mount, { module: { params, canvas, init, update, draw }, initialParams: figure.params });
```

The headless loader (`src/headless/tea-load.ts`) reads only the contract
exports, so the CLI ignores `default`. One file is simultaneously the
headless-runnable sketch and the embeddable figure entry.

`mountSketch(mount, opts)` lives at `@ianbicking/canvas-loop/browser` — the
React-free twin of `<SketchFigure>` (which delegates to the same runtime
attach). Its opts: `module` (validated TEA module object), `seed?`,
`autoplay?`, `panel?` (declaration-generated controls; default on when the
module declares params), `transport?` (play/pause/restart; default off —
embeds are frameless), `initialParams?` (validated against the declaration;
unknown names or mismatched types warn and fall back to defaults),
`onParamsChange?`, `onEvent?`. It injects no styles — hosts import
`@ianbicking/canvas-loop/src/browser/figure.css` (CSP-clean by construction).

A figure's log (`v.log`, style notes, overlap warnings) goes to the browser
console as `[canvas-loop] frame N: …`. The figure shrinks to fit a narrow column; the
canvas keeps its aspect ratio and pointer input stays accurate.

## The discipline (one list)

- **All state in `Model`.** No module-level `let`/`var`; `const` for fixed
  data/functions only.
- **State changes only by `update` returning a new `Model`.** Never mutate
  `model` (assignment, `delete`, `push`/`splice`/`sort`/…).
- **Modes as a discriminated-union field** on the model
  (`mode: { type: "idle" } | { type: "dragging"; index: number }`) + exhaustive
  switch — a statechart's modal part, zero machinery.
- **No async.** No `async`/`await`/`.then`/`new Promise`; runs are synchronous.
- **Exhaustive switch on `msg.type`.** List every case; no `default`.
- **Import only `@ianbicking/canvas-loop`** (types only) and sibling
  `./<name>-tea.js` helpers.

Lint enforces all of it on `*-tea.ts` (`tea/no-module-state`,
`tea/no-model-mutation`, `tea/no-async-sketch`, `tea/no-classes`,
`no-restricted-imports`, and type-aware `switch-exhaustiveness-check`).

## Worked example

[`src/examples/orbit-tea.ts`](./src/examples/orbit-tea.ts) +
[`src/examples/orbit-tea-events.json`](./src/examples/orbit-tea-events.json) — a sun with
three orbiting planets. It exercises every param type (`speed-scale` number,
`show-orbits` boolean, `focus` select, `reset` trigger), a mode union
(`{ type: "idle" } | { type: "selected"; index }`), and direct pointer
manipulation (click a *moving* planet to select it; ArrowUp/Down nudge its
speed). Because position is a pure function of `frame`, hit-testing a moving
target is a calculation, not trial-and-error:

```ts
function planetPos(a: { planet: Planet; frame: number; scale: number }) {
  const angle = a.planet.angle0 + a.planet.speed * a.scale * a.frame;
  return { x: CENTER_X + a.planet.orbitRadius * Math.cos(angle), /* … */ };
}
```

`update` returns new models — nudging a planet's speed rebuilds the array
immutably, selection swaps the `mode` field:

```ts
case "keydown":
  return nudgeSelected({ model, key: msg.key, u });   // → { ...model, planets: planets.map(…) }
case "trigger":
  return msg.name === "reset" ? init() : model;
```

`draw` keeps its styles in `const`s and passes one to each call:

```ts
const ORBIT_RING: Style = { stroke: "#1e293b", weight: 1 };
const SELECTION_RING: Style = { stroke: "#f8fafc", weight: 2 };

v.circle(CENTER_X, CENTER_Y, SUN_RADIUS, { fill: "#facc15" });
v.circle(pos.x, pos.y, planet.size / 2, { fill: planet.color });
if (selected) v.circle(pos.x, pos.y, planet.size / 2 + HIT_PADDING + 2, SELECTION_RING);
v.text(`selected: ${selectedName}`, { x: 8, y: 26 }, HUD_TEXT);
```

Note the boundary: `reset` restores the *model* (planets, selection) but leaves
the *params* (`speed-scale`, `show-orbits`) at their current values — params are
the runtime's store, model is the sketch's.
