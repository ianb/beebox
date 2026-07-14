# Responsive Figures

> **Post-review amendments (2026-07-14, from the codex cross-model review of
> the implemented diff):** (1) The "loud validate error" claim below for the
> `width`/`height` removal was wrong — card schemas strip unknown keys with
> only a lint warning (`src/cards/schema.ts`), so the removal is silent, not
> validated; harmless here because the only setter was hand-migrated. (2) The
> "consumed nowhere" claim missed a real consumer: the `figure-examples` box
> skill (`src/core/box/skills-content.ts`) taught sketches reading
> `figure.meta.width` — both examples rewritten to the responsive pattern in
> the same change. (3) The three-runtime starter's ResizeObserver guard now
> tracks the logical width in a variable instead of comparing
> `renderer.domElement.width` (physical pixels), which would break under
> `setPixelRatio`. (4) The p5 inline-style hazard the review also flagged had
> already been caught during visual verification — the backstop's constraints
> use `!important` variants.

Figure cards (interactive p5/three/d3 sketches) overflow mobile viewports because
sketches are authored at fixed pixel widths — and the figure schema's own
instructions and starter sketches teach exactly that pattern. This plan fixes it
on two levels: a small display backstop in the mount harness so the existing
fleet stops overflowing (safe because p5 2.x compensates pointer coordinates for
CSS-scaled canvases), and a rewrite of the figure schema's instructions,
starters, and template so newly authored figures fit their container natively.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — **#6 Right-sized defensiveness** (the
  backstop defends a real boundary: agent-authored sketches are untrusted
  layout-wise), **#8 One way to do each thing** (one responsive pattern per
  runtime, taught in one place), **#12 The maintainer is usually an agent**
  (the instructions ARE the fix; scaffolds carry the teaching), **#4 Resilient
  AND never silent** (backstop degrades display without breaking interaction;
  it must not mask the authoring guidance).
- `callback-box/CLAUDE.md` — "Schemas can include `instructions` — prose …
  injected into agent context" (context cost budget applies); "Read before
  writing"; frontend rules via frontend.md (`className` conventions).
- `code-style.md` — no default parameters, explicit return types, teardown/
  resource discipline (mirrors the sketch-teardown contract).
- Precedent: the `{% quote %}` knowledge-audit pattern (each new agent-facing
  convention lands with a run audit — `src/dev/knowledge-audits.yaml:3217`
  figure section note shows the existing figure audits and their run status).
- The instruction-surface budget: figure `instructions` are injected into agent
  context and compiled into `docs/generated/card-figure.md`
  (`src/core/docs-gen/content.ts:38`), so additions must be tight.

## What already exists

- **The mount is already responsive.** `FigureMount` renders
  `<div ref={mountRef} className="w-full" />`
  (`src/frontend/src/components/FigureMount.tsx:120`) and invokes the sketch
  with `{ mount: el, figure }` (`FigureMount.tsx:97`) — inside a `useEffect`,
  after an awaited dynamic import, so layout has happened and
  `mount.clientWidth` is normally real. **Reused** — the backstop lands on this
  element; no API change.
- **p5 2.3.0 compensates pointer coordinates for CSS scaling.**
  `node_modules/p5/lib/p5.js:103550` (`_updatePointerCoords`):
  *"const sx = canvas.scrollWidth / this.width || 1;"* — both mouse and touch
  positions are divided by the CSS/logical size ratio. This is the fact that
  makes a CSS backstop safe for p5 interactions. (The earlier "CSS scaling
  breaks p5 drag" claim is false for the shipped version.)
- **The anti-pattern is taught in `src/schemas/figure.ts`:** the inline example
  `p.createCanvas(figure.params.size ?? 300, 300)` (figure.ts:96), the
  "nothing is clipped at the figure's declared size" bullet (figure.ts:58),
  all three `FIGURE_STARTERS` sizing from `figure.params.size || 300`
  (figure.ts:126–223), and `createFigureTemplate` scaffolding a
  `size` param, default 300, into every new card (figure.ts:246). **Rebuilt**
  — this is the instructional fix.
- **Dead schema fields:** `width`/`height` are declared
  (figure.ts:36–37) but consumed nowhere — grepped
  `src/frontend/` and `src/webapp/routes/figure.ts`; zero readers. One existing
  card sets them (test box `store/figures/Spinner.figure.card:5–6`); no prod
  card does (both prod figure cards checked on the server). **Removed**, with
  the Spinner card hand-migrated in the same change.
- **Instructions propagate automatically.** Schema `instructions` compile into
  each box's `docs/generated/card-figure.md` via `generateCardDoc`
  (`src/core/docs-gen/content.ts:38`), regenerated "by `cb init` and at the
  start of `cb reactor`" (`src/core/docs-gen/index.ts:8`); the agent guide
  points agents at that doc (`src/core/agent-guide/cards.ts:156`).
- **Template registry:** `templates-builtins.ts:233–237` calls
  `createFigureTemplate` + `figureStarterSketch` — the only consumers, so the
  rewrite is contained in `figure.ts`.
- **Existing figure audits:** three `knows_directly` audits at
  `src/dev/knowledge-audits.yaml:3222–3253` (all passing 2026-06-24, answered
  from the generated card doc). **Reused** — the new audit joins them; all get
  re-run since the doc they read changes.
- **Test fixtures already exist:** the worktree test box has five figure cards
  (`store/figures/{Spinner,Cube,Bars}` — one per runtime, scaffolded from the
  current starters — plus two draggable p5 figures under
  `store/courses/Acids_Bases.attach/material/`). These are the perfect
  backstop fixtures: authored fixed-width, interactive.
- **Real-world dogfood targets:** prod personal box has two tides figures
  (`Tide_Type_By_Latitude`, `Tidal_Resonance`), both p5, both `size`-param
  fixed-width (520/500), with DOM sliders pinned to pixel widths.

## Prior art (external)

(Verified by web search during planning; the vendored source citations above
are primary.)

- **p5 CSS-scale pointer compensation** — the scrollWidth/scrollHeight
  scaling fix was proposed and landed via
  [p5.js issue #1661](https://github.com/processing/p5.js/issues/1661)
  ("Canvas resize via CSS and mouse position") and survives in 2.x
  `_updatePointerCoords` (vendored 2.3.0 source cited above). A separate
  historical caveat — touch coordinates offset by container margin/padding —
  was [issue #440](https://github.com/processing/p5.js/issues/440), distinct
  from the CSS-scale case.
- **p5 responsive canvas** — the community pattern is `windowResized()` →
  `resizeCanvas(container.offsetWidth, …)`
  ([resizeCanvas reference](https://p5js.org/reference/p5/resizeCanvas/));
  `windowResized` only fires on window resize, so container-driven layouts
  need a ResizeObserver. ResizeObserver has a documented feedback hazard —
  "ResizeObserver loop limit exceeded" when the callback changes the observed
  element's size within a frame
  ([TrackJS writeup](https://trackjs.com/javascript-errors/resizeobserver-loop-limit-exceeded/));
  our width-compare guard is the mitigation (rAF-deferral is the general
  alternative). No p5-specific issue reporting this interaction was found —
  treat it as a general ResizeObserver caveat, not a documented p5 bug.
- **three.js responsive rendering** — the official manual's
  [Responsive Design](https://threejs.org/manual/en/responsive.html) page:
  `renderer.setSize(w, h)` + `camera.aspect = w / h` +
  `camera.updateProjectionMatrix()` on resize. Caveat: `setSize`'s third arg
  (`updateStyle: false`) suppresses writing canvas CSS size — needed when CSS
  alone drives display size
  ([three.js issue #2969](https://github.com/mrdoob/three.js/issues/2969));
  our pattern computes pixels from the container, so the default is correct.
  The manual also notes multiplying by `devicePixelRatio` for HiDPI crispness
  (out of scope here; see NOT in scope).
- **d3/SVG** — `viewBox` + `width: 100%` is the canonical responsive SVG
  pattern ([Observable: why use viewBox](https://observablehq.com/@uw-info474/why-use-viewbox));
  `d3.pointer()` transforms event coordinates into the target's own
  coordinate system via the inverse screen CTM, so interactions survive
  scaling ([d3-selection events](https://d3js.org/d3-selection/events)).
  Known caveat: viewBox scaling shrinks text and stroke widths uniformly
  ([counter-scaling gist](https://gist.github.com/veltman/5cd1ba0b3c623e7b5146)) —
  we take the "keep internal width modest" line instead (NOT in scope).

## Tracks / scope

Ordered by dependency, then size. Track A is independent and smallest; Track B
is the core; C and D depend on B.

### Track A — display backstop in FigureMount

- **What:** CSS constraints on the mount's descendants so any figure — past or
  future — cannot overflow its column, plus a tiny viewBox patch for SVGs that
  lack one.
- **Why:** already-authored figures (five in the test box, two on prod
  personal, plus any in the field) stay fixed-width until regenerated;
  instructional fixes are not retroactive. Overflow on a phone is a display
  bug we can end today, at degraded-but-usable quality.
- **Direction:** on the mount div (`FigureMount.tsx:120`):

  ```tsx
  <div
    ref={mountRef}
    className="w-full [&_canvas]:max-w-full [&_canvas]:h-auto [&_svg]:max-w-full [&_svg]:h-auto [&_input]:max-w-full"
  />
  ```

  `max-width: 100%` + `height: auto` preserves the canvas's intrinsic aspect
  ratio while capping width; p5 pointer math stays correct (see What already
  exists). `[&_input]:max-w-full` catches p5 DOM controls (`createSlider`).
  An `<svg>` without a `viewBox` *crops* instead of scaling under
  `max-width`, so after the sketch factory returns, patch descendants in the
  same mount effect:

  ```ts
  for (const svg of el.querySelectorAll("svg:not([viewBox])")) {
    const w = Number(svg.getAttribute("width"));
    const h = Number(svg.getAttribute("height"));
    if (w > 0 && h > 0) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  ```

- **First implementation chunk:** the two edits above + verification of all
  five test-box figures at ~390px via `bin/browse` (including drag interaction
  on the Acids_Bases figures on a scaled canvas).

### Track B — instructional fix in the figure schema

- **What:** rewrite `figure.ts` instructions, all three starters, and the
  template so figures are authored container-fit; drop the dead
  `width`/`height` fields.
- **Why:** the schema is the single instruction source (agents answer figure
  questions from the generated card doc — audit status note,
  `knowledge-audits.yaml:3219`). Today it actively teaches fixed-width.
- **Direction — instructions (context-borne, keep tight):**
  - Replace the "Legible and unclipped" bullet's "at the figure's *declared
    size*" (figure.ts:58) and add one sizing bullet, approximately:

    > **Fit the container.** Size from `mount.clientWidth` (fall back if 0,
    > e.g. `|| 360`), watch it with a `ResizeObserver` (disconnect in
    > teardown), and derive layout from the current canvas size — never a
    > fixed pixel width or a `size` param. Give DOM controls `width: 100%`.
    > A figure must work at phone width (~390px).

  - Rewrite the inline p5 example (figure.ts:92–101) to the responsive form
    (below), since the example is the strongest teacher.
  - Net instructions growth target: ≤ 12 lines.
- **Direction — starters (scaffolded into `attach/sketch.ts`, zero context
  cost, can be generous):**
  - **p5:**

    ```ts
    export default function (p5, { mount, figure }) {
      const width = () => Math.min(mount.clientWidth || 360, 640);
      const instance = new p5((p) => {
        p.setup = () => p.createCanvas(width(), Math.round(width() * 0.75));
        p.draw = () => {
          // derive ALL layout from p.width / p.height, not captured constants
        };
      }, mount);
      const ro = new ResizeObserver(() => {
        if (instance.width !== width()) {
          instance.resizeCanvas(width(), Math.round(width() * 0.75));
        }
      });
      ro.observe(mount);
      return () => { ro.disconnect(); instance.remove(); };
    }
    ```

    The `instance.width !== width()` guard breaks the observer feedback loop
    (resizeCanvas changes mount height → observer fires again).
  - **three:** a `resize()` doing `renderer.setSize(w, h)` +
    `camera.aspect = w / h` + `camera.updateProjectionMatrix()`, called once
    and from a width-guarded ResizeObserver; `ro.disconnect()` joins the
    existing teardown.
  - **d3:** the naturally responsive pattern —

    ```ts
    const W = 600, H = 400; // internal coordinate system, not display pixels
    const svg = d3.select(mount).append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .style("width", "100%").style("height", "auto");
    ```

    No resize handling needed; `d3.pointer()` maps events into viewBox
    coordinates. One-line caveat in the starter comment: text scales with the
    figure, so keep the internal width modest (~500–600) and text ≥ 12px so
    labels survive phone width.
- **Direction — template:** drop the scaffolded `size` param from
  `createFigureTemplate` (figure.ts:246); `params` stays documented for
  domain parameters only.
- **Direction — schema fields:** delete `width`/`height` (figure.ts:36–37);
  hand-edit `Spinner.figure.card` in `~/src/boxes/test1` (and the worktree
  clone) to drop the two lines. Not a fleet migration: no other card sets them.
- **First implementation chunk:** the full `figure.ts` rewrite + Spinner card
  edit + `pnpm typecheck && pnpm lint` + updating any doctest that snapshots
  template/starter output. No open questions inside it (patterns are settled
  by Track A's verification plus chunk-initial prototyping in the test box).

### Track C — dogfood: re-author the tides figures

- **What:** rewrite `Tide_Type_By_Latitude` (and `Tidal_Resonance`, same
  anti-pattern) to the new p5 pattern: canvas from container width, layout
  (`schem`/`plot`) derived from `p.width` each draw, sliders at
  `width: 100%`, ResizeObserver with teardown.
- **Why:** live proof the guidance produces a mobile-good figure, exercised on
  the most complex real sketch we have (draggable, DOM controls, multi-panel
  layout).
- **Direction:** iterate as a copy in the worktree test box; verify at ~390px
  and across a live resize via `bin/browse`. Applying the finished sketches to
  the prod personal box is a boxholder-gated final step (prod data, not code —
  independent of the main-merge).
- **First implementation chunk:** the test-box copy re-authored and verified.

### Track D — knowledge audit

- **What:** one new `knows_directly` entry, e.g. `figure-card-responsive-sizing`:
  prompt "You're writing a figure sketch. How do you decide the canvas width,
  and what must happen when the container resizes?"; watch_for: sizes from
  `mount.clientWidth` / fits the container, handles resize (ResizeObserver),
  derives layout from current size; must NOT say a fixed pixel width or a
  `size` param.
- **Why:** new agent-facing convention; the `{% quote %}` precedent says it
  lands with a run audit.
- **First implementation chunk:** write the entry, run
  `pnpm knowledge-audit run --box <worktree test box> --filter figure` (re-runs
  the three existing figure audits too, since the generated doc they answer
  from changes), record status comments.

## Subplans

None — no sub-question needs its own design step.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| SVG without `viewBox` under `max-width` crops instead of scaling | Track A verify: Bars (d3 starter) at 390px | viewBox patch in mount effect | Silent without the patch → patched |
| Sketch appends its SVG asynchronously, after the factory returns → misses the viewBox patch | No | No — accepted; current d3 sketches build synchronously in the factory | Silent (documented risk, below) |
| `mount.clientWidth` is 0 at sketch time (display:none ancestor / hidden tab) | Manual only | Guidance: `\|\| 360` fallback + ResizeObserver self-heals when layout happens | Degrades visibly (wrong-size canvas until observer fires), never breaks |
| ResizeObserver feedback loop: `resizeCanvas` changes mount height → observer refires → loop | Track A/C verify: live-resize via browse | Width-compare guard in the taught pattern | Would be a perf hang — loud in practice; guard prevents |
| p5 upgrade drops/changes the CSS-scale pointer compensation → backstopped figures get misaligned drag | No | No | Silent (documented risk, below) |
| Old fixed-width figures remain in the field after this ships | Covered by Track A | Backstop is exactly this handling | Visible (scaled-down figure) |
| Agent authors a new figure ignoring the sizing bullet | Track D audit + Track C fresh-authoring check | Backstop catches the overflow | Visible (figure works, degraded) |
| `width`/`height` removal makes an existing card fail validation | `cb validate` on the edited box | Only setter (Spinner) hand-migrated in the same change | Loud (validate error) |
| Boxes see stale `card-figure.md` until docs regen | No | Regenerated at every `cb init` / `cb reactor` start (`docs-gen/index.ts:8`) | Self-healing, bounded staleness |

**Documented risks (accepted, not critical gaps):**

> **p5 upgrade regression** — the backstop's interaction-safety rests on
> `_updatePointerCoords`'s scroll-ratio compensation in p5 2.3.0. A future p5
> major could change it. Mitigation: this plan's Track A verification steps
> (drag a scaled canvas at 390px) are the regression check to repeat on any p5
> bump; noted in the FigureMount comment.

> **Async-appended SVG misses the viewBox patch** — a sketch that builds its
> SVG after the factory returns (e.g. after a data fetch) won't get patched
> and would crop under the backstop. No current sketch does this; the new d3
> guidance makes sketches carry their own viewBox, so the patch is only for
> legacy sketches. Accepted rather than adding a MutationObserver.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — agent reaches for the old `size`-param habit.
  **ADDRESSED**: template no longer scaffolds it, instructions explicitly name
  it as the anti-pattern, audit checks recall.
- **Stale ref** — n/a; no refs change shape. **ADDRESSED** (no change).
- **Two agents touching the same card** — no new concurrent-edit surface;
  sketch files are ordinary attach files. **ADDRESSED** (no change).
- **Hand-edit drift** — boxholder hand-sets `width:`/`height:` frontmatter
  after removal → `cb validate` rejects unknown-vs-declared per existing card
  validation. **ADDRESSED** (loud, existing mechanism).
- **Fabricated free-form value** — n/a; no free-form field added.
- **Validation error UX** — the only new validation event is the removed
  fields; the standard schema error names the field. **ADDRESSED**.
- **Partial migration / transition state** — old sketches + new backstop
  coexist indefinitely; backstop is the designed transition state. Existing
  figures with a `size` param keep working (params still coerce; the sketch
  just ignores container width) — scaled by the backstop. **ADDRESSED**.

## NOT in scope

- **Auto-fixing the existing fleet's sketches** — instructional fixes aren't
  retroactive and a code auto-rewriter of agent-authored sketches is exactly
  the "automate judgment" trap; the backstop covers display, and figures get
  properly re-authored when next touched. (Tides is the exception, as the
  dogfood.)
- **Passing a width into the `figure` context** — considered; rejected.
  `mount.clientWidth` is already the truth and adding a second source violates
  one-way-to-do-each-thing (#8).
- **Retina/pixel-density work** — p5 and three handle DPR themselves; no
  observed problem.
- **Vertical fit** — height overflow isn't the reported problem; aspect-ratio
  guidance (derive height from width) covers the common case.
- **d3 text auto-scaling compensation** — a one-line "keep internal width
  modest" caveat instead; counter-scaling text fights the simple viewBox
  pattern.
- **Migrating other `size`-param figures' cards** — the param is harmless
  (coerced, ignored once sketches are responsive); removing it from existing
  cards is not worth a fleet edit.

## Open design questions

- **Should the taught pattern cap width (`Math.min(clientWidth, 640)`)?**
  Lean: yes in the p5/three starters as shown (an uncapped hero-width canvas
  is rarely what a figure wants), stated as an adjustable choice, not a rule.
- **Apply the re-authored tides sketches to prod personal** — gated on the
  boxholder's go; the sketches will be ready in the test box either way.

## Knowledge audits

One new entry (`figure-card-responsive-sizing`, Track D above) plus a re-run of
the three existing `figure`-tagged audits, since the generated doc they answer
from changes. All run against the worktree test box before the plan completes,
status comments recorded in `knowledge-audits.yaml`.

## Implementation order

1. **Chunk A (backstop):** `FigureMount.tsx` CSS + viewBox patch; verify all
   five test-box figures at ~390px incl. drag; commit.
2. **Chunk B (schema rewrite):** `figure.ts` instructions/starters/template +
   `width`/`height` removal + Spinner card edits + typecheck/lint/tests;
   prototype each starter live in the test box (fresh card per runtime) at
   390px and across resize before committing.
3. **Chunk C (dogfood):** tides sketches re-authored in the test box, verified
   at 390px + live resize; commit (test-box copy; prod apply awaits go).
4. **Chunk D (audits):** new audit entry + full `--filter figure` run recorded;
   commit.

Dependencies: B before C and D. A is independent and lands first because its
verification doubles as the baseline for B's patterns.

## Rollout shape

- **Test posture:** the load-bearing verification is behavioral — `bin/browse`
  at ~390px and across live resizes, per chunk, because the failure modes
  (overflow, cropped SVG, misaligned drag, observer loops) are all
  render-and-interact properties invisible to doctests. Existing doctests
  (`test/frontend/lib/figure-params.doctest.md`,
  `test/webapp/routes/routes-figure.doctest.md`) keep passing; any snapshot of
  template output updates with Chunk B. No new doctest: the changed code is
  instruction strings + a React component, neither of which this repo's
  doctest tiers exercise (`docs/testing.md` posture: don't test for coverage's
  sake).
- **Knowledge audits:** land run, with Chunk D (see above).
- **Migration:** the `width`/`height` removal is a two-file hand edit shipped
  inside Chunk B; no fleet migration. Instruction propagation is automatic at
  each box's next `cb init`/`cb reactor`.
- The plan merges to main as one unit on the boxholder's word (worktree
  discipline); the prod tides apply is a separate boxholder-gated data change.
