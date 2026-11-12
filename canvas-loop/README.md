# canvas-loop

> **EXPERIMENTAL.** `@ianbicking/canvas-loop@0.1.0`. This is a workspace library
> whose API is expected to move as agent exercises teach us more — imports,
> exports, and event shapes may change between versions. Every change is recorded
> in [CHANGELOG.md](./CHANGELOG.md).

A deterministic, browser-less, frame-stepped **Canvas2D sandbox for agent programming**.

You write a sketch, run one CLI command, and get back a single interleaved
**transcript**: frame-tagged log lines with rendered PNG frames inline.
Synthetic input events come from a JSON script and reach the sketch as
messages, the same path a real UI uses. So one events file is a test, a
reproduction, and a demo.

A sketch has one form: The Elm Architecture (TEA). `init` builds a model,
`update` folds each message into a new model, and `draw` paints it. Each
drawing call takes its style as an argument, so no drawing state carries from
one call to the next. [TEA.md](./TEA.md) is the sketch reference: the
contract, the drawing API, params and events. Brushes are in
[BRUSHES.md](./BRUSHES.md).

It renders with [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas)
(Skia, no browser). Two identical runs produce byte-identical output: time is a
fixed timestep, randomness is seeded, and `Math.random` / `Date.now` /
`performance.now` / argless `new Date()` are disabled inside a sketch.

## Run

```sh
pnpm --dir canvas-loop run cli run <sketch.ts> \
  [--frames 120] [--events events.json] [--out out/] \
  [--seed 42] [--fps 60] [--every 30] [--zoom x,y,w,h[@scale]]... [--outline] [--timing] [--note text]
```

`--outline` draws sprite, clip and `debugBox` outlines over each captured
frame; `--timing` adds a per-frame draw-time line to the transcript (see
[BRUSHES.md](./BRUSHES.md#seeing-what-you-made)).

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
overwritten each run. On success it prints only the transcript path and frame
count; each sketch error prints one line and exits nonzero (the transcript is
still written, with the error frame-tagged).

Read `transcript.md` — the inline `![frame N](frame-NNNN.png)` images render
directly in tools that display markdown images (including Claude Code's `Read`).

## Events file

A JSON array of events, each stamped with the frame it fires on. **Guarantee:
all events for frame N dispatch, in file order, before frame N's `draw`.** So
the world state a click sees is exactly the state after frame N−1's draw, and
hit-testing a moving target is a calculation, not trial and error:

```json
[
  { "frame": 6, "type": "mousedown", "x": 200, "y": 150 },
  { "frame": 8, "type": "mousemove", "x": 212, "y": 144 },
  { "frame": 17, "type": "mouseup", "x": 260, "y": 120 },
  { "frame": 40, "type": "snapshot", "label": "mid-arc" },
  { "frame": 55, "type": "param", "name": "speed", "value": 2.5 },
  { "frame": 90, "type": "keydown", "key": "r" },
  { "frame": 110, "type": "trigger", "name": "reset" }
]
```

- Input types are `mousedown`, `mouseup`, `mousemove`, `keydown` and `keyup`.
  Each becomes a `Msg` of the same type.
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

`src/examples/bounce-tea.ts` + `src/examples/bounce-tea-events.json` — a
bouncing ball you can grab (mousedown within its radius), drag, and throw
(release with the drag velocity); `r` resets it. It uses pointer and key msgs,
seeded `u.random` in `init`, `u.log`, `u.handled`, and a labelled `snapshot`
event:

```sh
pnpm --dir canvas-loop run cli run src/examples/bounce-tea.ts \
  --events src/examples/bounce-tea-events.json --out out
```

Produces a 13-image transcript for 120 frames:

```md
**[frame 16]** mousemove (260,120) → drag

### frame 16
![frame 16](frame-0016.png)

**[frame 17]** log: released with velocity 12 -6

**[frame 17]** mouseup (260,120) → release

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
values in the host and write them wherever you like (a beebox card,
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

`src/dev-demo/main.tsx` embeds two figures — orbit (uncontrolled, controls +
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
