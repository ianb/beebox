---
title: "Canvas tight-loop: browser-less run→render→screenshot programming surface for agents"
needs: [design]
area: callback-box
---

Idea (Ian, 2026-07-13): instead of the browser-automation stack (`bin/browse`,
agent-browser, Chrome MCP) as the agent's way of *seeing* what a program does,
give the agent a much tighter surface: it writes a program with narrow access to
the world that renders onto a **canvas — no browser involved** — at a resolution
the agent chooses. The runtime can serialize that canvas to screenshots cheaply,
so the see-what-happened loop is one fast round trip instead of
navigate/wait/snapshot/screenshot/read-console across a live Chrome.

The output would be a single interleaved transcript: console/log lines with
frames inline at the points they occurred, so text and visuals are causally
joined instead of correlated by hand across separate tool calls.

One sketch was "every `console.log` triggers a screenshot immediately before the
log is emitted" — Ian flagged himself that this is racy. Likely resolution: make
the runtime deterministic instead of making capture atomic. Single-threaded
program, frame-based rendering (rAF-style), capture at frame boundaries, tag
every log line with the frame number it happened during; plus an explicit
`snapshot(label)` call for intentional captures. Frame numbers give the
ordering without racing. Dedupe unchanged frames so a 60fps run doesn't emit 60
identical images.

Second half of the idea: **symmetric events**. Whenever the program registers an
event handler, the runtime exposes an equally obvious way to *fire* those events
in a chosen order — so an agent can script an input sequence
(`pointerdown → drag → keypress → snapshot`) as a test run. Injected events go
through the same dispatch path as real input, so a script is simultaneously a
test, a reproduction, and a demo. Combined with deterministic time (virtual
clock, `advance(16)` stepping) and seeded RNG, runs become exactly reproducible
— which the browser stack fundamentally can't offer.

Why this fits agent cognition (assessment from the agent side, same date):

- The current browse loop costs several round trips per observation and joins
  logs↔pixels by timestamp guesswork; interleaved frame-tagged transcripts
  collapse that to one call.
- Agent-chosen resolution matters a lot: small canvases (~400×300) are cheap in
  image tokens; full-app screenshots are mostly wasted pixels. Being able to
  request a crop/zoom of a region is the visual analog of `--selector`.
- Determinism is the big win over `bin/browse`: no flake, no waits, goldens are
  possible (cf. [agent-browser-screenshot-flake](../bugs/2026-07-10-agent-browser-screenshot-flake.md)).
- Honest scope limit: this covers canvas-drawn programs (p5.js/Processing-style
  creative coding, sims, visualizations) — a new programming surface for boxes.
  It does not replace browse for the real DOM/CSS app UI. Related tension about
  which "look at output" tools earn their keep:
  [cb-render-vs-bin-browse](../decisions/2026-07-07-cb-render-vs-bin-browse.md).

Prior art to lean on: p5.js has a headless-friendly instance mode; `skia-canvas`
/ `node-canvas` give a real Canvas2D (and skia-canvas some WebGL) in Node with
no browser; frame-stepped virtual clocks are standard in game-engine testing.

## How to test this without touching callback-box (2026-07-13)

The sandbox needs almost no agent-facing API, because Claude Code's `Read`
tool already displays PNGs. So the whole experiment is a small standalone
package (a new top-level dir like `sandbox/canvas-loop/`, or outside the repo
entirely — zero callback-box changes):

1. `sandbox run sketch.ts --frames 120 --events events.json` — loads a sketch
   module (p5-style `setup`/`draw`/handlers against a headless Canvas2D),
   steps a virtual clock frame by frame, injects scripted events at their
   frame indices.
2. Writes `out/transcript.md` — log lines tagged with frame numbers, with
   `![frame-042](frame-042.png)` inline at snapshot points, deduping
   unchanged frames.

Then the actual experiment is a **Claude Code subagent**: give it the sandbox
CLI and a visual task ("build a bouncing-ball sim with drag interaction; test
it via scripted events"), and observe whether the write → run → Read-frames →
iterate loop actually works for the agent — before any box integration
exists. Success criteria worth watching: iterations-to-correct-visual, how
often it reaches for scripted events unprompted, and whether frame-tagged
logs get used to localize bugs.

## Research (2026-07-13) — runtime + determinism prior art

Full details in the research subagent run; conclusions:

- **Rendering surface: `@napi-rs/canvas`** (Rust/Skia, prebuilt binaries,
  zero system deps, fastest, active). Runner-up skia-canvas (best fidelity,
  SVG/PDF export). Avoid node-canvas (install friction, strained
  maintenance). No good headless WebGL2 exists — 2D only for the prototype.
  Pin the lib version + bundle/register a font for reproducible output.
- **Don't use real p5.js.** It can be coerced off-browser via JSDOM +
  monkey-patched `getContext` but every such project (node-p5, p5js-node) is
  dead, renderer internals are unstable, and p5 owns its own wall-clock rAF
  loop — the exact thing a deterministic runtime must control. Instead:
  a thin p5-*like* subset (~30–60 functions) over the raw context, ideally
  p5-syntax-compatible so sketches also run in a real browser.
- **Runtime shape — Flutter golden tests are the best analog**:
  `tester.tap(...)` enqueues a synthetic gesture, nothing renders until an
  explicit `pump(duration)` advances the fake clock exactly one frame,
  then `matchesGoldenFile('foo.png')`. Copy the API shape:
  `inject → step(n) → assert/snapshot`, events take effect on the next
  stepped frame, never asynchronously.
- **Event model — Elm/Redux replay**: every input (mouse, key, clock tick)
  is a serializable `{frame, type, payload}` entry in one ordered log; the
  run is a pure fold over (seed, log). Recording a session and scripting a
  test produce the same artifact — injection symmetry falls out for free.
- **Determinism discipline (lockstep-netcode lesson)**: fixed timestep
  (`now = frameCount / fps`, advances only between frames), seeded PRNG
  (`random()`/`noise()` provided, ambient `Date.now`/`Math.random`/
  `performance` unreachable inside the sandbox), all events for frame N
  dispatched before frame N draws. Sketch logs stamped with `frameCount`,
  so log↔frame ordering is total by construction — this resolves the
  screenshot-on-console.log race from the original idea.
- **Golden comparison**: pixelmatch with small tolerance + optional masks;
  per-platform/pinned-config goldens (even Skia's own test infra doesn't
  expect cross-config byte equality); `--update-goldens` flag.
- **Motion Canvas** is the cleanest frame-stepped runtime shape to steal
  from: pull-based (harness owns the loop, scene code yields per frame),
  seeded randomness as a first-class API.

## Library-ified (2026-07-14)

The validated sandbox graduated into a workspace library. It now lives at the
top-level `canvas-loop/` (peer of `agent-doctest/`) as `@ianbicking/canvas-loop`
(EXPERIMENTAL, 0.1.0), split into subpath exports — `.` (core TEA contract,
zero heavy deps), `./headless` (`@napi-rs/canvas` runner + CLI), `./react`
(`<SketchFigure>` embed component), `./eslint` (the `tea/*` plugin). The five
experiments below became the `canvas-loop/gallery/` exercise corpus — six
entries, since the particle task ran twice (Sonnet and Opus); schema in
`canvas-loop/gallery/README.md`; `experiments/` retired. A `<SketchFigure>`
demo renders at `dev/canvas-loop.html`, and a Claude Code plugin
(`canvas-loop/claude-plugin/`, skill `canvas-loop-sketch`, wired into
`.claude/skills/`) packages the author→run→Read-transcript loop as agent
guidance. The scripted `snapshot` events entry all three experiment agents
asked for shipped. Full per-track record: `canvas-loop/CHANGELOG.md` and
`canvas-loop/LIBRARY-PLAN.md`. The dated sections below are the original
experiment logs — their `sandbox/canvas-loop/...` paths are preserved as
history (the sketches they name now live under `canvas-loop/gallery/`).

## Experiment (2026-07-14) — prototype built and tested on a fresh agent

The sandbox exists: **`sandbox/canvas-loop/`** (own workspace package, zero
callback-box changes) — deterministic frame-stepped Canvas2D runtime over
`@napi-rs/canvas`, p5-like `Sketch` API (seeded RNG, virtual clock, ambient
`Math.random`/`Date.now` disabled), events-JSON injection through the real
handler path, frame-tagged `transcript.md` with deduped inline PNGs. 10/10
tests incl. byte-identical double runs; see its README.

Then the actual experiment: a fresh Sonnet subagent got only the README and a
task with no existing example — an orbit toy (3 planets, click-to-select on
*moving* targets, arrow-key speed control, HUD). Results
(`sandbox/canvas-loop/experiments/orbits.ts`):

- **2 write→run→read cycles to fully working**, verified by frames (confirmed
  independently by inspecting the PNGs).
- **Determinism converted hit-testing from trial-and-error into calculation**:
  the agent precomputed exact click coordinates on a moving planet with a
  one-liner mirroring the sketch's angle formula — first-try hit. Its own
  comparison: a browser+screenshot loop would have needed several
  screenshot/click/retry round trips for the same thing.
- **Cycle 2 caught a real render-only bug the logs could never catch**: an
  `Array.prototype.at(-1)` sentinel footgun made the HUD show "selected:
  Earth" after deselect while the log line correctly said "deselected". Only
  the frame image exposed it. This is the whole thesis — logs say what the
  code believes, frames say whether rendering agrees — and the interleaving
  made the mismatch trivial to spot.
- **Capture policy validated**: 140 frames → ~9 images; agent called the
  volume "exactly right". Events-file-as-test "felt natural — one file was
  simultaneously the test scenario and the reproduction."
- **Friction found**: (1) `experiments/` wasn't in the package's eslint
  roots → structurally-unfixable rule noise (fixed: added to roots);
  (2) the events-dispatch-before-draw guarantee was in the README but the
  agent didn't register it as a guarantee and dove into runtime source
  (fixed: stated in bold as an explicit guarantee); (3) no API gaps — the
  `s.ctx` escape hatch was never needed.

**Verdict: the tight loop works.** Next questions if this graduates from
exploration: what the box-facing packaging looks like (skill? CLI available
in box worktrees? a card type whose view is a sketch?), golden-frame
assertions (pixelmatch is researched, unimplemented), and whether sketches
should also run in a real browser canvas for user-facing display (the
p5-syntax-compatible subset keeps that door open).

## Open tension (2026-07-14): interactive controls shouldn't be reinvented per sketch

Ian's concern after the experiment: hand-rolling every slider/button (hit-test
+ drag state + drawing) per sketch is not awesome — and building a widget
system of our own (even imgui-style, the first idea floated) is reinventing
a UI toolkit.

**Preferred resolution — parameters, not widgets** (the dat.GUI/Tweakpane/leva
pattern from creative coding): the sketch *declares* tweakable parameters
(`speed: {min: 0, max: 0.2}`); nothing widget-like is built by us.

- Headless: params need no rendering. The events file sets them directly —
  `{frame: 30, param: "speed", value: 0.12}` — just another entry in the
  deterministic event log; no widget geometry, no synthesized clicks.
- Browser packaging (when sketches become box-facing): Tweakpane (tiny,
  maintained, framework-free) or leva (React, which callback-box already is)
  auto-generates the human control panel from the same declaration. A human's
  slider drag and an agent's script entry converge on the same param-change
  event — injection symmetry gets cleaner, not weaker.
- Raw coordinate events remain for the sketch's *own* direct-manipulation
  interactions (the orbit-toy planet click) — bespoke by design.

Given up: in-canvas widgets composed into the artwork itself (game-style UI).
If that ever matters, adopt an existing microui port (it emits abstract draw
commands you render yourself — maps 1:1 onto Canvas2D) rather than writing a
toolkit. Bet: the params model covers the real box use cases; start there.

## Design sketch (2026-07-14): visualization-with-controls framework

Survey of declared-input systems (Observable `viewof`, Vega-Lite
`params`/`bind`, ISF, fxhash `fx(params)`, ipywidgets/Streamlit,
Tweakpane/leva, Storybook args+play+Chromatic, Tangle/Idyll) plus an Elm
assessment. Key precedents:

- **Storybook is the only existing system unifying all three consumers**:
  declared `args` → auto controls panel, `play()` → scripted interaction,
  Chromatic → golden-image regression — one declared object drives the live
  UI and the headless test identically. Not adoptable directly (React/DOM
  component orientation), but the *story-as-shared-contract* pattern is the
  structural template.
- **ISF** (GLSL + typed-input JSON header) is the cleanest declaration
  separation: zero UI code in the artwork; any host renders widgets from
  metadata. **Vega-Lite** splits `params` (the value, drivable
  programmatically with no UI) from `bind` (the optional widget) — exactly
  the headless/browser duality. **fxhash** proves `(params, seed) → output`
  as a pure pair is what makes offline deterministic verification work.
- **Tweakpane/leva** bind to a plain object (simplest contract; poll it per
  frame) but their two-way widget↔state mutation is the anti-pattern to
  wrap: changes must flow through the event log, not mutate state directly.

The sketch (fusing those with the Elm shape we already have):

```ts
export const params = {
  speed:   { type: "number", min: 0, max: 0.2, default: 0.06 },
  palette: { type: "select", options: ["warm", "cool"], default: "warm" },
  paused:  { type: "boolean", default: false },
  reset:   { type: "trigger" },
} satisfies ParamsDecl;
```

- Sketch reads values only (`s.params.speed`), never touches a widget;
  triggers arrive as a handler (`paramTriggered(s, "reset")`). Runtime owns
  the authoritative param store.
- **One frame-stamped log for everything** (the Elm Msg lesson): param
  changes `{frame, param: "speed", value: 0.12}`, triggers, and raw
  pointer/key events (which stay — direct manipulation like dragging a
  planet is the sketch's own domain) are entries in the same ordered log.
  Output = pure function of (sketch, params, seed, log).
- **Test harness** = the existing CLI + param/trigger event types + later
  pixelmatch golden assertions. A named fixture ("story"): params preset +
  event script + expected snapshots, consumed identically by both harnesses.
- **HTML harness**: same sketch module in a browser page — real canvas,
  Tweakpane panel auto-generated from the declaration (one-way: widgets
  render *from* the store; their edits are dispatched *as log entries*), and
  a **record mode**: interact by hand, capture the param/pointer log as an
  events JSON, replay it headless. Record-in-browser → replay-as-test is the
  payoff of full symmetry.

### Elm itself? (2026-07-14)

Assessed adopting Elm outright: it covers ~80% of the semantics
(purity/determinism language-enforced, `elm-program-test` ≈ our injection
harness, messages-as-data native, time-travel debugger built in) but ~40% of
the system — **no headless rasterization exists** (elm-canvas emits a draw-
command list a browser custom element paints; headless we'd still build the
Skia/transcript/CLI layer ourselves), no auto-UI-from-params standard, a
frozen ecosystem (0.19 since 2018), a second toolchain, and — decisive —
much weaker agent fluency than TS. Conclusion: keep TS with an Elm-shaped
runtime; the experiment already demonstrated Elm-grade replay from a mutable
sketch. Two Elm ideas retained: scrub-to-frame-N (any frame reconstructible
on demand by re-folding the log) and optionally having `draw` emit a
**command list** instead of painting imperatively — enabling frame diffing,
cheap dedup, and browser rendering of the same sketch without Skia.

## Elm parity in TS (2026-07-14) — the TEA-shaped sketch

Ian: comfortable enforcing Elm-ish semantics with lint + instructions; get as
close to parity as possible while keeping Elm's basic concept. Also: represent
data flow as data flow, not concrete objects — so no Tweakpane/observer-style
widget bindings; generate plain HTML inputs from the param declaration
(~50 lines, Vega-Lite `bind` style) and dispatch their edits as log entries.

Adopt Elm's *program shape*, not just its discipline — that's where most of
the enforcement burden disappears:

```ts
export const params = { speed: {type: "number", min: 0, max: 0.2, default: 0.06} };
export type Model = { planets: readonly Planet[]; selected: number | null };
export function init(u: Util): Model
export function update(model: Model, msg: Msg, u: Util): Model
export function draw(v: View, model: Model): void
```

`Msg` is a runtime-defined discriminated union — `tick{frame}` (time is a
message), `mousedown/mousemove/...`, `param{name,value}`, `trigger{name}` —
and the frame loop is a literal fold: `model = msgs.reduce(update, init())`.
State-changes-only-via-update stops being a rule and becomes the only way
data moves; scrub-to-frame-N, record/replay, and test symmetry are
structural. Note `update(model, msg) → model` is a Redux reducer — the most
training-data-saturated idiom there is for agents, so the fluency objection
to Elm-the-language inverts here.

Parity stack (strongest first):
1. **Types**: `update`/`draw` take `DeepReadonly<Model>` — mutation is a
   compile error.
2. **Runtime**: deep-`Object.freeze` the model between frames — mutation
   throws even through casts; free at sketch scale.
3. **Determinism backstop**: run fixtures twice, byte-diff (already proven).
   Elm *prevents* impurity; we *detect* it, totally and cheaply — any
   smuggled effect either breaks the diff or is deterministic and replayable.
4. **Lint** (sketch-dir scoped): `functional/immutable-data` on params,
   `switch-exhaustiveness-check` (parity with Elm's exhaustive `case`),
   `no-restricted-imports` (sketches import only framework types).
5. **Instructions**: describe the walls.

Deliberate deviations: `u.random()` is a run-seeded PRNG (deterministic,
skips Elm's generator-threading ceremony); `log()`/`snapshot()` callable
anywhere as observability (Elm's own `Debug.log` carve-out). Unreachable:
Elm's no-library-call-has-effects guarantee — reduced by lint+diff to
"deterministic misbehavior," which replay tolerates.

**vs XState** (2026-07-14): XState's core `transition(state, event)` is
itself a pure reducer — the conflict is the interpreter layer (actors,
subscriptions, `invoke`, `after()` clocks): concrete objects + observers +
their own time, all of which we'd have to virtualize, and our runtime *is*
the interpreter. Sketch state is mostly continuous with a modal sliver —
statecharts are strong at the sliver, clumsy at the bulk. Steal the
thinking: modes as a discriminated-union Model field
(`mode: {type:"idle"} | {type:"dragging", planet}`) + exhaustive switch ≈
80% of a statechart, zero machinery. A sketch needing a deep statechart can
embed XState's pure `transition` inside `update`; actors never.

**Enforcement coverage** (property → mechanism): Model-only state → lint
(no module-level `let`, no classes) ~95%; immutability → DeepReadonly +
`functional/immutable-data` + runtime deep-freeze ~100%; input-via-Msg and
time-as-data → structural (no other channel/API exists) 100%; update purity
→ guards + restricted imports/globals + sync-only (ban async in sketches
outright) ~95%; exhaustive Msg handling → `switch-exhaustiveness-check`
(needs type-aware lint over sketch dirs) ~100%; draw view-only →
**capability injection** — `draw` gets a View with only draw commands,
`update` gets Util with `random`; nothing ambient. That's Elm's actual
trick: not checking for effects, never handing over the function. Residue
past lint/types is closed by detection: the double-run byte-diff — whatever
doesn't break it is deterministic and replay-safe by definition.

Open question: TEA ceremony vs the validated mutable tier (2-cycle result).
Next experiment: implement TEA tier + params in the sandbox, re-run the
fresh-agent test on a controls-heavy task; if cycle count holds, the mutable
tier becomes legacy.

## Experiment 2 (2026-07-14) — TEA tier, Sonnet vs Opus

Built the TEA tier in `sandbox/canvas-loop/` (pure `init`/`update`/`draw`
fold, 4 param types, deep-frozen models, capability-injected View/Util, local
`tea/*` eslint plugin + type-aware switch-exhaustiveness scoped to `*-tea.ts`,
agent guide in `TEA.md`, orbit toy ported as the worked example). Then the
identical controls-heavy task — a particle toy exercising every param type
plus a press/drag/release attractor — was given to a fresh Sonnet and a fresh
Opus agent in parallel, `TEA.md` as their only guide, with a post-hoc
compliance audit (independent lint, smuggling grep, double-run byte-diff,
frame inspection).

Results:

- **Ceremony cost ≈ zero.** Sonnet: 3 cycles; Opus: 2 — matching the mutable
  tier's 2-cycle result. Both said the pure fold *fit* particle physics
  (`particles.map(step).filter(alive)`); Sonnet's one friction point was
  expressing a fractional spawn rate purely (floor + stochastic remainder).
  Both used the mode-union pattern; Opus noted it made press/drag/release
  "trivially correct" (a stray mousemove can't spawn a phantom attractor).
- **Compliance was total, and prevention never had to fire.** Zero TEA
  violations in either sketch: no module state, no mutation attempts (the
  freeze never triggered), no async, imports confined to the types module,
  exhaustive 8-case Msg switches, the prescribed `max-params` contract
  comment used verbatim and nowhere else. Both independently deterministic.
  The only lint trip — in both, identically — was
  `unicorn/prefer-modern-math-apis` on the distance calc (→ `Math.hypot`),
  fixed in one edit from the message alone.
- **Frames caught render-only bugs again, in both runs**: HUD text ghosting
  under trails (the translucent-overlay effect never clears prior text).
  Sonnet reported it as an artifact; Opus caught it plus a too-weak
  attraction from the frames and fixed both (opaque HUD backing rect,
  strength retune) — the capability gap between the models showed in
  fix-vs-report, not in compliance or cycle count.
- **Convergent feature requests**: (1) a trails-safe overlay affordance
  (`clearRect` or documented backing-rect guidance); (2) a scripted
  `{frame, type: "snapshot", label}` events entry to capture peak moments
  without perturbing state; (3) canvas-persists-across-frames stated in
  TEA.md (trails depend on it; currently inferred from source); (4, Opus) a
  built-in run-summary tally in the transcript header.

**Verdict: TEA-shape holds at parity with the mutable tier for agents, with
enforcement resting on shape + doc rather than tripwires.** The mutable tier
can plausibly become legacy. Remaining decision for Ian: `max-params` for
`*-tea.ts` (keep the per-sketch justified disable vs raise the cap for
sketch dirs vs reshape the contract).

## Experiment 3 (2026-07-14) — Sonnet on a visually-difficult task (analog clock)

Task designed to force visual iteration (classic clock traps: 12-at-top
rotation offset, hour-hand minute-drift, numeral centering, layering), TEA
tier, `showDigital` param provided as a self-verification tool. Result
(`experiments/clock-sonnet-tea.ts`, independently verified frame-by-frame):

- **One render cycle.** The rigging failed in an instructive way: Sonnet
  front-loaded the trig, then *built itself a verification lever* — bumped
  `timeScale` to 3600 mid-script to land frames on exact round times
  (11:00:00 / 11:15:00 / 11:30:00) and eyeballed hands against the digital
  readout at those unambiguous positions. Determinism converts "visually
  difficult" into "calculable + spot-checkable at chosen instants".
- It also caught a genuinely subtle bug **analytically, pre-run**: the
  runtime ticks frame 0 too, which would have made an accumulating clock
  start at 10:08:01 — invisible in pixels, caught by checking the readout
  against hand math at frame 0. (Runtime design note: is a frame-0 tick
  right? Sketches that accumulate per tick must special-case it.)
- **Third independent request for a scripted snapshot events entry** — it
  had to bait the capture policy with a no-op param event to get specific
  frames. Now unanimous across all three experiment agents; top of the
  feature queue. New visual-precision suggestions: a runtime protractor/
  crosshair debug overlay, and `assertNear(actual, expected, tol)` for
  unattended numeric checks (converges on the planned pixelmatch/golden
  layer from the assertion side).
- Lint: full strict preset inheritance confirmed costless again (zero trips
  this run).

Implication: mathematically-specifiable visuals won't stress the iteration
loop — a future "hard visuals" experiment needs aesthetic/organic
correctness (a tree that *looks like* a tree, hand-tuned easing feel) where
there's no closed form to reason from.

## Experiment 4 (2026-07-14) — aesthetic tasks (fjord with tides; pelican on a bicycle)

Ian's hypothesis: mathematically-intractable visuals ("show a fjord affected
by tides", "pelican on a bicycle") are where feedback is genuinely required.
Two parallel Sonnet runs, TEA tier, prompts demanding cycle-by-cycle honesty.
Confirmed:

- **Fjord: 6 render cycles** (`experiments/fjord-sonnet-tea.ts`) — real
  iterative visual work at last. The failures were *conceptual, not
  numeric*: cycle 1's screen-space vertical waterline made the channel read
  as a waterfall of sky; the fix (cycle 3) was a perspective restructure —
  tide expressed at the water's *edges* (exposed foreshore + wet rim), not
  as a line sliding up the screen. Later cycles were classic art iteration:
  color continuity, composition (nested-V slopes to make walls read steep),
  and a path-ordering bug only visible as shattered slivers. Agent's own
  reflection: transcript logs "nearly useless" here — all judgment from
  PNGs; loop speed (~5s/cycle) is what made 6 cycles cheap.
- **Pelican: 2 cycles** (`experiments/pelican-sonnet-tea.ts`) — bicycle
  right on the first render, pelican fixed in one revision (pouched bill,
  wing visibility, eye contrast, material-color separation).
- **Stranger-test audit (Fable, independent)**: pelican passes — genuinely
  reads as a pelican on a bicycle; fjord passes as steep-walled tidal
  channel with a clearly-working tide sweep, though the far-channel
  "waterfall ghost" the agent fought never fully died and the wet-rim
  outlines are heavy. **Self-grade vs pixels gap observed**: the pelican
  report claims wings "draping toward the handlebars" — no handlebars are
  visible in the frames at all (the bill occupies that space); its listed
  weakness understates this. Self-critique was specific and mostly honest,
  but final-frame claims still need independent eyes — an argument for the
  planned golden/assert layer and for human-in-the-loop on aesthetics.
- **The View subset fails organic work** — both agents leaned on the
  `v.ctx` escape hatch for every curve; the fjord agent: "not an edge case
  for landscape work, it's the main tool." Convergent asks: `polygon()`/
  bezier/path primitives, gradient fills, clip regions in View; a
  **contact-sheet output mode** (`--sheet`: tiled labeled thumbnails —
  aesthetic judgment is comparison, and one-frame-at-a-time reading was the
  bottleneck); reference images/proportion guides for creature asks.
- **Lint pressure, second signal**: the fjord agent spent edit rounds
  compressing working scene code to fit `max-lines` 300 (declarative
  palettes/layer configs are line-hungry) and asked for a higher cap in
  sketch dirs — joins the `max-params` contract collision as evidence that
  sketch dirs may warrant a *considered* preset variant (Ian's call; not
  done).

Combined cycle counts across experiments: precision tasks 1–3 cycles;
aesthetic tasks 2–6. The loop's value scales with visual intractability,
exactly as hypothesized — and determinism kept even the 6-cycle run cheap.

## Follow-through (2026-07-14): drawing vocabulary completed as data

Experiment 4's `ctx` reliance resolved: `polygon(points)`, a tuple-union
`path()` command DSL (`["move",x,y] | ["quad",…] | ["bezier",…] | ["close"]`),
`linearGradient`/`radialGradient` handles accepted as `Paint` by
`fill`/`stroke`/`background`, `arc`, and scoped `clip(shape, fn)` (the one
sanctioned callback — it scopes state rather than being data). All primitives
are serializable data, preserving the command-list/browser-render option.
Sufficiency proven empirically: the fjord — the heaviest `ctx` user — ported
to `examples/fjord-tea.ts` with zero `ctx`, visually equivalent frames
(verified). One remaining `ctx`-only need surfaced: `lineJoin` (the wet-rim
stroke renders miter instead of round in the port). Also done, boxholder-
authorized: `max-lines` raised to 600 in sketch dirs. Frame gallery of all
five experiments published as an artifact (2026-07-14).

## Handled-ness (Ian, 2026-07-14): engagement as a first-class test signal

Scripted inputs should report whether anything *engaged* — the orbit
experiment's missed-click-on-a-moving-target was invisible in the
transcript and had to be inferred from downstream frames. Design (two
layers):

1. **Free signal**: TEA `update` returning the same reference = `Δmodel:
   false` per msg (reference equality, zero author cost); mutable tier's
   free layer is which handler exports fired.
2. **Named acknowledgment**: `u.handled("select-planet")` /
   `s.handled(name)` — callable during update/handlers, multiple allowed.
   Distinct from both "code ran" and "state changed" (a tick changes
   everything and handles nothing; an absorbed click handles and changes
   nothing).

Surface: transcript input lines gain an engagement verdict —
`mousedown (297,288) → select-planet` | `→ Δmodel` | `→ (unhandled)` —
and the browser `onEvent` stream carries the same. Future assert layer
gets `expectHandled(name)`. Deliberately NOT a named-handler registry
(`handlers: {name: {matches, apply}}`) — that would trade the plain-reducer
fluency for a learned structure; naming is an act inside update.

Status: implemented (2026-07-15). As-built decisions: `handled(name)` on
`Util` (TEA) and `Sketch` (mutable); verdict recorded per scripted
*interaction* event (mouse/key/trigger — NOT tick/snapshot; param keeps its
own line to avoid a double). TEA middle verdict is `Δmodel` (update returned
a new model reference); mutable middle verdict is bare `handled` (a handler
export fired — no model to diff). Transcript `input` entry:
`**[frame 30]** mousedown (297,288) → select-planet`. Browser `onEvent`
carries structured `{handled?, changed?}` (not a rendered string — the
replayable events log stays clean). `expectHandled` assert layer still
future (no assert layer exists yet).

## Research (2026-07-13) — LLM+graphics feedback-loop prior art

Nobody has built the full idea. The generate → render → look → revise loop is
well-established (mostly in academic work, mostly static images); the
event-injection half appears genuinely unaddressed in public prior art.

- **Closest on transcript structure:
  [Render-in-the-Loop](https://arxiv.org/html/2604.20730v1)** — SVG generation
  as a strict interleaved `[Prompt, Code₁, Image₁, Code₂, Image₂, …]`
  sequence; each step's canvas is deterministically rasterized (CairoSVG) and
  fed back as visual tokens. Image-only (no logs), no events. Its
  "Render-and-Verify" step filters no-visual-change iterations — worth
  stealing (it's frame-dedup as a quality gate).
- **[IntroSVG](https://arxiv.org/pdf/2603.09312)** adds textual self-critique
  interleaved with the rendered image — nearest thing to a log+frame
  transcript. **[MatPlotAgent](https://arxiv.org/html/2402.11453v3)** runs
  deterministic (temp-0) matplotlib → PNG → VLM critique with capped
  iterations, but keeps the traceback channel and the visual channel
  separate. **[PlotGen](https://arxiv.org/pdf/2502.00988v1)** fans feedback
  out to numeric/lexical/visual critic agents.
  **[plot-agent](https://github.com/c-mulliken/plot-agent)** is a small MIT
  implementation of the pattern worth reading for harness code.
- **Interactive-canvas attempts are shallow**: the
  [p5.js MCP editor](https://adilmoujahid.com/posts/2025/06/mcp-server-p5js-editor/)
  is one-directional (Claude → editor; nothing flows back);
  [tldraw make-real](https://github.com/tldraw/make-real) loops through a
  human marking up the rendered result; screenshot MCP servers are generic
  headless-browser grabs with no transcript convention. Practitioner
  write-ups (Tweag's visual-feedback-loop chapter, Addy Osmani's
  self-improving-agents post) describe the render→screenshot→critique
  pattern but always via a browser and without frame-tagged logs or event
  scripts.
- Same shape applied elsewhere confirms generality: CAD
  ([CADReview](https://arxiv.org/pdf/2505.22304)), layout/typography
  ([VASCAR](https://arxiv.org/pdf/2412.04237)).

**Gap = the idea's novelty**: (1) deterministic browser-less canvas,
(2) one unified frame-tagged log+image transcript, (3) scripted synthetic
event injection driving an *interactive* sketch through states as part of
the agent's own authoring loop. No system found combines even two of the
three cleanly; (3) exists only in game-QA/benchmark harnesses
(VLM-judged, evaluation-oriented), never as the agent's iteration surface.
