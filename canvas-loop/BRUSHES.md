# Brushes, gestures, paper, groups

canvas-loop can draw with real-looking brushes. The API follows p5: you set
state, then draw shapes. A brush changes how **strokes** look. Fills stay flat.

```ts
s.background("#f6f2e7");
s.noFill();
s.stroke("#1d2a44");          // stroke colour, as in p5
s.strokeWeight(4);            // stroke width in pixels, at full pressure
s.brush("ink");               // strokes from now on are ink marks
s.gesture({ pressure: "taper", wobble: 1 });
s.curve([[40, 80], [120, 40], [200, 90]]);   // a smooth curve through the points
s.circle(260, 70, 40);        // any stroked shape takes the brush
s.noBrush();                  // back to plain Canvas2D strokes
```

Every method here exists on the mutable `Sketch` and on the TEA `View`.

## Shapes

All stroked shapes take the current brush: `line`, `curve`, `path`, `polygon`,
`rect`, `circle`, `ellipse`, `arc`, `triangle`. Each shape is one **mark**.

- `curve(points, closed?)` draws a smooth curve through every point (the
  Catmull-Rom curve p5's `curveVertex` draws). Pass `true` to close it into
  a loop. A closed curve through 4 points is a rounded blob; for a sharp
  corner, use `path` or put two points close together.
- `curvePath(points, closed?)` returns the same curve as path commands, for
  `clip(...)` or `path(...)`.
- `path(commands)` takes `["move", x, y]`, `["line", x, y]`,
  `["quad", cx, cy, x, y]`, `["bezier", c1x, c1y, c2x, c2y, x, y]` and
  `["close"]`. Each `move` starts a separate piece. Each piece tapers on its own.

A shape with `noStroke()` gets no mark. A fill is always flat colour. For
textured shading, draw marks inside a `clip` (see below).

### Shape helpers

These return data, so their results work with `fill`, brushes and `clip`:

- `tube(points, { width, profile? })` returns the closed outline of a tube
  (an arm, a leg, a stem, a tail) around a smooth centreline through `points`,
  with round ends. `profile` is an envelope (as for pressure) that scales the
  width along the tube: `[[0, 1], [1, 0.6]]` narrows it toward the end.
  Draw it with `s.path(outline)`, clip with `s.clip(outline, …)`.
- `offset(points, distance)` grows (positive) or shrinks (negative) a closed
  outline given as points. Use it for rim light and form shadows: inside the
  shape's clip, fill the shape offset and shifted away from the light.

```ts
s.clip(s.curvePath(HEAD, true), () => {
  s.fill(SHADE);
  s.curve(s.offset(HEAD, 10).map(([x, y]) => [x + 12, y + 10]), true);  // shadow crescent, lower right
});
```

Points are ordinary data. Name the ones you reuse:

```ts
const P = { chin: [200, 260], earL: [120, 90], earR: [280, 90] } as const;
```

## Brushes

`brush(name, overrides?)` sets the brush. The presets:

| Name | Kind | Looks like | Typical `strokeWeight` |
| --- | --- | --- | --- |
| `ink` | ink | smooth ink line; pressure thins it | 2–8 |
| `marker` | ink | broad, flat, translucent; multiplies over what is under it | 8–24 |
| `pencil` | stamp | graphite: grainy, light; build tone with several strokes | 2–5 |
| `chalk` | stamp | coarse, broken by the paper grain | 8–20 |
| `airbrush` | stamp | soft, even spray with no texture: glows and gradients | 20–80 |
| `wash` | stamp | broad, soft-edged, translucent tone with a little paper texture: shadows | 20–80 |
| `bristle` | bristle | a loaded paint brush; separate bristle lines that dry out on long strokes | 12–40 |

Texture needs size and contrast. A brush in a colour close to the colour under
it, or a bristle or chalk mark shorter than a few widths, reads as flat tone
or as noise. Use `--zoom` (below) to see what a mark really looks like.

Overrides change one field: `s.brush("ink", { thinning: 0.3 })`. A field
that does not apply to the preset's kind is an error, which names the valid
fields.

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

`gesture({ pressure, wobble, seed })` sets how the hand moves for the marks
that follow.

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
- `seed` fixes a mark's random character (wobble, scatter, bristle drying).
  Without a seed, a mark's randomness comes from its own points only. Adding
  or removing **another** mark never changes this one, and changing its brush,
  pressure, width or colour keeps its wobble. Moving one of its points changes
  all of its randomness, unless you give it a `seed`.

`--seed` on the command line does not change brush marks.

## Paper

Grainy brushes (pencil most of all) show the paper's tooth. The paper is fixed
to the canvas, so marks line up with each other's grain. Change it with
`paper({ scale, contrast, seed })`: `scale` is the size of the tooth in
pixels (default 3), `contrast` is 0..1 (default 0.7).

## Groups, blend, erase

```ts
s.group({ opacity: 0.6, blend: "multiply" }, () => {
  // drawn on its own layer, then composited once
});
```

- **Opacity** applies once, to the finished group. Opaque shapes inside the
  group do not darken where they overlap.
- **Blend** is how the finished group combines with what is under it:
  `"normal"`, `"multiply"`, `"screen"`, `"overlay"`, `"darken"`, `"lighten"`,
  `"soft-light"`, `"hard-light"`, `"color-dodge"`, `"color-burn"`.
- `erase()` makes fills, strokes and marks remove pixels until `noErase()`.
  Inside a group it removes only the group's own pixels.
- `blendMode(mode)` sets the blend for the shapes that follow.
- Groups nest. `push()`/`pop()` inside a group must pair inside it.
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
- `push()` / `pop()` blocks have no visible scope in the file. Put each
  `push`, transform and `pop` inside one small function, so code added later
  does not land inside a rotate by accident.

## Faint marks

A mark whose strongest pixel lands below about 8% opacity (after its brush
and any open groups) is too faint to see. The transcript gets a warning line
with the mark's position, so you do not spend a cycle finding out.

Shading inside a shape: fill the shape, clip to it and draw marks, then draw
its outline last. The clip includes the inside half of the outline, so marks
drawn after the outline cover part of it.

```ts
s.noStroke();
s.fill("#7ccf6a");
s.curve(BODY, true);                       // 1. flat base colour
s.clip(s.curvePath(BODY, true), () => {    // 2. marks, kept inside the shape
  s.noFill();
  s.stroke("#3f7f3a");
  s.brush("pencil");
  s.strokeWeight(2.5);
  for (let i = 0; i < 20; i += 1) s.line(100 + i * 8, 300, 140 + i * 8, 200);
});
s.noFill();                                // 3. the outline, last
s.stroke("#1f2a1f");
s.strokeWeight(3);
s.brush("ink");
s.curve(BODY, true);
```

## Transforms

Brushes follow `translate`, `rotate` and `scale` as strokes do: `scale(2)`
doubles a mark's position and width. Under a non-uniform scale the brush stays
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

- `cache(key, body)` draws `body` once into a stored layer and pastes it on
  later calls with the same `key`. Put everything that does not move in it, and
  draw only the moving parts each frame. The key must name what the pixels
  depend on: when a param changes the static scene, put its value in the key
  (`` s.cache(`sky-${p.dusk}`, …) ``). The cache keeps the transform from the first
  call, and the 24 most recent keys.
- A mark's randomness comes from its points, so a mark whose points move
  re-rolls its wobble every frame: the line "boils", as in hand-drawn
  animation. To keep it still, give it `gesture({ seed })`.
- For interaction in a browser figure, write a TEA sketch (`*-tea.ts`, see
  [TEA.md](./TEA.md)): pointer input and params arrive as `Msg`s.

## Determinism

A render is byte-identical every time in the same runtime. The headless
renderer (Skia) and a browser can differ: antialiasing, and the strength of
marks built from many faint dabs. Measured on the brush playground, a bristle
stroke comes out about 5% lighter in Chrome than headless; the look is the
same.
