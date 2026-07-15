# canvas-loop

> **EXPERIMENTAL.** `@ianbicking/canvas-loop@0.1.0`. This is a workspace library
> whose API is expected to move as agent exercises teach us more — imports,
> exports, and event shapes may change between versions. Every change is recorded
> in [CHANGELOG.md](./CHANGELOG.md).

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
pnpm --dir canvas-loop run cli run <sketch.ts> \
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

Two tiers. This section covers the **mutable tier** (p5-style `setup`/`draw`).
For the **TEA tier** — a pure `init`/`update`/`draw` fold with declared params,
enforced immutability, and an exhaustive `Msg` switch — see [TEA.md](./TEA.md).

A sketch is a TypeScript module exporting `setup` and `draw`, plus optional input
handlers. Instance mode — no globals; everything hangs off the `Sketch` object `s`:

```ts
import type { Sketch, SketchInputEvent } from "@ianbicking/canvas-loop";

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

Each scripted input gets an **engagement verdict** on its transcript line
(`mousedown (5,5) → grab`): whether a handler fired is a free signal — a fired
handler reads `handled`, no matching handler reads `(unhandled)`; call
`s.handled("name")` inside a handler to name the engagement instead
(`… → grab`). (The TEA tier adds a `Δmodel` verdict from reducer state changes;
see [TEA.md](./TEA.md#engagement-verdicts).)

### The `Sketch` API

| Group | Members |
| --- | --- |
| Canvas & time | `createCanvas(w, h)`, `width`, `height`, `frameCount`, `millis()` (= `frameCount / fps * 1000`) |
| Drawing | `background`, `fill`, `noFill`, `stroke`, `noStroke`, `strokeWeight`, `rect`, `circle`, `ellipse`, `line`, `triangle`, `arc`, `text`, `textSize`, `textAlign` |
| Organic shapes | `polygon(points)`, `path(commands)` (data-encoded `["move"/"line"/"quad"/"bezier"/"close", …]`), `clip(shape, () => …)` (polygon/path region for the callback) |
| Gradients | `linearGradient(x1,y1,x2,y2, stops)`, `radialGradient(x,y,radius, stops)` → an opaque handle `fill`/`stroke`/`background` accept anywhere a color string is |
| Transform | `push`, `pop`, `translate`, `rotate`, `scale` |
| Randomness | `random()`, `random(max)`, `random(min, max)`, `randomChoice(arr)` — seeded (`--seed`) |
| Input state | `mouseX`, `mouseY`, `mouseIsPressed`, `keysDown` (`Set<string>`) |
| Output | `log(...args)` (frame-tagged into the transcript), `snapshot(label?)` (force-capture the frame), `handled(name)` (name this input's engagement verdict) |

Colors are **CSS color strings only** (`"#38bdf8"`, `"tomato"`, `"rgb(…)"`) —
no p5 numeric color overloads. Habitual `console.log/warn/error` also work; they
route into the frame-tagged transcript.

**Escape hatch:** `s.ctx` is the raw `@napi-rs/canvas` `SKRSContext2D` — still
available for anything the subset doesn't cover (`drawImage`, shadows, `lineJoin`,
…). But the `polygon`/`path`/`arc`/gradient/`clip` primitives above should now
cover organic shapes; prefer them so a sketch stays serializable-in-principle
(the primitives are declarative data, `ctx` calls are not).

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
  { "frame": 40, "type": "snapshot", "label": "mid-arc" },
  { "frame": 90, "type": "keydown", "key": "r" }
]
```

Input types: `mousedown`, `mouseup`, `mousemove`, `keydown`, `keyup`. `x`/`y`
update the mouse position; `key` names the key for `keysDown` and the handler
event. A `snapshot` entry (`{ "frame", "type": "snapshot", "label"? }`) is not
input — it forces a capture of that frame without dispatching to any handler or
touching state, and its optional `label` flows to the transcript frame heading
(`### frame 40 — mid-arc`). Use it to pin a frame in the transcript that the
capture policy would otherwise skip, the scriptable twin of `s.snapshot(label?)`.

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
pnpm --dir canvas-loop run cli run examples/bounce.ts \
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

## React figure (`./react`)

`@ianbicking/canvas-loop/react` exports `<SketchFigure>` — the browser TEA runner
(runtime + generated controls) as a React component. It is mounting + prop
plumbing + lifecycle only; the runtime, view, and controls are the single
browser implementation, imported, not reimplemented. `react` is an **optional
peer dependency** — only consumers of `./react` need it; importing `.` or
`./eslint` never resolves React.

```tsx
import { SketchFigure } from "@ianbicking/canvas-loop/react";
import * as orbit from "./orbit-tea.js";

<SketchFigure module={orbit} />;
```

**SSR-safe.** No `window`/`document`/canvas is touched at module scope or during
render. `useSyncExternalStore` reports server-vs-client, so the server (and the
first hydration pass) render a plain placeholder `div`; the runtime is created in
an effect, only on the client. `react-dom/server`'s `renderToString(<SketchFigure
module={orbit}/>)` never throws and never emits a `<canvas>` (see
`test/react-ssr.test.tsx`).

### Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `module` | TEA sketch module | — | The `init`/`update`/`draw` (+ `params`/`canvas`) to run. Identity is keyed on the sub-references, not the wrapper — see below. |
| `seed` | `number` | `42` | Changing it re-runs the sketch from frame 0. |
| `autoplay` | `boolean` | `true` | `false` renders a paused frame 0 (a Play button starts it). |
| `showControls` | `boolean` | `true` | The generated param panel + a play/pause + restart toolbar. |
| `showRecorder` | `boolean` | `false` | The live recorded-events (`{frame, type, …}`) viewer. |
| `height` | `number` | — | Display height in CSS px; the canvas scales to fit (aspect preserved). |
| `scale` | `number` | — | Display-scale multiplier over the intrinsic size (wins over `height`). |
| `initialParams` | partial record | — | **Uncontrolled**: overrides declaration defaults for the initial run. |
| `params` | record | — | **Controlled**: the host owns the values (see below). |
| `onParamsChange` | `(values) => void` | — | Reports the applied param values after a change. |
| `onEvent` | `(entry) => void` | — | Streams each recorded input entry as it dispatches. |

Controls are plain HTML inputs generated from the sketch's `params` declaration
(the same `controlModels` mapping the browser playground uses). A widget edit
calls back into the runtime's `setParam`/`trigger` — the same path a scripted
event takes — so widgets dispatch, they never poke model state.

### Module identity

The runtime is (re)created when the sketch identity changes — but identity is
keyed on the module's **sub-references** (`init`, `update`, `draw`, `params`),
NOT on the wrapper object. So an inline literal built from module-scope
functions is stable across parent re-renders:

```tsx
// Safe: composed from stable module-scope references — the sketch keeps
// running across re-renders (no frame-0 reset, no reseed).
<SketchFigure module={{ init, update, draw, params }} />;
```

Keep `params` a stable reference too (define it at module scope, or memoize it)
— it is keyed the same way. Passing a genuinely new `init`/`update`/`draw`/`params`
reference restarts the sketch, as intended. If a frame (`update`/`draw`) throws,
the loop stops and a small inline error box replaces the running readout rather
than throwing uncaught every animation frame.

### Uncontrolled vs controlled

- **Uncontrolled** (`initialParams`, no `params`): param state lives inside the
  figure. `onParamsChange` reports each applied change so the host can observe
  (e.g. persist) without owning the values.
- **Controlled** (`params` + `onParamsChange`): the host owns the values. A
  widget edit calls `onParamsChange`; the host updates `params`; the figure
  diffs the new `params` and dispatches the changes through the normal `param`
  message path (`runtime.setParam`) — never by poking model state. Host-injected
  changes (not just widget edits) flow the same way.

`onEvent` generalizes watching past params: every input — pointer, key, param,
trigger — is already a logged `{frame, type, …}` msg, so `onEvent` is the same
stream the recorder captures. Saving a full replayable session is likewise a
host-side choice.

### Persistence is host composition

Persistence isn't a component feature — it falls out of controlled mode. Own the
values in the host and write them wherever you like (a callback-box card,
`localStorage`, anything):

```tsx
const KEY = "my-sketch-params";

function PersistedFigure() {
  const [params, setParams] = useState(() => {
    const saved = localStorage.getItem(KEY);
    return saved ? JSON.parse(saved) : { tide: 0, timeOfDay: "day" };
  });
  const onParamsChange = useCallback((values) => {
    setParams(values);
    localStorage.setItem(KEY, JSON.stringify(values)); // restore on reload
  }, []);
  return <SketchFigure module={fjord} params={params} onParamsChange={onParamsChange} />;
}
```

### Demo

`dev-demo/main.tsx` embeds two figures — orbit (uncontrolled, controls +
recorder + an `onEvent` readout) and fjord (controlled, wired to `localStorage`
with a "clear saved state" link). Build the self-contained page with:

```sh
pnpm --dir canvas-loop run build:dev-demo   # writes dev/canvas-loop.html
```

Served from disk at `/<worktree>/dev/canvas-loop.html`. The component ships its
own minimal stylesheet (rendered inline), so a bare `<SketchFigure>` is styled
with zero setup.

## Development

```sh
pnpm --dir canvas-loop test        # node --test
pnpm --dir canvas-loop typecheck
pnpm --dir canvas-loop lint         # @ianbicking/personal-vibe-check preset
```
