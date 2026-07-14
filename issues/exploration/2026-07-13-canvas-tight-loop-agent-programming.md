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
