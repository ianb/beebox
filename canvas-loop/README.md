# canvas-loop

> **EXPERIMENTAL.** `@ianbicking/canvas-loop@0.2.0`. This is a workspace library
> whose API is expected to move as agent exercises teach us more — imports,
> exports, and event shapes may change between versions. Every change is recorded
> in [CHANGELOG.md](./CHANGELOG.md).

A deterministic, frame-stepped **drawing sandbox for agent programming**.

You write a sketch, run one CLI command, and get back a single interleaved
**transcript**: frame-tagged log lines with rendered PNG frames inline.
Synthetic input events come from a JSON script and reach the sketch as
messages, the same path a real UI uses. So one events file is a test, a
reproduction, and a demo.

A sketch has one form: The Elm Architecture (TEA). `init` builds a model,
`update` folds each message into a new model, and `draw` returns the drawing
of the model, built from calls that each return a node and take their style as
an argument. [TEA.md](./TEA.md) is the sketch reference: the contract, the
drawing API, pictures, params and events. Brushes, effects and lighting are in
[BRUSHES.md](./BRUSHES.md). [RENDERER.md](./RENDERER.md) is the renderer's
contract, for work on canvas-loop itself.

## What draws

One renderer, on WebGPU: the browser's in a figure, and Dawn (the `webgpu`
package) headless. A headless run needs a GPU adapter: a GPU with its driver,
or on Linux a software Vulkan driver such as Mesa's lavapipe. Without one,
`run` writes the transcript and throws `NoGpuAdapterError`, whose message lists
possible causes. A browser without WebGPU reports `NoWebGpuError`.

Runs are deterministic: time is a fixed timestep, randomness is seeded, and
`Math.random` / `Date.now` / `performance.now` / argless `new Date()` are
disabled inside a sketch. Two runs give byte-identical frames within one
runtime on one machine (`--timing` lines measure the clock and vary). Between a browser and a headless run, or two machines, pixels can
differ slightly; `beebox/docs/plans/canvas-loop-scene/parity-criteria.md`
sets how much.

## Run

```sh
pnpm --dir canvas-loop run cli run <sketch.ts> \
  [--frames 120] [--events events.json] [--out out/] [--seed 42] [--fps 60] \
  [--every 30] [--zoom x,y,w,h[@scale]]... [--ratio 2] [--scene [first]] \
  [--outline] [--timing] [--note text] [--no-typecheck]
```

`run` first type-checks the sketch, the files it imports and its exports
against the TEA contract; a type error stops the run with exit 1 and is listed
in the transcript. `--no-typecheck` skips the check, for runs that time the
renderer.

`--ratio` sets the pixel density (default 1). `--scene` writes each captured
frame's drawing as an outline into the transcript (`--scene first`: only the
first). `--outline` draws picture, clip and `debugBox` outlines over each
captured frame; `--timing` adds render counts and draw times to the
transcript (see [BRUSHES.md](./BRUSHES.md#seeing-what-you-made)).

`--zoom` (repeatable) also writes an enlarged crop of that region beside every
captured frame (`frame-0000-zoom1.png`, nearest-pixel, scale 3 by default) and
lists it under the frame in the transcript. Use it to judge brush texture and
edges, which a whole frame at 1× hides. To crop a frame you already have:
`pnpm --dir canvas-loop run cli zoom out/frame-0000.png 90,80,160,120@4`.

**Checkpoints.** With `CANVAS_LOOP_CHECKPOINTS=<dir>` in the environment,
every `run` also saves a numbered checkpoint there: the sketch directory's
`.ts` files, the events file, the rendered frames and transcript, and
`meta.json` (time, arguments, errors, and `run --note "what I changed"`).
`cli checkpoints <dir> [--out page.html] [--title text]` turns them into one
self-contained page with a slider: each render's picture, note, changed lines
per file, and source. It records how a drawing was developed, one look at a
time.

`cli diff <before.png> <after.png> [--out dir]` (experimental) writes views of
what changed between two frames: `highlight.png` (the after frame greyed,
magenta where pixels got darker, green where they got lighter),
`change-N.png` (each separate changed region cropped and enlarged, before and
after), `side-by-side.png`, and `stats.txt` (pixel counts and where each
change crop is). Look at the highlight first to find the edits, then the
change crops to judge them.

Writes `<out>/transcript.md` plus `<out>/frame-NNNN.png`. The out directory is
emptied first. On success it prints only the transcript path and frame
count; each sketch error prints one line and exits nonzero (the transcript is
still written, with the error frame-tagged).

Read `transcript.md` — the inline `![frame N](frame-NNNN.png)` images render
directly in tools that display markdown images (including Claude Code's `Read`).

Run one heavy GPU process at a time on a machine: several large renders at
once have crashed the GPU driver.

## Events file

A JSON array of events, each stamped with the frame it fires on. **Guarantee:
all events for frame N dispatch, in file order, before frame N's `draw`.** So
the first event of frame N sees the state after frame N−1's draw (later
events see the folds before them), and hit-testing a moving target is a calculation, not trial and error:

```json
[
  { "frame": 6, "type": "mousedown", "x": 200, "y": 150 },
  { "frame": 8, "type": "mousemove", "x": 212, "y": 144 },
  { "frame": 17, "type": "mouseup", "x": 260, "y": 120 },
  { "frame": 30, "type": "mousedown", "target": "pan-left" },
  { "frame": 40, "type": "snapshot", "label": "mid-arc" },
  { "frame": 55, "type": "param", "name": "speed", "value": 2.5 },
  { "frame": 90, "type": "keydown", "key": "r" },
  { "frame": 110, "type": "trigger", "name": "reset" }
]
```

- Input types are `mousedown`, `mouseup`, `mousemove`, `keydown` and `keyup`.
  Each becomes a `Msg` of the same type.
- A mouse entry can aim by name instead of by position: `"target": "pan-left"`
  clicks the centre (in whole pixels) of the topmost drawing with that `name`
  in the frame drawn before the event, at any depth and inside placed
  pictures. Give `target` or `x`/`y`, not both. When no drawing has the name,
  or its centre lands on another named drawing or on nothing named (a ring's
  hole), the run stops with an error that says what the centre hit; aim with
  `x` and `y` then. A frame-0 event cannot aim: nothing is drawn yet. A
  browser's recorded events keep `x` and `y` only.
- `param` sets a declared param and becomes a `param` msg. `trigger` becomes a
  `trigger` msg. Both are checked against the sketch's `params` before frame
  0: an unknown name or a wrong value type is an error.
- `snapshot` (`{ "frame", "type": "snapshot", "label"? }`) is not input. It
  captures that frame without a msg, and its `label` goes to the frame heading
  (`### frame 40 — mid-arc`). It is the scriptable twin of `v.snapshot(label?)`.

Each input line in the transcript gets an engagement verdict
(`mousedown (200,150) → grab`); see
[TEA.md](./TEA.md#engagement-verdicts).

## Capture policy

To keep image counts sane, a frame's PNG is captured when it is frame 0, the
final frame, an `--every N` multiple, or a frame that logged, ran an event, or
called `snapshot()`. Consecutive identical frames are hashed and deduped: the
transcript references the earlier PNG and notes `(unchanged)` instead of writing
a duplicate.

## Worked example

[`src/examples/bounce-tea.ts`](./src/examples/bounce-tea.ts) +
[`bounce-tea-events.json`](./src/examples/bounce-tea-events.json): a ball
you press on, carry and throw; `r` resets it. A press on the ball (named
`ball`) enters a held mode that keeps where on the ball you took it; each
move carries it; the release throws it with the last move's velocity:

```sh
pnpm --dir canvas-loop run cli run src/examples/bounce-tea.ts \
  --events src/examples/bounce-tea-events.json --out out
```

The transcript gives each scripted input its verdict:

```md
**[frame 10]** mousedown (150,244) on ball → grab

**[frame 11]** mousemove (159,237) on ball → drag

**[frame 19]** mouseup (222,188) on ball → throw

### frame 34 — thrown
![frame 34 — thrown](frame-0034.png)
```

## Examples

Each example in `src/examples/` is one sketch, `<name>-tea.ts`, and one
events file, `<name>-tea-events.json`, that drives it. Its header comment
states the one thing it shows and the doc section that links it.
`pnpm --dir canvas-loop run examples:check` runs every example from its
events file, twice: it fails on a type or lint error, a transcript warning,
a scripted input that reads `(unhandled)`, or two runs that differ. The
playground page, `dev/canvas-loop-examples.html`, shows them all; rebuild it
after changing an example with `pnpm --dir canvas-loop run build:playground`.

| Example | Shows |
| --- | --- |
| [`bounce`](./src/examples/bounce-tea.ts) | a drag as a mode: grab offset, throw, key reset |
| [`orbit`](./src/examples/orbit-tea.ts) | every param kind; a trigger resets the model and leaves the params; clicking a moving body by name |
| [`scale`](./src/examples/scale-tea.ts) | names on nested drawings, `targets`, `row` and `column` |
| [`answer-box`](./src/examples/answer-box-tea.ts) | a typed answer over the canvas (`text` param, `v.control`); `activity` |
| [`sound`](./src/examples/sound-tea.ts) | sounds chosen by meaning; a voice id per sound; `at` is the next frame |
| [`lamps`](./src/examples/lamps-tea.ts) | event-time animation: a start frame per id, then tweens of `frame - start` |
| [`pendulum`](./src/examples/pendulum-tea.ts) | physics stepped in `update` at a fixed time step; a slider on the canvas |
| [`paint`](./src/examples/paint-tea.ts) | strokes from the pointer kept as data, drawn through a chain of pictures |
| [`brushes`](./src/examples/brushes-tea.ts) | every brush preset under every pressure |
| [`paint-mixing`](./src/examples/paint-mixing-tea.ts) | colour jitter, smudge, wet paint and paper |
| [`looks`](./src/examples/looks-tea.ts) | wash and hatching on one scene |
| [`effects`](./src/examples/effects-tea.ts) | blur, glow, shadow, mask fade, tween, colour adjustment |
| [`night-room`](./src/examples/night-room-tea.ts) | a lit room: lights, materials, caster heights, tone curve, a flickering lamp |

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
keyed on the module's **sub-references** (`init`, `update`, `draw`, `params`,
`sound`; the canvas size, `seed` and `autoplay` also restart it),
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
values in the host and write them wherever you like (a beebox card,
`localStorage`, anything):

```tsx
const KEY = "my-sketch-params";

function PersistedFigure() {
  const [params, setParams] = useState(() => {
    const saved = localStorage.getItem(KEY);
    return saved ? JSON.parse(saved) : { brush: "ink", weight: 6 };
  });
  const onParamsChange = useCallback((values) => {
    setParams(values);
    localStorage.setItem(KEY, JSON.stringify(values)); // restore on reload
  }, []);
  return <SketchFigure module={brushes} params={params} onParamsChange={onParamsChange} />;
}
```

### Demo

`src/dev-demo/main.tsx` embeds two figures — orbit (uncontrolled, controls +
recorder + an `onEvent` readout) and brushes (controlled, wired to `localStorage`
with a "clear saved state" link). Build the self-contained page with:

```sh
pnpm --dir canvas-loop run build:dev-demo   # writes dev/canvas-loop.html
```

Served from disk at `/<worktree>/dev/canvas-loop.html`. A host imports the
stylesheet once: `import "@ianbicking/canvas-loop/browser/figure.css"`.

## Development

```sh
pnpm --dir canvas-loop test        # node --test; *.gpu.test.ts files run one at a time
pnpm --dir canvas-loop typecheck
pnpm --dir canvas-loop lint         # @ianbicking/personal-vibe-check preset
```
