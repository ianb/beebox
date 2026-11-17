# canvas-loop pieces

Larger sketches that agents made with canvas-loop, kept to look at and play
with. They are not examples: the examples in `canvas-loop/src/examples/` each
teach one thing, and the docs link only those. Nothing here ships, and no
commit check lints or type-checks these files; building their page does.

| Piece | What it is | Events file |
| --- | --- | --- |
| `thimble-quay/` | A canal town through a day: brushed buildings, weather, lamps at night, sound, and almost everything clickable | `events.json` |
| `mochi-must-not-fall/` | A lane-defense game in ink on rice paper | `events.json` (a whole game) |
| `pointer-forest/` | A wood that clears where the pointer goes and grows back when it leaves; `growth-strip-tea.ts` shows each species from seedling to mature | `ev-hover.json` |
| `pointer-forest/v3/` | The earlier version, with recursive branching trees | `v3/ev-story.json` |
| `fractal-paint/` | A paint program whose strokes grow by a chosen rule (keys 1–4, `p` palette, `c` clear) | `ev-demo.json`, `ev-coral.json` |

`task.md`, `meta.yaml` and `FRICTION.md` are the briefs and the gaps the
making agents reported; some gaps have since been fixed in canvas-loop.

Open them live (the page type-checks the sketches first):

```bash
D=$PWD/dev/canvas-loop-pieces
pnpm --dir canvas-loop run cli page $D/thimble-quay/sketch-tea.ts $D/mochi-must-not-fall/sketch-tea.ts \
  $D/pointer-forest/sketch-tea.ts $D/pointer-forest/v3/sketch-tea.ts $D/fractal-paint/sketch-tea.ts --name pieces
```

It prints `http://localhost:3210/<worktree>/dev/canvas-loop-pages/pieces.html`.
Render one headless with its events file:

```bash
pnpm --dir canvas-loop run cli run $D/pointer-forest/sketch-tea.ts --events $D/pointer-forest/ev-hover.json --frames 521 --out out
```
