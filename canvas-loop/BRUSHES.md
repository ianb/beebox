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
  a loop.
- `path(commands)` takes `["move", x, y]`, `["line", x, y]`,
  `["quad", cx, cy, x, y]`, `["bezier", c1x, c1y, c2x, c2y, x, y]` and
  `["close"]`. Each `move` starts a separate piece. Each piece tapers on its own.

A shape with `noStroke()` gets no mark. A fill is always flat colour. For
textured shading, draw marks inside a `clip` (see below).

Points are ordinary data. Name the ones you reuse:

```ts
const P = { chin: [200, 260], earL: [120, 90], earR: [280, 90] } as const;
```

## Brushes

`brush(name, overrides?)` sets the brush. The presets:

| Name | Kind | Looks like |
| --- | --- | --- |
| `ink` | ink | smooth ink line; pressure thins it |
| `pencil` | stamp | graphite: grainy, light; build tone with several strokes |
| `bristle` | bristle | a loaded paint brush; separate bristle lines that dry out at the end |

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
  Without a seed, a mark's randomness comes from its own points, brush and
  gesture. Adding or removing **another** mark never changes this one. Moving
  one of this mark's points changes all of its randomness, unless you give it
  a `seed`.

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

Shading inside a shape: clip to the shape, then draw marks.

```ts
s.clip(bodyPath, () => {
  s.brush("pencil");
  s.strokeWeight(2.5);
  for (let i = 0; i < 20; i += 1) s.line(100 + i * 8, 300, 140 + i * 8, 200);
});
```

## Transforms

Brushes follow `translate`, `rotate` and `scale` as strokes do: `scale(2)`
doubles a mark's position and width. Under a non-uniform scale the brush stays
round.

## Determinism

A render is byte-identical every time in the same runtime. The headless
renderer (Skia) and a browser can differ slightly in antialiasing.
