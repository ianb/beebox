# canvas-loop

A deterministic, browser-less, frame-stepped **Canvas2D sandbox for agent programming**.

You write a p5-style sketch, run one CLI command, and get back a single
interleaved **transcript**: frame-tagged log lines with rendered PNG frames
inline. Synthetic input events are injected from a JSON script and dispatched
through the same handler path a real UI would use — so one events file is
simultaneously a test, a reproduction, and a demo.

It renders with [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas)
(Skia, no browser). Two identical runs produce byte-identical output: time is a
fixed timestep, randomness is seeded, and `Math.random` / `Date.now` /
`performance.now` / argless `new Date()` are disabled inside a sketch.

## Run

```sh
pnpm --dir sandbox/canvas-loop run cli run <sketch.ts> \
  [--frames 120] [--events events.json] [--out out/] \
  [--seed 42] [--fps 60] [--every 30]
```

Writes `<out>/transcript.md` plus `<out>/frame-NNNN.png`. The out directory is
overwritten each run. On success it prints only the transcript path and frame
count; each sketch error prints one line and exits nonzero (the transcript is
still written, with the error frame-tagged).

Read `transcript.md` — the inline `![frame N](frame-NNNN.png)` images render
directly in tools that display markdown images (including Claude Code's `Read`).

## Writing a sketch

A sketch is a TypeScript module exporting `setup` and `draw`, plus optional input
handlers. Instance mode — no globals; everything hangs off the `Sketch` object `s`:

```ts
import type { Sketch } from "canvas-loop"; // examples in this repo use "../src/sketch.js"

export function setup(s: Sketch): void {
  s.createCanvas(400, 300); // setup only
}

export function draw(s: Sketch): void {
  s.background("#0f172a");
  s.fill("#38bdf8");
  s.noStroke();
  s.circle(s.width / 2, s.height / 2, 48);
  if (s.frameCount % 30 === 0) s.log("tick", s.frameCount, s.millis());
}

export function mousePressed(s: Sketch): void {
  s.log("clicked at", s.mouseX, s.mouseY);
}
```

Handlers (all optional, all `(s: Sketch, e: SketchInputEvent)`):
`mousePressed`, `mouseReleased`, `mouseMoved`, `mouseDragged`, `keyPressed`,
`keyReleased`. A `mousemove` while the mouse is pressed fires `mouseDragged`,
otherwise `mouseMoved`. `e` carries `{ type, x, y, key }`.

### The `Sketch` API

| Group | Members |
| --- | --- |
| Canvas & time | `createCanvas(w, h)`, `width`, `height`, `frameCount`, `millis()` (= `frameCount / fps * 1000`) |
| Drawing | `background`, `fill`, `noFill`, `stroke`, `noStroke`, `strokeWeight`, `rect`, `circle`, `ellipse`, `line`, `triangle`, `text`, `textSize`, `textAlign` |
| Transform | `push`, `pop`, `translate`, `rotate`, `scale` |
| Randomness | `random()`, `random(max)`, `random(min, max)`, `randomChoice(arr)` — seeded (`--seed`) |
| Input state | `mouseX`, `mouseY`, `mouseIsPressed`, `keysDown` (`Set<string>`) |
| Output | `log(...args)` (frame-tagged into the transcript), `snapshot(label?)` (force-capture the frame) |

Colors are **CSS color strings only** (`"#38bdf8"`, `"tomato"`, `"rgb(…)"`) —
no p5 numeric color overloads. Habitual `console.log/warn/error` also work; they
route into the frame-tagged transcript.

**Escape hatch:** `s.ctx` is the raw `@napi-rs/canvas` `SKRSContext2D`. Anything
the subset above doesn't cover (gradients, `arc`, `clip`, `drawImage`, …) is
available directly on it.

## Events file

A JSON array of events, each stamped with the frame it fires on. **Guarantee:
all events for frame N dispatch, in file order, before frame N's `draw`** — so
the world state a click sees is exactly the state after frame N−1's draw, and
hit-testing a moving target is a pure calculation, never trial and error:

```json
[
  { "frame": 6, "type": "mousedown", "x": 200, "y": 150 },
  { "frame": 8, "type": "mousemove", "x": 212, "y": 144 },
  { "frame": 17, "type": "mouseup", "x": 260, "y": 120 },
  { "frame": 90, "type": "keydown", "key": "r" }
]
```

Types: `mousedown`, `mouseup`, `mousemove`, `keydown`, `keyup`. `x`/`y` update
the mouse position; `key` names the key for `keysDown` and the handler event.

## Capture policy

To keep image counts sane, a frame's PNG is captured when it is frame 0, the
final frame, an `--every N` multiple, or a frame that logged, ran an event, or
called `snapshot()`. Consecutive identical frames are hashed and deduped: the
transcript references the earlier PNG and notes `(unchanged)` instead of writing
a duplicate.

## Worked example

`examples/bounce.ts` + `examples/bounce-events.json` — a bouncing ball you can
grab (mousedown within its radius), drag, and throw (release with the drag
velocity); `r` resets it. It exercises `setup`/`draw`, all the mouse handlers,
`keyPressed`, seeded `random()` for the launch velocity, frame-tagged `log()`,
and `snapshot("released")`:

```sh
pnpm --dir sandbox/canvas-loop run cli run examples/bounce.ts \
  --events examples/bounce-events.json --out out
```

Produces a ~13-image transcript for 120 frames:

```md
**[frame 6]** log: grabbed ball at 200 150

### frame 16
![frame 16](frame-0016.png)

**[frame 17]** log: released with velocity 12 -6

### frame 17 — released
![frame 17 — released](frame-0017.png)
```

## Development

```sh
pnpm --dir sandbox/canvas-loop test        # node --test
pnpm --dir sandbox/canvas-loop typecheck
pnpm --dir sandbox/canvas-loop lint         # @ianbicking/personal-vibe-check preset
```
