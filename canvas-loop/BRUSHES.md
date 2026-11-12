# Brushes, gestures, paper, groups

canvas-loop can draw with real-looking brushes. A brush is part of a
shape's style, and it changes how **strokes** look. Fills stay flat.

```ts
import type { Style } from "@ianbicking/canvas-loop";

const INK: Style = {
  stroke: "#1d2a44",
  weight: 4,                                   // stroke width in pixels, at full pressure
  brush: "ink",                                // strokes are ink marks
  gesture: { pressure: "taper", wobble: 1 },
};

v.background("#f6f2e7");
v.curve([[40, 80], [120, 40], [200, 90]], false, INK);         // a smooth curve through the points
v.circle(260, 70, 40, INK);                                    // any stroked shape takes the brush
v.line(40, 120, 300, 120, { stroke: "#1d2a44", weight: 4 });   // no brush: a plain Canvas2D stroke
```

[TEA.md](./TEA.md#styles) lists every style key.

## Shapes

All stroked shapes take their style's brush: `line`, `curve`, `path`, `polygon`,
`rect`, `circle`, `ellipse`, `arc`, `triangle`. Each shape is one **mark**.

- `curve(points, closed, style)` draws a smooth curve through every point
  (Catmull-Rom). With `closed: true` it closes into a loop. A closed curve
  through 4 points is a rounded blob; for a sharp corner, use `path` or put
  two points close together.
- `curvePath(points, closed?)` returns the same curve as path commands, for
  `clip(...)` or `path(...)`.
- `path(commands, style)` takes `["move", x, y]`, `["line", x, y]`,
  `["quad", cx, cy, x, y]`, `["bezier", c1x, c1y, c2x, c2y, x, y]` and
  `["close"]`. Each `move` starts a separate piece. Each piece tapers on its own.

A shape whose style has no `stroke` gets no mark. A fill is always flat
colour. For textured shading, draw marks inside a `clip` (see below).

### Shape helpers

These return data, so their results work with any style and with `clip`:

- `tube(points, { width, profile? })` returns the closed outline of a tube
  (an arm, a leg, a stem, a tail) around a smooth centreline through `points`,
  with round ends. `profile` is an envelope (as for pressure) that scales the
  width along the tube: `[[0, 1], [1, 0.6]]` narrows it toward the end.
  Draw it with `v.path(outline, style)`, clip with `v.clip(outline, …)`.
- `offset(points, distance)` grows (positive) or shrinks (negative) a closed
  outline given as points. Use it for rim light and form shadows: inside the
  shape's clip, fill the shape offset and shifted away from the light.

```ts
const crescent = v.offset(HEAD, 10).map(([x, y]): Vec2 => [x + 12, y + 10]);
v.clip(v.curvePath(HEAD, true), () => {
  v.curve(crescent, true, { fill: SHADE });   // shadow crescent, lower right
});
```

Points are ordinary data. Name the ones you reuse:

```ts
const P = { chin: [200, 260], earL: [120, 90], earR: [280, 90] } as const;
```

## Brushes

A style's `brush` is a preset name or a preset with fields changed. The presets:

| Name | Kind | Looks like | Typical `weight` |
| --- | --- | --- | --- |
| `ink` | ink | smooth ink line; pressure thins it | 2–8 |
| `marker` | ink | broad, flat, translucent; multiplies over what is under it | 8–24 |
| `pencil` | stamp | graphite: grainy, light; build tone with several strokes | 2–5 |
| `chalk` | stamp | coarse, broken by the paper grain | 8–20 |
| `airbrush` | stamp | soft, even spray with no texture: glows and gradients | 20–80 |
| `wash` | stamp | broad, soft-edged, translucent tone with a little paper texture: shadows | 20–80 |
| `bristle` | bristle | a loaded paint brush; separate bristle lines that dry out on long strokes | 12–40 |

To stop a marker multiplying, override its blend: `brush: { preset: "marker", blend: "normal" }`.

Texture needs size and contrast. A brush in a colour close to the colour under
it, or a bristle or chalk mark shorter than a few widths, reads as flat tone
or as noise. Use `--zoom` (below) to see what a mark really looks like.

To change fields, give the preset as data:
`brush: { preset: "ink", thinning: 0.3 }`. A field that does not apply to the
preset's kind is an error, which names the valid fields. A preset kept in a
variable needs the `BrushPreset` type:
`const SHADE: BrushPreset = { preset: "wash", opacity: 0.4 }`.

| Field | Kinds | Meaning |
| --- | --- | --- |
| `opacity` | all | opacity of the whole mark, 0..1. A mark does not darken where it crosses itself. |
| `grain` | all | how much the paper texture shows through, 0..1 |
| `blend` | all | blend with the drawing underneath, e.g. `"multiply"` |
| `thinning` | ink | how much low pressure thins the line, 0..1 |
| `tip` | stamp | `"hard"` or `"soft"` |
| `spacing` | stamp | dab spacing, as a fraction of the width |
| `flow` | stamp, bristle | opacity of one dab or one bristle line |
| `sizeByPressure`, `opacityByPressure` | stamp | how much low pressure shrinks or fades each dab |
| `scatter`, `sizeJitter` | stamp | random sideways offset and size variation |
| `bristles` | bristle | number of bristles |
| `load` | bristle | paint per bristle, as a fraction of the mark's length; lower is drier |
| `spread` | bristle | random variation between bristles |

## Gestures

A style's `gesture: { pressure, wobble, seed }` sets how the hand moves for
its brushed marks. Without a brush it does nothing.

- `pressure` is a value over the mark's length, from its start (0) to its
  end (1):
  - a number, e.g. `0.6`
  - a preset: `"even"`, `"taper"` (thin at both ends), `"taper-in"`,
    `"taper-out"`, `"swell"` (thick in the middle), `"press"` (heavy start,
    lighter end)
  - keyframes `[[0, 0.2], [0.3, 1], [1, 0.4]]`, sorted by position

  The default is `"taper"` for open shapes and `"even"` for closed ones.
- `wobble` moves the line sideways by up to that many pixels, smoothly, like a
  hand. The default is 0.
- `faint: true` says the mark is meant to be faint, so it gets no faint-mark
  warning (see "Faint marks").
- `seed` fixes a mark's random character (wobble, scatter, bristle drying).
  Without a seed, a mark's randomness comes from its own points only. Adding
  or removing **another** mark never changes this one, and changing its brush,
  pressure, width or colour keeps its wobble. Moving one of its points changes
  all of its randomness, unless you give it a `seed`.

`--seed` on the command line does not change brush marks.

## Paper

Grainy brushes (pencil most of all) show the paper's tooth. The paper is fixed
to the canvas, so marks line up with each other's grain. Change it with
`v.paper({ scale, contrast, seed })`: `scale` is the size of the tooth in
pixels (default 3), `contrast` is 0..1 (default 0.7).

## Groups, blend, erase

```ts
v.group({ opacity: 0.6, blend: "multiply" }, () => {
  // drawn on its own layer, then composited once
});
```

- **Opacity** applies once, to the finished group. Opaque shapes inside the
  group do not darken where they overlap.
- **Blend** is how the finished group combines with what is under it:
  `"normal"`, `"multiply"`, `"screen"`, `"overlay"`, `"darken"`, `"lighten"`,
  `"soft-light"`, `"hard-light"`, `"color-dodge"`, `"color-burn"`.
- A style's `blend` does the same for one shape.
- A style with `erase: true` removes pixels: the fill, stroke or mark cuts a
  hole. Inside a group it removes only the group's own pixels. Elsewhere,
  including inside `at`, it removes the canvas's pixels.
- Groups nest.
- `clip([shapeA, shapeB, …], body)` clips to the union of several shapes, for
  example one light pass over a whole figure made of parts.

## Gradients and paper texture

- `ellipseGradient(x, y, w, h, stops)` is a radial gradient that fills an
  ellipse of width `w` and height `h` (like `ellipse`), for flat pools of
  light and oval glows. `radialGradient` is always circular.
- `paperTexture(amount)` shows the paper's tooth across everything drawn so
  far, so flat fills and gradients look printed on paper. Call it last;
  0.3–0.6 is a typical range.

## Colour tips

- A translucent colour mixes with what is under it: pink at 50% over green
  turns brownish grey. For a clean tint, paint an opaque core and soften its
  edge with `wash` or `airbrush`.
- `blend: "screen"` lightens toward white; it does not add colour. For
  coloured light, use `"normal"` at a lower opacity, or `"overlay"`.

## Faint marks

A mark whose strongest pixel lands below about 8% opacity (after its brush
and any open groups) is too faint to see. The transcript gets a warning line
with the mark's position (and the sprite or cache it was drawn into, whose
coordinates the position is in), so you do not spend a cycle finding out. For
a mark that is meant to be that faint, give its style `gesture: { faint: true }`. The check reads
pixels back, so it runs headless only; a browser figure skips it.

Shading inside a shape: fill the shape, clip to it and draw marks, then draw
its outline last. The clip includes the inside half of the outline, so marks
drawn after the outline cover part of it.

```ts
const HATCH: Style = { stroke: "#3f7f3a", weight: 2.5, brush: "pencil" };
const OUTLINE: Style = { stroke: "#1f2a1f", weight: 3, brush: "ink" };

v.curve(BODY, true, { fill: "#7ccf6a" });   // 1. flat base colour
v.clip(v.curvePath(BODY, true), () => {     // 2. marks, kept inside the shape
  for (let i = 0; i < 20; i += 1) v.line(100 + i * 8, 300, 140 + i * 8, 200, HATCH);
});
v.curve(BODY, true, OUTLINE);               // 3. the outline, last
```

## Transforms

Brushes follow `v.at({ translate, rotate, scale }, body)` as strokes do:
`scale: 2` doubles a mark's position and width. Under a non-uniform scale the brush stays
round.

## Seeing texture: zoom

At 1× a whole frame hides grain, bristle streaks and edges. Add zoomed crops
to a run:

```sh
pnpm --dir canvas-loop run cli run sketch.ts --frames 1 --out out --zoom 90,80,160,120 --zoom 140,250,120,120@4
```

Each `--zoom x,y,w,h[@scale]` writes `frame-0000-zoom1.png` and so on
(nearest-pixel, scale 3 by default) and lists it in the transcript under the
frame. `cli zoom out/frame-0000.png x,y,w,h` crops a frame you already have.

## Animation and interaction

Brush marks are slow: a full painted page takes 1–2 seconds per frame
headless. To animate one:

- `cache(key, body, { blend?, erase? }?)` draws `body` once into a stored layer and pastes it on
  later calls with the same `key`. Put everything that does not move in it, and
  draw only the moving parts each frame. The key must name what the pixels
  depend on: when a param changes the static scene, put its value in the key
  (`` v.cache(`sky-${p.dusk}`, …) ``). The cache keeps the transform from the first
  call, and the 24 most recent keys.
- `sprite({ key, width, height }, body)` paints `body` once, in its own
  coordinates (0..width, 0..height), and returns a handle.
  `image(sprite, x, y, { opacity?, blend?, erase? })` draws it under the
  current `at`. Use sprites for things that move but keep their look: a character, a boat, a cloud. Paint each pose
  as its own sprite (`key: "baker-wave"`) and switch between them; rock, bob or
  flip it with `at` (`scale: [-1, 1]` flips). A sprite must fit the
  canvas; the 400 most recent keys are kept.

```ts
const boat = v.sprite({ key: "boat", width: 120, height: 60 }, () => paintBoat(v));
v.at({ translate: [x, y], rotate: Math.sin(model.frame / 30) * 0.05 }, () => {  // rock
  v.image(boat, -60, -40);
});
```

- A mark's randomness comes from its points, so a mark whose points move
  re-rolls its wobble every frame: the line "boils", as in hand-drawn
  animation. To keep it still, give its style `gesture: { seed }`.

### Recipes

- **Light under a night shade.** Darken the page with a multiply rect, then
  draw lit windows and lamps after it with `blend: "screen"` in their style.
  For a glow sprite, `v.image(glow, x, y, { blend: "screen" })` brightens
  what is under it.
- **Someone behind a window frame.** Draw the person, then the window's frame
  and glazing bars as a sprite on top; or clip the person to the window
  opening (`clip(openingRect, () => …)`).
- **Randomness on the draw side.** TEA's `draw` gets no `random`. Scatter that
  never changes (stars, grass) can be computed once into module `const` arrays
  from a small seeded generator; a mark's own jitter comes from its `seed`.

## Seeing what you made

- `run --zoom x,y,w,h` adds enlarged crops (see "Seeing texture").
- `run --outline` draws, over every captured frame, the box of each placed
  sprite (magenta, labelled with its key), each clip region (cyan), and each
  `debugBox(label, x, y, w, h)` the sketch draws (yellow; e.g. its hit areas).
  Without the flag, `debugBox` draws nothing.
- `run --timing` adds a line to the transcript with the average, 95th
  percentile and worst draw time per frame (and TEA's update time), with
  frame 0, which builds caches and sprites, reported apart.
- `cli diff before.png after.png` shows what changed between two frames.
- `v.cursor("pointer")` sets the pointer over a browser figure (until changed;
  set `"default"` when the pointer leaves a target); headless it does nothing.

## Determinism

A render is byte-identical every time in the same runtime. The headless
renderer (Skia) and a browser can differ: antialiasing, and the strength of
marks built from many faint dabs. Measured on the brush playground, a bristle
stroke comes out about 5% lighter in Chrome than headless; the look is the
same.
