# Brushes, paper, effects, light

canvas-loop can draw with real-looking brushes, paint effects and light. A
brush is part of a shape's style, and it changes how **strokes** look. Fills
stay flat.

```ts
import type { RootDrawing, Style, View } from "@ianbicking/canvas-loop";

const INK: Style = {
  stroke: "#1d2a44",
  weight: 4,                                   // stroke width in pixels, at full pressure
  brush: "ink",                                // strokes are ink marks
  gesture: { pressure: "taper", wobble: 1 },
};

export function draw(v: View): RootDrawing {
  return [
    v.background("#f6f2e7"),
    v.curve([[40, 80], [120, 40], [200, 90]], false, INK),        // a smooth curve through the points
    v.circle(260, 70, 20, INK),                                   // any stroked shape takes the brush
    v.line(40, 120, 300, 120, { stroke: "#1d2a44", weight: 4 }),  // no brush: a plain stroke
  ];
}
```

[TEA.md](./TEA.md#styles) lists every style key and how `draw` returns its
drawing.

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
colour. For textured shading, draw marks inside a `clip` (see "Faint marks").

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
v.clip(v.curvePath(HEAD, true), v.curve(crescent, true, { fill: SHADE }));  // shadow crescent, lower right
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
| `smudge` | smear | drags the paint already under it along the stroke; adds no colour | 10–40 |
| `wet` | smear | wet paint: lays down the stroke colour mixed with the paint it crosses | 10–40 |

The `wash` brush is one stroke of tone; `effects: { wash }` (below) turns a
whole group into watercolour.

To stop a marker multiplying, set the blend: `brush: { preset: "marker", blend: "normal" }`,
or `blend: "normal"` in the style.

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
| `opacity` | all | opacity of the whole mark, 0..1. A mark does not darken where it crosses itself. A smear brush applies it to each dab instead. |
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
| `hueJitter` | stamp, bristle | each dab or bristle shifts its hue by up to ± this many degrees, 0..180 |
| `lightJitter` | stamp, bristle | each dab or bristle shifts its lightness by up to ± this much, 0..1 |
| `tip`, `spacing`, `flow`, `sizeByPressure`, `opacityByPressure` | smear | as for stamp brushes |
| `strength` | smear | how far the picked-up paint is carried, 0..1; higher drags it further |
| `color` | smear | how much of the stroke colour goes into the brush at each dab, 0..1; 0 is a pure smudge |

### Colour variation

Real paint is never one flat colour. `hueJitter` and `lightJitter` give each
dab (stamp brushes) or each bristle (bristle brushes) its own nearby shade,
fixed by the mark's seed. Small values read as paint: `lightJitter: 0.08`
on a bristle brush, `hueJitter: 10` on chalk. Large values read as confetti.
They need a solid stroke colour, not a gradient.

```ts
v.curve(STEM, false, { stroke: "#4f7a3a", weight: 24, brush: { preset: "bristle", hueJitter: 12, lightJitter: 0.1 } })
```

### Smudge and wet paint

`smudge` and `wet` move paint that is already drawn, so put them **after**
what they should mix with.

- `smudge` ignores its stroke colour (any colour will do). Drag it from a
  colour into its neighbour to soften an edge or blend two areas. Over empty
  or flat paper it changes nothing.
- `wet` lays down its stroke colour and mixes it with what it crosses: yellow
  over blue turns green. Over plain paper it mixes with the paper colour; raise
  `color` toward 1 for more of its own colour.
- A smudge keeps dragging what it has already smeared, so one long zigzag
  stroke along an edge blends it better than many short ones. Wet paint mixes
  only with the paint that was there before the stroke.
- Inside a `group`, they only move that group's paint.
- They cannot erase, use a blend mode or take `effects`; `wet` needs a solid
  stroke colour.

```ts
v.curve(ZIGZAG_ALONG_EDGE, false, { stroke: "#000", weight: 14, brush: "smudge" }), // blend two areas
v.curve(SKY_STREAK, false, { stroke: "#f1c40f", weight: 18, brush: "wet" }),       // a glaze that mixes in
```

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

Grainy brushes (pencil most of all) show the paper's tooth. The grain is fixed
to the coordinates where a mark is drawn, so a shape moved with `at` keeps its
texture. `v.paper({ scale, contrast, seed }, children)` sets the paper for
every brushed mark and paper effect in its children: `scale` is the size of
the tooth in pixels (default 3), `contrast` is 0..1 (default 0.7). Wrap the
whole drawing to change the paper everywhere; an inner `v.paper` wins inside
it. A picture uses its own `paper` option (default the default paper), not
the scope it is placed in; headless runs give a hint when the two differ.

`effects: { paper: amount }` on a group shows the paper's tooth in what the
group drew, only where it drew, so flat fills and gradients look printed on
paper. 0.3–0.6 is a typical range.

## Groups, blend, erase

```ts
v.group({ opacity: 0.6, blend: "multiply" }, [
  // drawn on its own layer, then composited once
])
```

- **Opacity** applies once, to the finished group. Opaque shapes inside the
  group do not darken where they overlap.
- **Blend** is how the finished group combines with what is under it:
  `"normal"`, `"multiply"`, `"screen"`, `"overlay"`, `"darken"`, `"lighten"`,
  `"soft-light"`, `"hard-light"`, `"color-dodge"`, `"color-burn"`, `"add"`
  (light sums toward white: sparks, fire), `"difference"`, `"exclusion"`,
  and `"hue"`, `"saturation"`, `"color"`, `"luminosity"` (take that property
  from the group, the rest from what is under it: `"color"` tints a grey
  drawing). An unknown name is an error.
- A style's `blend` does the same for one shape.
- A style with `erase: true` removes pixels: the fill, stroke or mark cuts a
  hole. Inside a group it removes only the group's own pixels. Elsewhere,
  including inside `at`, it removes the canvas's pixels.
- Groups nest.
- `clip([shapeA, shapeB, …], children)` clips to the union of several shapes,
  for example one light pass over a whole figure made of parts. A group's
  `clip` option cuts after its effects (a soft shadow stops at the clip); a
  `clip` scope inside the group cuts before them.

## Effects

A group's `effects` work on the finished group as it is composited. A style's
`effects` do the same for one shape.

```ts
v.group({ effects: { shadow: { x: 4, y: 6, blur: 6, color: "rgba(0,0,0,0.4)" } } }, drawCard(v)),
v.group({ effects: { blur: 3 } }, drawDistantHills(v)),
v.group({ effects: { saturation: 0.3, brightness: 1.1 } }, drawMemory(v)),
v.group({ effects: { wash: { edges: 0.6, blotch: 0.3 }, paper: 0.4 } }, drawRoom(v)),
v.group({ effects: { hatching: { amount: 0.8 } } }, drawStatue(v)),
```

| Effect | Value |
| --- | --- |
| `blur` | radius in pixels |
| `glow` | `{ blur, color, strength? }`: a halo in `color` around what the group drew; `strength` 1–6 (default 2) builds it brighter |
| `shadow` | `{ x?, y?, blur?, color }`: a drop shadow, offset and softened |
| `hue` | rotate hues, degrees |
| `saturation`, `brightness`, `contrast` | factors: 1 unchanged, 0 grey / black / flat |
| `grayscale`, `sepia`, `invert` | amounts 0..1 |
| `wash` | `{ granulate?, edges?, blotch?, bleed? }`: watercolour. `granulate` (default 0.5) settles pigment into the paper; `edges` (0.5) darkens where a colour meets paper or another colour; `blotch` (0.4) pools pigment unevenly, with blooms above about 0.2; `bleed` lets edges wander by that many pixels |
| `hatching` | `{ amount, angle?, spacing?, color? }`: pencil lines that show tone. The lightest third of the group's own tone range stays bare, half tones get single lines, shadows crossed lines. `angle` in radians (default π/4), `spacing` in pixels (default 6) |
| `paper` | paper tooth in what the group drew, 0..1 |

Colour adjustments apply first, then `blur`, `wash`, `hatching` and `paper`.
The glow and the shadow are drawn beneath the group, from what it drew
before these effects. For another order, nest groups: the inner group's
effects come first. The glow does not brighten the group itself (add
`blend: "screen"` or `"add"` for that). Hatching reads tone across its whole
group, so give it a group with light and dark parts.

Lengths (blur, glow, shadow offset, bleed, hatch spacing) are in the
coordinates where the group is: under `at({ scale: 0.5 })` a blur is half as
wide, and a shadow's offset turns with a rotation. A group's layer grows to
hold its blur, glow and shadow, and a picture keeps what spills past its box.

### Making something glow

Three tools, often used together:

- **A glow effect** (`effects: { glow }`) puts a coloured halo around a shape
  or group. It does not light anything else.
- **An emissive material** (`material: { emissive: 1 }`) keeps a shape's own
  colour inside a lit group, however dark the lighting.
- **A light** (`v.light`) lights the shapes around it in a lit group.

A glow is the shape's silhouette blurred, so its strength comes from the
shape's area: a blur many times wider than the shape spreads it too thin to
see. For a small flame, keep `blur` near the flame's size and raise
`strength`, or glow a larger soft shape around it:

```ts
v.circle(lx, ly, 14, { fill: "rgba(255,190,90,0.5)", effects: { glow: { blur: 16, color: "#ff9a2e", strength: 4 } } })
```

A lit lamp: the flame is an emissive shape with a glow, and a light sits at
the flame.

```ts
const FLAME: Style = { fill: "#ffd27a", material: { emissive: 1 }, effects: { glow: { blur: 14, color: "#ffb347", strength: 3 } } };

v.group({ lighting: { ambient: "#2e3448" } }, [
  drawRoom(v),
  v.circle(240, 110, 8, FLAME),
  v.light({ kind: "point", at: [240, 110], height: 120, energy: 1.5, color: "#ffd9a0" }),
])
```

A group's own glow is drawn beneath the group, so its wash does not paint over
it. A shape's glow inside a washed group is part of the group's drawing, so
the wash paints over it. To keep a flame's glow clean, draw the flame after
the washed group, outside it.

## Lighting

A group with `lighting` is lit by the lights inside it:

```ts
v.group({ lighting: { ambient: "#2e3448", shadows: "soft" } }, [
  v.rect(0, 0, 480, 300, { fill: "#d8cbb3" }),                                  // a floor
  v.rect(200, 180, 60, 40, { fill: "#8b5a2b", material: { castsShadow: 40, bevel: 4 } }),
  v.light({ kind: "point", at: [240, 110], height: 120, energy: 1.5 }),
])
```

- **`lighting`:** `ambient` (the light everywhere, default `"#4d4d4d"`),
  `shadows` (`"none"`, `"hard"`, `"soft"`, default soft), `exposure` (stops,
  default 0), `toneCurve` (0..1, default 0: lit colour clips at white; toward
  1, deeper shadows and highlights that roll off).
- **`v.light({ kind, at?, height?, color?, energy?, reach?, direction?, cone? })`:**
  `kind` is `"point"`, `"spot"` or `"directional"`. `at` is in the
  coordinates around the call. `height` above the page (default 80): higher
  gives a wider, softer pool and shorter shadows. `energy` default 1,
  `reach` (where it fades out) default 400. `direction` (spot, directional)
  is radians from +x, clockwise, as `arc` (default π/2, down); `cone` is a
  spot's half-angle (default π/6). A directional light's `height` is its
  slope: 100 is 45°.
- **Starting values:** ambient `"#2e3448"` and a point light at `height: 120`,
  `energy: 1.5` show a lamp's pool on the first render. `run --scene` prints
  each light's peak: `peak +0.83 below (240,110), over ambient 0.20 (a white
  floor there: 0.49 → 1.00)`. A peak several times the ambient reads as a
  pool; one near the ambient barely shows.
- **`material`** in a style: `bevel` (rounded edges, pixels), `relief` (0..1,
  how far the surface rises), `shine` (highlights, 0..1), `emissive` (0..1),
  `castsShadow` (`true` stands 32 pixels above the page, or a height up to
  1024: taller casts longer), `receivesShadow: false` (no shadow falls on it:
  a sky behind a figure in a side view). A shape with no material is flat
  matte. Outside a lit group, materials are ignored.
- A light lights only the nearest lit group around it, including inside
  pictures placed there: a picture holding a lamp brings its light. A light
  outside any lit group, or in mask art, does nothing and warns. A lit group
  with no light warns.
- `v.place(picture, x, y, { material })` gives that material to the
  picture's shapes that have none, so an unlit drawing can cast shadows.
- A lit group inside a lit group is lit only by its own lights; to the outer
  group its result counts as emissive.
- Lighting comes before the group's effects, so a wash paints over the lit
  result. To light several parts that each have their own wash with one
  light, put them in one lit group, give each part its wash as an inner group,
  and put the lights in the outer group.

## Gradients

`ellipseGradient(x, y, rx, ry, stops)` is a radial gradient that fills an
ellipse with radii `rx` and `ry` (like `ellipse`), for flat pools of light and
oval glows. `radialGradient` is always circular.

## Colour tips

- A translucent colour mixes with what is under it: pink at 50% over green
  turns brownish grey. For a clean tint, paint an opaque core and soften its
  edge with `wash` or `airbrush`.
- `blend: "screen"` lightens toward white; it does not add colour. For
  coloured light, use `"normal"` at a lower opacity, or `"overlay"`.

## Faint marks

A mark whose strongest pixel lands below about 8% opacity (after its brush
and any groups around it) is too faint to see. Headless runs warn with the
mark's line: `faint mark (curve): it reaches only 5% opacity and will barely
show`. For a mark that is meant to be that faint, give its style
`gesture: { faint: true }`.

Shading inside a shape: fill the shape, clip to it and draw marks, then draw
its outline last. The clip includes the inside half of the outline, so marks
drawn after the outline cover part of it.

```ts
const HATCH: Style = { stroke: "#3f7f3a", weight: 2.5, brush: "pencil" };
const OUTLINE: Style = { stroke: "#1f2a1f", weight: 3, brush: "ink" };
const ROWS = Array.from({ length: 20 }, (_, i) => i);

return [
  v.curve(BODY, true, { fill: "#7ccf6a" }),                                   // 1. flat base colour
  v.clip(v.curvePath(BODY, true),                                             // 2. marks, kept inside the shape
    ROWS.map((i) => v.line(100 + i * 8, 300, 140 + i * 8, 200, HATCH))),
  v.curve(BODY, true, OUTLINE),                                               // 3. the outline, last
];
```

## Transforms

Brushes follow `v.at({ translate, rotate, scale }, children)` as strokes do:
`scale: 2` doubles a mark's position and width. Under a non-uniform scale the
brush stays round.

## Animation and pictures

Brushed marks, effects and lighting cost the most per frame. Keep what does
not change in a [picture](./TEA.md#pictures) and draw only the moving parts
each frame:

- A still background goes in one picture with no `deps`. A static part that
  changes with a param puts the param in `deps`:
  `v.picture({ key: "sky", width: 600, height: 300, deps: [p.dusk] }, () => drawSky(v, p.dusk))`.
- A thing that moves but keeps its look (a character, a boat, a cloud) is a
  picture placed at a new position each frame. Draw each pose as its own
  version (`deps: [pose]`) and switch between them.
- The renderer keeps a placed picture's pixels while its version, scale and
  rotation stay the same; a move reuses them, since placements snap to whole
  device pixels. So bob a picture by moving it, and flip it with a fixed
  `scale: [-1, 1]`. A picture that turns or scales by a new amount in every
  frame (rocking, breathing) is drawn again each time, and headless runs give
  a hint: draw that part as a group, or as a few poses.

```ts
const boat = v.picture({ key: "boat", width: 120, height: 60 }, () => paintBoat(v));
return v.place(boat, x - 60, y - 40 + Math.round(Math.sin(model.frame / 30) * 3));  // bob
```

- A mark's randomness comes from its points, so a mark whose points move
  re-rolls its wobble every frame: the line "boils", as in hand-drawn
  animation. To keep it still, give its style `gesture: { seed }`.

### Recipes

- **Light under a night shade.** Darken the page with a multiply rect, then
  draw lit windows and lamps after it with `blend: "screen"` in their style,
  or as a picture placed with `{ blend: "screen" }`. For real light and
  shadows, use a [lit group](#lighting).
- **Someone behind a window frame.** Draw the person, then the window's frame
  and glazing bars on top; or clip the person to the window opening
  (`v.clip(openingRect, drawPerson(v))`).
- **Randomness on the draw side.** `draw` gets no `random`. `v.noise(x, y?,
  z?)` gives smooth seeded noise for flicker. Scatter that never changes
  (stars, grass) can be computed once into module `const` arrays from a small
  seeded generator; a mark's own jitter comes from its `seed`.

## Seeing what you made

- `run --zoom x,y,w,h[@scale]` (repeatable) writes an enlarged crop of that
  region beside each captured frame (`frame-0000-zoom1.png`, nearest-pixel,
  scale 3 by default). At 1× a frame hides grain, bristle streaks and edges.
  `cli zoom out/frame-0000.png x,y,w,h` crops a frame you already have.
- `run --ratio 2` renders at twice the pixel density, as a phone screen does.
- `run --scene` writes each captured frame's drawing into the transcript as an
  indented outline, with picture versions and each light's peak;
  `--scene first` writes only the first frame's. Use it to check what `draw`
  returned: what is inside which group, and in what order.
- `run --outline` draws over every captured frame the box of each placed
  picture (magenta, labelled with its key), each clip region (cyan), and each
  `v.debugBox(label, x, y, w, h)` the drawing returns (yellow; e.g. its hit
  areas). Without the flag, `debugBox` draws nothing.
- `run --timing` adds per-frame lines (render passes, brushed strokes, CPU and
  GPU time) and, at the end, the average, 95th percentile and worst `draw`
  and `update` times, with frame 0 reported apart.
- `cli diff before.png after.png` shows what changed between two frames.

## Determinism

The renderer is WebGPU: in a browser, and headless through Dawn. A render is
byte-identical every time within one runtime on one machine. A browser and a
headless run, or two machines, can differ slightly in antialiasing and in
the strength of marks built from many faint dabs; the look is the same.
