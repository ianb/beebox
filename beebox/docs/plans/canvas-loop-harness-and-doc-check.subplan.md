---
title: "canvas-loop: a tracked GPU lock and live page; keep the showcase pieces"
status: active
workstream: canvas-brushes
issues:
  - ../../../issues/closed/code-quality/2026-11-16-canvas-loop-compare-and-speed-harness-in-scratch.md
  - ../../../issues/closed/code-quality/2026-11-16-doc-code-blocks-are-not-checked.md
---
# canvas-loop: a tracked GPU lock and live page; keep the showcase pieces

A subplan of [canvas-brushes.md](canvas-brushes.md). On 2026-11-17 a worktree
cull deleted this branch's ignored `scratch/`. The work lost three tools that
later work depends on (a GPU lock wrapper, a live page builder, and per-chunk
compare scripts) and four showcase sketches. This plan puts the tools that are
still needed into tracked code, keeps the recovered sketches where a cull
cannot reach them, and records which parts of two filed issues no longer hold.

**Issues addressed:**
`issues/closed/code-quality/2026-11-16-canvas-loop-compare-and-speed-harness-in-scratch.md`
and `issues/closed/code-quality/2026-11-16-doc-code-blocks-are-not-checked.md`: both
closed without building their proposals, because neither problem shows on
current main (NOT in scope gives the checks). Searched `issues/`
for "gpu", "lock", "scratch", "showcase", "walks-now", "live page": no other
open item matches.

## Design

No design section: these are developer tools and a place for dev-only
sketches. Nothing a person meets in the box changes.

## Smallest fix and budget

**Smallest fix:** restore `locked.sh` and the page builder as tracked shell
scripts, and copy the recovered sketches into a tracked directory. This fails
on two points. The old lock was a `mkdir` lock inside one worktree's
`scratch/` (`scratch/stage3/.browser-lock`, from the replayed `locked.sh`), so
two worktrees could each hold "the" lock and crash the GPU together; and the
package's own GPU commands (`pnpm test`, `examples:check`, `cli run`) would
still not take it unless every agent remembered to wrap them.

**Chosen design:**

| Track | Source | Tests |
| --- | --- | --- |
| A. GPU lock: `bin/with-gpu`, a named exclusive lock beside the test slots; canvas-loop's GPU scripts take it | ~110 | ~60 |
| B. Live page: `cli page <sketch.ts>…` builds one HTML page into ignored `dev/canvas-loop-pages/` | ~220 | ~40 |
| C. Showcase pieces in `dev/canvas-loop-pieces/`, one live page over them | ~40 (README, page list) | 0 |
| Docs: canvas-loop AGENTS.md, README dev section, CHANGELOG, bin/AGENTS.md line | ~60 | — |

Estimate: about 380 source lines and 100 test lines, plus about 60 lines of
docs. The recovered sketch sources (about 4,200 lines with forest v3) are
copied, not authored, and are counted separately. Not a BIG CHANGE.

## Stated preferences this plan trades against

- **Verify each issue claim against current main** (boxholder via the
  coordinator, 2026-11-17: *"These are somewhat speculative agent-created
  issues, so don't trust they are necessarily right"*; *"it's very possible it
  saw problems that were already fixed"*). Direction below records what was
  checked and what was cut.
- **Only minimal examples** (boxholder, 2026-11-16: *"We should only have
  minimal examples"*; commit `335c91b89` moved Thimble Quay and the lane game
  out of `canvas-loop/src/gallery/`). The pieces do not go back into
  canvas-loop. They go into `dev/`, which `dev/README.md:4` describes as
  *"Things the dev-repo agent ... builds for you to look at in the browser"*,
  and which does not ship (`bin/deployed-paths.ts` lists the shipped roots).
- **Reuse the platform mechanism** (boxholder memory: minimize invented
  concepts). The GPU lock reuses `bin/test-locks.ts`'s record, staleness and
  exclusive-create code instead of a new mutex, and `bin/with-slot.ts`'s
  spawn and signal handling. The page builder reuses the playground's esbuild
  setup (`canvas-loop/src/browser/build.ts:20-30`).
- **Bias toward strict.** The lock fails closed: a lock directory it cannot
  create is an error, not a silent pass. The page builder type-checks its
  sketches first (`checkSketchTypes`, `canvas-loop/src/headless/sketch-types.ts`)
  and refuses to build on an error.

## What already exists

- `bin/test-locks.ts:140` — *"export const lockDir = (gitCommonDir: string)"*;
  `:311` `acquireFullRun` — one named lock file with stale rules
  (`isLockStale`, pid, boot time, `LOCK_STALE_MS`) and exclusive create
  (`claim`, `:174`). **Reuse:** generalize `acquireFullRun` into
  `acquireNamed({ dir, name, branch, waitMs, waitingFor, label, maxAgeMs? })`;
  `acquireFullRun` calls it. Plan review (codex gpt-6-sol) found that `claim`
  creates the file before writing the record, so a waiter can read an empty
  file, judge it debris and delete a live claim. **Fix in place:** write the
  record to a private file and hard-link it into place (`linkSync` fails with
  EEXIST exactly as `open(wx)` did); this also hardens the test slots.
- `bin/with-slot.ts` — the wrapper pattern (spawn, pass signals via
  `child-signals.ts`, release on exit). **Reuse** its spawn and signal code by
  sharing a helper; `with-gpu` differs only in which lock it takes.
- `canvas-loop/src/browser/build.ts` — esbuild bundling of browser code into
  one self-contained HTML file, with the `.js`→`.ts` resolver. **Reuse:** move
  the bundler call and resolver into a small shared module; the playground
  build and `cli page` both call it.
- `canvas-loop/src/browser/mount.ts` — `mountSketch(host, { module, panel,
  initialParams, onError, inspect })`; `SceneFigure.surface.presents` and
  `.pictureCosts()` are what the lost page read (replayed `walks-now/page.ts`).
- `workstreams-app/src/router/server/docs.ts` `serveDevArtifact` — serves any
  file under a worktree's `dev/` from disk, tracked or not, at
  `/<worktree>/dev/...`. So an ignored build output in `dev/` has a dev URL
  without a token. `dev/canvas-loop-examples.html` is the tracked precedent for
  a built canvas-loop page there.
- Exhibits store (`workstreams-app/docs/exhibits.md`): survives culls, but
  holds no tracked source and needs a token URL. Considered for the pieces;
  not chosen (see Track C).

## Prior art (external)

No design decision depends on an external premise; the lock, bundler and diff
are existing repo code. No search run.

## Ontology

- **GPU lock** — new. One lock file named `gpu` at a fixed per-user path,
  `~/.cache/beebox/locks/gpu` (`BBX_GPU_LOCK_DIR` moves it, for tests only;
  `BBX_STATE_DIR` is not used because its value differs between commands).
  Not a test slot; does not count against `SLOTS`. Held by one process tree at
  a time. The holder's children get `BBX_GPU_LOCK_HELD=<holder pid>`; a nested
  `with-gpu` runs without queueing only while that pid still holds the lock, so
  a background child that outlives its holder queues like anyone. A live
  holder is never expired by age; a dead or pre-boot holder is.
- **Live page** — new. One HTML file built from one or more sketch files: a
  nav of the sketches, the chosen one mounted with its panel, a frames/s
  readout from `surface.presents`, a fixed-height line of new-picture cost from
  `surface.pictureCosts()`, and errors that stay on screen. Not the playground
  (`dev/canvas-loop-examples.html`), which is tracked and lists the registry.
- **Example** — existing: `canvas-loop/src/examples/<name>-tea.ts` with
  `<name>-tea-events.json` (`canvas-loop/AGENTS.md`, "Examples").
- **Piece** — a showcase sketch kept for looking at, not teaching: lives in
  `dev/canvas-loop-pieces/<piece>/`. Not an example; nothing links it from the
  docs.

## Tracks / scope

### A. GPU lock

- **What:** `bin/with-gpu [--] <cmd…>` runs a command while holding the
  machine-wide GPU lock. canvas-loop's `cli`, `examples:check` and the GPU half
  of `test` run through it.
- **Why:** several GPU processes at once have crashed this Mac's GPU driver
  (`canvas-loop/AGENTS.md`, "GPU"). The only lock was a lost scratch script
  that agents had to remember, scoped to one worktree.
- **Direction:** `bin/with-slot.ts --gpu -- cmd…` (the slot wrapper's spawn,
  signal and exit-code code, taking the GPU lock instead of a slot). If
  `BBX_GPU_LOCK_HELD` names a pid that holds the lock it runs the command
  directly; otherwise `acquireNamed({ dir: gpuLockDir(), name: "gpu", waitMs:
  Infinity, maxAgeMs: Infinity, … })`, spawns the command with
  `BBX_GPU_LOCK_HELD=<own pid>`, passes signals, releases on exit, exits with
  the child's code. Fails closed: an unusable lock directory stops the command. Waiting prints one
  line to stderr naming the holder (pid, branch, since), as `acquire` does.
  `bin/with-gpu` is the thin shell launcher. The whole `cli` script takes the
  lock, so `cli diff`, `cli zoom` and `cli page` also wait behind a running GPU
  job; they are seconds long, and one wrapped script keeps the default path
  safe without the CLI importing `bin/`. canvas-loop scripts:
  `"cli": "node --import tsx ../bin/with-gpu.ts -- node --import tsx src/headless/cli/main.ts"`,
  the same for `examples:check`, and the `*.gpu.test.ts` half of `test`.
- **Vocabulary lock-ins:** `bin/with-gpu`, `BBX_GPU_LOCK_HELD`, lock name `gpu`.
- **First chunk:** `acquireNamed` refactor with `acquireFullRun` on top (its
  existing test passes unchanged), the linked claim, the `--gpu` mode, the
  launcher, a test (`bin/test/with-gpu.test.ts`: a second holder waits until
  the first exits; a nested wrapped command runs without waiting; a stale
  `BBX_GPU_LOCK_HELD` does not bypass; the child's exit code passes through),
  and the package script changes.

### B. Live page

- **What:** `pnpm --dir canvas-loop run cli page <sketch.ts>… [--name n]`
  type-checks the sketches, bundles a page, writes
  `dev/canvas-loop-pages/<name>.html` (ignored), and prints its dev URL
  `http://localhost:3210/<worktree>/dev/canvas-loop-pages/<name>.html`.
- **Why:** a person needs to try an interactive sketch live with its controls
  and see whether it holds frame rate. The lost `walks-now` page did that from
  scratch and was rebuilt by hand per entry list.
- **Direction:** `canvas-loop/src/browser/live-page.ts` exports
  `livePage(entries: readonly { key: string; label: string; module: unknown }[])`
  — the replayed `walks-now/page.ts` generalized: `?s=<key>` picks the entry;
  errors from `onError` append to a list that stays until reload. The builder
  (`canvas-loop/src/headless/page-build.ts`) writes a temporary entry file
  that imports each sketch by absolute path and calls `livePage`, bundles it
  with the shared esbuild helper (inlining `figure.css`), and writes the HTML.
  Labels default to the sketch's directory name when the file is
  `sketch-tea.ts`, else its basename. `--name` must be one filename component
  (`[\w-]+`). The URL is printed only when the checkout maps to a router name:
  a directory under `beebox-worktrees/` (its name) or the main checkout
  directory `beebox` (`main`); otherwise only the file path. A module that
  `mountSketch` rejects synchronously goes to the same error list.
- **Vocabulary lock-ins:** `cli page`, `dev/canvas-loop-pages/` (ignored).
- **First chunk:** shared bundler module (playground build output unchanged:
  rebuild and confirm the HTML bytes match), `live-page.ts`, `page-build.ts`,
  the CLI branch, `.gitignore` line, and a test for the label and entry-file
  generation (pure functions).

### C. The showcase pieces

- **What:** the recovered Thimble Quay, Mochi Must Not Fall, Pointer Forest
  (newest, plus `v3/`), and Fractal Paint go to `dev/canvas-loop-pieces/<piece>/`
  with their events files and notes (FRICTION.md, task.md, meta.yaml). A short
  README there lists them and gives the `cli page` command.
- **Why:** the cull deleted them; the boxholder wants them kept without making
  them examples.
- **Direction:** tracked in `dev/` (not shipped, not examples, not linted:
  root `eslint.config.ts` is empty by design and `dev/` is outside every
  package's tsconfig). The page builder's type check is their check. Each is
  updated only as far as needed to type-check and render on current main.
- **First chunk:** copy, type-check with `cli page`, render each piece's
  events headless under the lock, look at frames.

## Could this be simpler?

The simplest version is two shell scripts in `bin/` (lock, page build). It
fails on: (1) the lock scoped to one worktree, per the GPU crash history in
`canvas-loop/AGENTS.md`; (2) package scripts that do not take the lock, so the
default path stays unsafe; (3) a page builder outside the package, which would
duplicate the playground's bundler and break when it changes. The compare,
the speed mode and the doc check are cut (NOT in scope).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A killed holder leaves the `gpu` lock file | yes (stale-record tests in test-locks) | `readLive` deletes debris by pid/boot/age | clear |
| A wrapped command spawns another wrapped command (`pnpm test` inside `with-gpu`) and deadlocks | with-gpu test | `BBX_GPU_LOCK_HELD` bypass | clear |
| Lock directory not writable | no | `mkdirSync` throws; with-gpu exits non-zero with the message | clear |
| A waiter reads a just-created, still-empty lock file as debris and deletes a live claim | no (a timing race) | the record is linked into place complete | clear |
| A long GPU job outlives `LOCK_STALE_MS` | no | the GPU lock passes `maxAgeMs: Infinity`; only a dead or pre-boot holder is reclaimed | clear |
| A background child outlives its holder and keeps `BBX_GPU_LOCK_HELD` | with-gpu test | bypass only while that pid holds the lock | clear |
| Two waiters reclaim the same debris and one deletes the other's fresh claim | no | not handled: needs a crashed holder and two waiters in the same millisecond; accepted | silent (accepted) |
| `cli page` on a sketch with a type error | page test | refuses to build, prints errors | clear |
| Dev page URL wrong for a checkout the router does not know | page test | URL printed only for a known checkout; the file path always | clear |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tool — an agent runs a GPU command outside the package scripts (a
  direct `node … main.ts run`): ADDRESSED partly; canvas-loop/AGENTS.md "GPU"
  says to prefix `bin/with-gpu`. Box `bbx figure run` is not wrapped (NOT in scope).
- Two agents — two worktrees both run `examples:check`: ADDRESSED; the second
  waits and prints who holds the lock.
- Hand-edit drift — a piece edited to an API that later changes: ADDRESSED
  only when someone rebuilds its page (type check refuses); pieces are not in
  any commit check, by choice.
- Validation error UX — lock wait line and type errors are one line each, in
  the forms the existing tools print.
- Partial migration — none; no data shape changes.

## NOT in scope

- **Doc code-block check (issue `2026-11-16-doc-code-blocks-are-not-checked`).**
  Checked against current main with a throwaway prototype: README.md, TEA.md
  and BRUSHES.md hold 33 `ts`/`tsx` blocks; none is a whole sketch (the whole
  sketches are the examples, which `examples:check` renders). With `v` typed
  as `View`, `u` as `Util`, other free names as `any`, and `return`/`case`
  fragments wrapped in a function, every block that calls the API
  type-checks; the blocks that fail do so on the wrapper (shorthand
  properties, an API listing that is not code, a relative import), not on a
  stale call. The issue's evidence, the README fix in `ec34ca70b`, changed
  only prose: the eleven inaccuracies it fixed were sentences. A block check
  would not have caught it, and a box agent that copies a stale fragment gets
  a type error at `bbx figure run`, which type-checks. The check did not meet
  the bar of catching a real current failure; the issue is closed with this
  record, to reopen if a stale block is found.
- **Examples compare (`cli compare <ref>`).** The issue's scripts compared the
  gallery and cache cases; both are gone from main (`73d67cd7e`). No renderer
  change is open, and a compare across refs would share this checkout's
  `node_modules` and could blame the renderer for a dependency change. Cut on
  plan review (codex gpt-6-sol). If a renderer change needs it: render each
  example with `cli run` in both trees and `cli diff` the PNGs.
- **Speed mode (pooled pointer latency and frame times across two builds).**
  No performance work is open. The live page's frames/s and picture-cost line
  covers spot checks.
- Wrapping beebox's `bbx figure run` and `test/deploy/figure-gpu.test.ts` in
  the GPU lock: another package; file an issue if contention shows up there.
- Lint and commit checks on `dev/canvas-loop-pieces/`: casual dev sketches.

## Open design questions

- Tracked `dev/` or the workstream exhibits store for the pieces? On
  2026-11-16 the boxholder moved them out of `canvas-loop/` (commit `335c91b89`,
  "they now live outside the repo"); the brief of 2026-11-17 asks for a home a
  cull cannot delete and allows a tracked source. Both survive a cull. Chosen:
  tracked `dev/canvas-loop-pieces/`, because the store is not in git (a disk
  loss or store cleanup takes it) and has no history. Reported to the
  boxholder as a reversible choice: moving them to the store is one copy and
  one deletion.

## Knowledge audits

New agent-facing convention: "wrap GPU work in `bin/with-gpu`; use `cli page`
for a live page". It is
dev-repo guidance in `canvas-loop/AGENTS.md`, not box-loaded. No box audit. A
dev knowledge audit is not run: the guidance is three lines in the file an
agent reads before canvas-loop work.

## What will hold this after it ships

`bin/test/with-gpu.test.ts` holds the lock behaviour (wait, bypass, exit
code, stale bypass). canvas-loop unit tests hold the pure parts of the page
build (labels, keys, entry source, URL).
The package scripts holding the lock are visible in `package.json`; every GPU
test and `examples:check` run exercises them.

## Implementation order

1. Track A (lock), then switch canvas-loop's scripts to it. Commit.
2. Track B (shared bundler, live page, `cli page`). Commit.
3. Track C (pieces, their page, renders checked). Commit.
4. Docs: canvas-loop AGENTS.md (lock and page instead of scratch copies),
   README development section, CHANGELOG, bin/AGENTS.md pointer; close the
   two issues with their findings. Commit.
5. Cross-model review of the diff; fixes. Commit.

## Rollout shape

Done when: `bin/test/with-gpu.test.ts` passes; canvas-loop `test`, `typecheck`,
`lint`, `examples:check` pass under the lock; `cli page` builds the pieces'
page and it loads in `bin/browse` with no error. No migration, no knowledge
audits.

## Plan review

Codex (gpt-6-sol), 2026-11-17, nine findings. Adopted: the half-written
claim race (linked claim), age expiry of a live GPU holder (`maxAgeMs:
Infinity`), the lock path following `BBX_STATE_DIR` (fixed path), the
inherited bypass outliving its holder (bypass checks the pid holds the lock),
cutting the compare, the doc-check wording (did not meet the bar, rather than
disproved), synchronous mount errors on the page, and `--name` and URL
boundaries. Not adopted as a gate: the pieces' home, which the brief left to
this plan; it is reported as a reversible choice (Open design questions). The
remark that wrapping all of `cli` also queues `diff`, `zoom` and `page` is
accepted as a cost (Track A).
