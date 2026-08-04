---
title: "canvas-loop figure runtime: post-merge follow-up — responsive overflow + verification punch-list"
area: callback-box
filed-by: agent
discovered-in: worktree-quick-seeing-p5js — after merging the canvas-loop library + figure runtime to main (f57eb12c)
---

The canvas-loop library + figure runtime landed on `main` (merge `f57eb12c`,
2026-07-18). It shipped with several verification debts (documented honestly in
the merge) and one confirmed defect found while writing this. This is the
"what's left to be sure it's right" list. Do #1 (a real bug) regardless; the
rest are confirm-then-close.

## 1. [BUG, confirmed] canvas-loop figures overflow at narrow width

Main merged a container-fit reeducation for figures: the schema instructions
now say *"never a fixed pixel width or a `size` param … A figure must work at
phone width (~390px)"* and p5/three/d3 starters were reworked to size from
`mount.clientWidth` via a `ResizeObserver`. **canvas-loop was not reconciled to
this** — it renders at a fixed `module.canvas` size:

- `canvas-loop/browser/mount.ts:162` sets `canvas.width = size.width` (fixed,
  `module.canvas ?? DEFAULT_CANVAS`); no `ResizeObserver`, no container query.
- `canvas-loop/browser/figure.css` `.cl-canvas` has **no `max-width: 100%`** —
  `display: block` at intrinsic resolution. A 500×400 sketch overflows a
  ~390px phone viewport.

The tension is real and worth resolving deliberately: canvas-loop's determinism
*wants* a fixed canvas (byte-identical replay assumes fixed dimensions), so it
should NOT re-render at the container's pixel resolution like p5 does. The right
reconciliation is **fixed internal resolution + CSS downscale to fit**: add
`.cl-canvas { max-width: 100%; height: auto; }` so the canvas never overflows
(the pointer-coordinate mapping at `mount.ts:329` already divides by
`getBoundingClientRect().width`, so CSS scaling stays click-accurate — verify
this). Then update the figure instructions' canvas-loop section to say
canvas-loop fits by CSS-downscaling a fixed `module.canvas`, so an author picks
a sensible base size (≤ the embed column) and it scales down — distinct from the
p5/three/d3 ResizeObserver pattern. Confirm at 390px before closing.

## 2. Confirm the install-state fix (the reported Vite error)

The package MOVED (`sandbox/canvas-loop` → `canvas-loop`) and the frontend
gained a new `@ianbicking/canvas-loop: workspace:*` dep with new subpath
exports (`./browser`, `./browser/figure.css`). A `node_modules` from before the
merge can't resolve them — the reported
`Failed to resolve import "@ianbicking/canvas-loop/browser/figure.css"` is that,
not a code bug (the exports map + tracked `figure.css` are correct; a clean
`pnpm build` resolves it). **To close:** on the main checkout / dev-server host,
`pnpm install` + restart Vite (clear `src/frontend/node_modules/.vite` if it
persists), then confirm a canvas-loop figure page loads with no import error.
The shared dev router's reinstall is the boxholder's call, not a worktree
session's.

## 3. Pixel-level live verification (blocked on a filed bug)

The demo `Orbit.figure.card` (in the test box at
`~/src/box-worktrees/…/test1/content/store/figures/`) was verified at the DOM
level only — canvas mounted at declared size, generated controls present, no
error state — because the browse screenshot op flaked
([agent-browser-screenshot-flake](2026-07-10-agent-browser-screenshot-flake.md),
[browse-daemon-wedges-on-animated-canvas](2026-07-14-browse-daemon-wedges-on-animated-canvas.md)).
Its rendered frames were checked separately via the headless CLI. **To close:**
open the card in a real browser and eyeball it — sun + 3 planets animate, the
speed slider / show-orbits toggle / focus select / reset button work, a planet
click selects, ArrowUp/Down nudge speed — plus an embed
(`![x](…Orbit.figure.card?speed-scale=2)`) applies the query param, and it all
holds at 390px (ties into #1).

## 4. Full cross-model (codex) branch-diff review

Never done — codex was provider-throttled during the build, so only *targeted*
reviews ran (plan, mount lifecycle, schema contract, route security, handled-ness
fold; all findings applied) plus the finish agent's Track O diff pass. Codex now
appears usable again (`~/.codex` updated 2026-07-16; the `-m gpt-5.5` + fenced-
embed recipe worked — see `.claude/skills/cross-model/SKILL.md`). **Optional but
cheap:** a full `f57eb12c` vs the pre-branch base diff review now that it's on
main, focused on the merge-reconciliation commit (figure-starters split ×
container-fit rework) which no single reviewer saw whole.

## 5. Deploy health

The post-merge deploy hook fired, but `callback-box/deploy/.last-deploy.log`
was absent when checked — confirm the deploy actually completed and prod serves
a canvas-loop figure (create/enable one on a prod box, or check the deploy
succeeded via `deploy/README.md`'s health runbook).

## 6. End-to-end authoring loop (the real integration test)

Unit tests (canvas-loop 75, callback-box 4005) and knowledge audits (2/2) pass,
but nobody has run the *agent* authoring loop end-to-end in a box: invoke the
`canvas-loop-sketch` skill, scaffold a figure via the template
(`createFigureTemplate({runtime: "canvas-loop"})`), write a real interactive
sketch, iterate via the headless transcript loop (confirm handled-ness verdicts
show — `→ select` / `→ Δmodel` / `→ (unhandled)`), then view it as a card and
embed it. This exercises the skill, the dual-export contract, the compile route,
and the viewer as one flow — the thing all the parts were built for.

## Already filed separately (not part of this, cross-linked)

- [knowledge-audit-box-nesting](../closed/bugs/2026-07-15-knowledge-audit-box-nesting.md)
  — `--box` crashes on a shape-2 box package root. (Resolved.)
- [figure-compile-cache-and-attach-guard](../code-quality/2026-07-15-figure-compile-cache-and-attach-guard.md)
  — loose `.attach` gate, unbounded compile caches, views-side dep-staleness.
