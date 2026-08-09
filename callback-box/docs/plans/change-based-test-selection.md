**Status:** proposed 2026-08

# Change-based test selection via a runtime import map

Run only the test files a change can plausibly break, instead of all 480
`callback-box` test files, on every agent iteration and every `/finish`. The
selector reads a map of "which source modules did this test file import",
recorded by the doctest loader during full runs, and falls back to the full
suite whenever anything is unknown, stale, or ambiguous.

**Issues addressed**

- `issues/exploration/2026-08-08-run-less-of-the-test-suite.md` — the origin
  item. Its `## Research (2026-08-08)` section is the profiling baseline this
  plan builds on; the plan does not re-derive it.
- `issues/bugs/2026-08-05-doctest-loader-tsx-resolution-flake-recurred.md` —
  not resolved by this plan, but this plan instruments the exact `resolve` hook
  that flakes, and it adds a rule (below) that makes the flake fail safe instead
  of silently corrupting the map. The interaction is designed for here.

Checked and not addressed: `issues/bugs/2026-07-29-flaky-login-redirect-doctest.md`
(a different flake; selection reduces parallel load, which may reduce its
frequency, but this plan claims no fix) and
`issues/docs-and-chores/2026-08-08-maintenance-cadence-framework.md` (this plan
adds one scheduled job that should later fold into that framework; it does not
build the framework).

---

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` **#4 — "Resilient AND never
  silent"**. The central risk here is a selector that quietly runs too few
  tests. Every fallback must be loud, and no failure may degrade into "ran
  fewer tests" without saying so.
- **#6 — Right-sized defensiveness**, and the boxholder's
  `stop-over-engineering-rare-failures` guidance. Bounds the above: the plan
  must not grow machinery for failures that cannot occur on the real path.
- **#10 — Testability is architectural.** The selector's own correctness is
  testable pure logic; the plan separates the pure selection function from the
  git/filesystem I/O so it can be doctested.
- **#11 — Enforcement beats convention.** The dynamic-import blind spot (below)
  is closed by a test that fails, not by a note in a doc.
- **#12 — The maintainer is usually an agent.** The selector's output is read by
  agents. It must state what it selected and why, in one line, without a flag.
- `CLAUDE.md`: "Treat noisy command output as a bug" — the selector runs on every
  iteration; its output budget is one or two lines.
- Precedent: `/finish`'s docs-only fast path
  (`.claude/agents/finish.md:73-74`) — *"It's docs-only **iff** every changed
  path sits under a `docs/` directory AND none is a `.doctest.md`."* This plan
  generalizes that shape: path-precise, conservative, and it names its carve-outs.

---

## What already exists

- **We own the loader.** `agent-doctest/src/doctest-hooks.mjs:20` exports
  `resolve(specifier, context, nextResolve)`, registered from
  `agent-doctest/src/doctest-loader.ts:11` (`register(new URL("./doctest-hooks.mjs",
  import.meta.url))`). `.taprc` loads it last of the three `--import` hooks, so
  it runs **first** in the resolve chain and sees every module specifier the test
  process resolves. **Reused**, not rebuilt: recording is an addition to this
  hook, not a new mechanism.
- **The loader already resolves the awkward cases.** `doctest-hooks.mjs:28-45`
  carries the TSX `.js` → `.tsx` workaround. This is direct evidence that module
  resolution here is subtle enough that a *re-implementation* of resolution (a
  static import graph) would have to reproduce it. See "Could this be simpler?".
- **Route doctests do import the server.** Verified, not assumed:
  `test/webapp/routes/routes-api.doctest.md:6` imports
  `../../helpers/doctest-server.js`, and `test/helpers/test-server.ts:25` imports
  `../../src/webapp/server.js`. `src/webapp/server.ts` contains no dynamic
  `import(` (grep returns nothing), so the whole route graph is statically
  imported and therefore fully recorded. The briefing's claim holds.
- **`/finish` already has a per-path verification map**
  (`.claude/agents/finish.md:184-196`) — `callback-box/` → `pnpm test`; root
  `bin/`, `dev/` → root `pnpm test`. **Reused**: the selector plugs into the
  `callback-box/` row only. The root suite (19 `bin/*.test.ts`, 2.60 s per the
  research section) is never selected — it is cheaper to run than to reason about.
- **`bin/manual-tests-scheduled.sh`** is a complete, working "launchd →
  constrained triage agent → files an issue → macOS notification" pattern,
  including a `snapshot_open_issues` guard and a `validate_triage_result` parser
  (`bin/manual-tests-scheduled.sh:66-96`). **Reused as the model** for the
  nightly full run; not rebuilt.
- **esbuild is already a dependency and is already used for a build step**
  (`callback-box/scripts/build-cli.mjs:15`, run by `pretest`). Relevant to the
  rejected alternative below.
- **No existing changed-file utility.** Root `package.json` has
  `path-leak-check`, `commit-blocklist-check`, `mobile-contract-check` — all
  `node --import tsx bin/*.ts` scripts with sibling `bin/*.test.ts` files. The
  selector follows that shape exactly; nothing to reuse beyond the convention.

---

## Prior art (external)

- **Microsoft Test Impact Analysis (Azure DevOps)** — the named industry
  practice. Its safety answer is the one this plan copies: TIA never runs *only*
  the selected set forever; it forces a periodic full run, and it treats "the
  map does not know about this" as "run everything".
  https://learn.microsoft.com/en-us/azure/devops/pipelines/test/test-impact-analysis
- **Jest `--changedSince` / Vitest `--changed`** both walk the *static* import
  graph. Their documented limitation is the same one this plan inherits in the
  opposite direction: they over-select (a statically imported but never-executed
  module still counts) and they miss non-import coupling entirely.
  https://jestjs.io/docs/cli#--changedsince
- **Node.js module customization hooks** — `resolve`/`load` run on a **separate
  loader thread**, and communication back to the application thread is via a
  `MessagePort` passed through `register(..., { data, transferList })`. This is
  the documented API and it constrains the recording design (see Track 1).
  https://nodejs.org/api/module.html#customization-hooks
- **Searched and found nothing**: no published prior art for recording an import
  map from a *markdown doctest* runner specifically. That is expected — the
  format is ours. No prior art found for combining commit-count-derived full-run
  cadence with selection; the schemes described publicly all use CI-server state.

---

## Tracks / scope

Ordered by implementation dependency: recording produces the map, the map feeds
the selector, the selector feeds the two callers, and the cadence gates the
callers.

### Track 1 — Record the import map in the doctest loader

**What.** Under an opt-in env var, every test process writes an append-only
NDJSON shard listing each repo-relative module path it resolved, attributed to
the test file that owns the process.

**Why this needs to change.** Nothing records this today. Without it there is no
map, and the coarser alternatives are either unsafe (directory heuristics — see
"Could this be simpler?") or expensive (coverage).

**Direction.**

Recording is gated on `CB_TEST_MAP_DIR`. When unset — every ordinary run,
including every selected run — the hook is byte-for-byte the code that runs
today plus one `if` on a module-scope constant. Recording is only ever on during
a *full* run.

Recording happens **on the loader thread, with synchronous writes**, not by
posting to the application thread. Reason: a `MessagePort` message posted
immediately before process exit is not guaranteed to be delivered, and a
dropped message means an under-recorded map, which means under-selection, which
means a shipped regression. The failure direction is unacceptable, so the design
takes the synchronous path. Cost is bounded by opening the shard once
(`openSync` in append mode, kept in module scope) and using `writeSync` per
resolution — one write syscall per module, on a run that already takes ~570 s.

Shape, in `agent-doctest/src/doctest-hooks.mjs`:

```js
// module scope
const recordDir = process.env.CB_TEST_MAP_DIR;
let shardFd = null;        // opened lazily on first repo-relative resolution
let recordingDisabled = !recordDir;

function recordResolved(url) {
  if (recordingDisabled) return;
  try {
    /* openSync(join(recordDir, `${process.pid}.ndjson`), "a") once, then
       writeSync(shardFd, `${repoRelative(url)}\n`) */
  } catch (_e) {
    // Recording must never break a test run. One failure disables it for this
    // process; the reducer's completeness check (below) then rejects the map.
    recordingDisabled = true;
  }
}
```

and in `resolve`, after the existing branches:

```js
const resolved = await nextResolve(specifier, context);
recordResolved(resolved.url);
return resolved;
```

The two existing short-circuit branches (`.doctest.md`, the TSX fallback) also
call `recordResolved` on their return value.

**Attribution.** The first repo-relative `.doctest.md` or `.test.ts` URL a
process resolves is that process's *owner* — tap runs exactly one test file per
child process. Everything the process resolves afterwards is a dependency of the
owner. A test file that imports another test file records the second one as a
dependency, which is the correct edge.

**Filtering.** Only URLs under the repository root are recorded, and
`node_modules` is excluded. Temp-directory paths (every box a test creates) are
outside the repo and drop out naturally — including the cache-busted dynamic
imports at `src/schemas/registry.ts:330`
(`await import(pathToFileURL(filePath).href + \`?v=${hash}\`)`), whose targets
live in a temp box, not in this repo.

**First implementation chunk.** The hook change plus an `agent-doctest` doctest
that runs a fixture test file with `CB_TEST_MAP_DIR` set and asserts the shard
contains the fixture's imports and its owner line. No open questions inside it.

### Track 2 — Reduce shards to a map, with a completeness invariant

**What.** `bin/test-map build` reads the shard directory and writes one map
file. It refuses to write unless the run was complete and green.

**Why this needs to change.** A partial map is worse than no map: no map fails
open to the full suite, a partial map silently selects too little.

**Direction.** The reducer's inputs are the shard directory, the tap run's exit
status, and the discovered test-file list. It writes the map **only if all hold**:

1. the run exited 0;
2. the set of owner files across all shards equals the set of test files tap
   discovered (`tap --list` or the same glob as `.taprc`'s `include`/`exclude`);
3. no shard reported that recording was disabled mid-process;
4. the working tree was clean at the recorded commit.

Condition 2 is the one that matters most. The TSX resolution flake
(`issues/bugs/2026-08-05-…`) ends a child with `1..0 # no tests found` — the
process starts, resolves a handful of modules, and dies before importing its
real dependencies. Its shard exists and is short. Without condition 2, that
child's under-recorded shard becomes a map entry, and every source file it
should have listed silently loses a test. **The flake's failure mode is exactly
the map's worst failure mode, and condition 2 is what converts it into "no map
refresh today".**

**Map location.** `$(git rev-parse --git-common-dir)/callback-test-map.json`.
Rationale: `--git-common-dir` resolves to the *shared* git directory from inside
any worktree, so one map serves the main checkout and every worktree; it is
never committed; it survives worktree removal; and there is exactly one path to
reason about. Written atomically (temp file + `rename`) so concurrent sessions
cannot read a half-written map.

**Map contents.**

```jsonc
{
  "version": 1,
  "recordedAtCommit": "<sha>",
  "recordedAt": "<iso8601>",
  "testFiles": ["test/core/box.doctest.md", "..."],   // the complete run set
  "sourceInventory": ["src/core/box/package.ts", "..."], // every repo file seen
  "sources": { "src/core/box/package.ts": ["test/core/box.doctest.md", "..."] }
}
```

`sourceInventory` is what makes "this source file is in no test's import list"
distinguishable from "the map has never heard of this file" — the two need
different responses (see Track 3).

**Why a cache and not a committed artifact.** A committed map would be
regenerated only on full runs, which by design happen every Nth commit. At ~35
commits/day it would be *systematically* stale, and its diff — thousands of
lines churning on every import change — is noise no reviewer reads. Reviewability
was the argument for committing it; a map that is stale by construction is not
reviewable in any useful sense. Instead the map states its own age and the
selector prints it (Track 3), and `bin/test-map status` answers "how stale is
it" on demand. Traces to principle #4: the honest signal is a stated age, not a
diff nobody reads.

**First implementation chunk.** `bin/test-map.ts` with `build` and `status`
subcommands, plus `bin/test-map.test.ts` asserting each of the four refusal
conditions.

### Track 3 — The selector

**What.** `bin/test-select` prints either the list of test files to run, or the
literal token `FULL`.

**Why this needs to change.** This is the decision point where every fail-open
rule lives. It must be one place, pure, and tested.

**Direction.** Split into a pure function and a thin I/O shell (principle #10):

```ts
selectTests(input: SelectionInput): SelectionResult
// SelectionInput  = { changed: string[]; deleted: string[]; map: TestMap | null;
//                     headCommit: string; commitsSinceRecord: number; config: SelectionConfig }
// SelectionResult = { kind: "full"; reason: string }
//                 | { kind: "selected"; tests: string[]; reason: string }
```

The shell computes `changed` from `git diff --name-only <base>...HEAD` **plus**
`git status --porcelain` (uncommitted work is the iteration loop's whole point),
reads the map, and prints the result.

**Fail-open rules, in evaluation order.** Any one of these yields `FULL`:

1. No map, unreadable map, or `version` mismatch.
2. `recordedAtCommit` is not an ancestor of `HEAD`, or `commitsSinceRecord`
   exceeds the staleness bound, or `recordedAt` is older than the age bound.
3. Any changed path matches a `forceFull` glob (list below).
4. Any changed source path is absent from `sourceInventory` — a new or renamed
   file the map has never seen.
5. Any path was **deleted or renamed** — the map's keys no longer describe the
   tree.
6. The set of test files on disk differs from `map.testFiles` — tests were added
   or removed since recording.
7. Any error at all. The shell exits non-zero, and **every caller treats a
   non-zero exit as "run the full suite"**, never as "skip".

**The genuinely interesting case — a changed source file that is in
`sourceInventory` but in no test's import list.** This is untested-by-import
code. Running the whole suite for it is not just wasteful, it is wasteful in the
most common case there is: most of `src/frontend/src/components/` is imported by
no doctest, and a component tweak is a frequent change. Since no test imports it,
no test can observe it *through an import* — the only ways it can break a test
are the non-import channels this plan enumerates below. So the rule is: select
`alwaysRun` (the non-import-coupled set) and nothing else, and **say so**:

```
test-select: 6 files (src/frontend/src/components/Composer.tsx is imported by no test — running the blind-spot set only)
```

That line is the rot detector. A file that should be tested and is not shows up
in the agent's terminal the moment someone edits it, on every edit, forever.

**`forceFull` — paths where the map is structurally blind.** Committed as
`bin/test-select.config.ts`, each entry carrying a one-line reason:

| Glob | Why the map cannot see it |
| --- | --- |
| `callback-box/.taprc` | Run configuration; imported by nothing. |
| `callback-box/package.json`, `pnpm-lock.yaml`, `package.json` | Dependency and script changes. |
| `callback-box/tsconfig*.json`, `callback-box/src/frontend/tsconfig*.json` | Resolution and compilation settings. |
| `agent-doctest/**` | The runner and the recorder themselves. |
| `callback-box/templates/**` | Read from disk by path — `src/core/box/defaults.ts:49`: `path.join(PACKAGE_ROOT, "templates", "procedures")`. |
| `callback-box/test/helpers/**` | Imported, so technically mapped — but a *new* helper is rule 4 anyway, and helpers fan out to hundreds of files, so the map would select nearly everything. Forcing full is both safer and no more expensive. |
| `callback-box/test/fixtures/**`, `callback-box/test/mobile-contract/fixtures/**` | Read by path, not imported. |
| `callback-box/scripts/build-cli.mjs` | Produces `dist/cli.mjs`, which five test files spawn. |
| `callback-box/bin/cb` | Spawned as a subprocess (`src/core/script-env.ts:30`, `src/cli/commands/view.ts:232`). |

**Deliberately NOT in `forceFull`: `src/lib/`.** The briefing proposed it. The
map covers `src/lib/` exactly and transitively — every module's own imports pass
through the same `resolve` hook, so a test that imports a helper that imports
`src/lib/file-lock.ts` records `src/lib/file-lock.ts`. A `forceFull` entry there
would be redundant with a mechanism that is already precise, and redundant
force-full entries are how a selection system quietly degrades into "always
full". `forceFull` is reserved for coupling the map *structurally cannot*
observe. Traces to principle #6: defensiveness sized to the actual gap.

**`alwaysRun` — tests whose coupling is not an import.** Also committed, with
reasons:

| Test file | Non-import coupling |
| --- | --- |
| `test/hub/hub-e2e.doctest.md` | Builds the CLI and the frontend, then spawns the hub binary (`:116`, `:121`, `:136`). 8.4 s solo. |
| `test/webapp/views-compiler-v2.doctest.md` | Spawns `dist/cli.mjs` (`:71`). |
| `test/cli/commands/view-test-command.doctest.md` | Spawns the built CLI. |
| `test/cli/commands/trick.doctest.md` | Spawns the built CLI. |
| `test/cli/lib/view-lint-hooks.doctest.md` | Spawns the built CLI. |

Solo cost of the whole set is roughly 55 s by the research table's solo/loaded
ratios — the standing price of every selected run. That price is what buys
coverage of the subprocess blind spot, and it is worth naming as a cost rather
than discovering it later.

**First implementation chunk.** `bin/test-select.ts` (pure `selectTests` +
shell), `bin/test-select.config.ts`, `bin/test-select.test.ts` covering every
numbered rule above plus the untested-by-import case. No open questions inside it.

### Track 4 — Close the dynamic-import blind spot with a test, not a note

**What.** A test that enumerates dynamic `import(` call sites in
`callback-box/src/` and fails if a call site's target is neither statically
imported elsewhere nor listed in `forceFull`.

**Why this needs to change.** Runtime recording under-approximates in exactly
one structural way: a module that is only ever reached through a conditional
dynamic `import()` is recorded only if the recording run took that branch. If it
did not, the module maps to no test, and a change to it selects nothing. That is
the plan's single most dangerous failure mode and it is silent.

**Direction.** The surface is small and enumerable — eight dynamic imports in
`src/`, of which the ones with repo-local targets are:

```
src/cli/bootstrap.ts:37          await import("./lib/fetch.js")
src/cli/commands/validate.ts:342 await import("./validate-hook.js")
src/cli/commands/view.ts:170     await import(mod.moduleUrl)          // box-local, out of repo
src/cli/commands/view.ts:176     await import("callback-box/view-widgets")
src/webapp/views/view-meta-import.ts:27  await import(moduleUrl)      // box-local, out of repo
src/schemas/registry.ts:330      await import(...+ "?v=" + hash)      // box-local, out of repo
```

The test greps for `import(` with a *literal* specifier, resolves it, and
asserts the target is covered. Computed specifiers (`moduleUrl`) are asserted to
resolve outside the repo — if one ever points inside, the test fails and someone
decides. Traces to principle #11: this is the difference between a documented
caveat and an enforced one.

**First implementation chunk.** `test/dev/dynamic-import-coverage.doctest.md`.
This is a `callback-box` doctest, not a `bin/` test, because it reads
`callback-box/src/`.

### Track 5 — Wire the two callers, and the full-run cadence

**What.** The agent iteration loop and `/finish` both call the selector.
`/finish` additionally decides whether *this* landing owes a full run.

**Why this needs to change.** Selection with no full-run gate is how a
regression ships. The boxholder's requirement is explicit: selected on the loop,
but a full-suite cadence is still required.

**Direction — the iteration loop.** A new script in `callback-box/package.json`:

```json
"test:changed": "node --import tsx ../bin/test-select.ts --run"
```

`--run` execs `tap` with the selected files, or plain `tap` on `FULL`. `pretest`
still runs (it builds `dist/cli.mjs`, which `alwaysRun` needs). `pnpm test`
keeps its current meaning — the full suite, unchanged — so nothing that says
"run the tests" today silently starts running fewer.

**Direction — `/finish` and the cadence.** Three candidate triggers were
weighed:

- **A counter on `main`.** Rejected. It is shared mutable state written by
  several concurrent `/finish` runs; two landings racing on it either double-run
  or skip. It also has to be committed, which puts a churning file in every
  merge.
- **Scheduled-only.** Rejected as the *sole* gate. At ~35 commits/day a nightly
  cadence leaves a full day of landings unverified by anything but selection, and
  a selection bug is precisely what a nightly cannot bound.
- **Derived from history, no state.** Adopted. At step 3 (after
  `git merge main`), the finish agent computes:

  ```
  before = git rev-list --count main
  adds   = git rev-list --count main..HEAD
  full   = floor((before + adds) / N) > floor(before / N)
  ```

  This is *crossing* detection, not `count % N == 0`, so a landing of several
  commits that steps over a multiple still triggers. It writes nothing, so
  concurrent finishes cannot race. If step 8's `--ff-only` merge is refused
  because `main` moved, the existing procedure already sends the agent back to
  step 3 (`.claude/agents/finish.md:471-473`), which recomputes both terms — so
  no crossing is ever skipped, and the finish that actually lands the boundary
  commit is the one that pays. Note the count is of *all* commits including
  merges, so N is a rough cadence, not an exact one; that is fine for a safety
  net.

  `N = 20` as the starting value: about half a day of landings at the observed
  rate, and one ~570 s full run per 20 commits is a small fraction of the
  aggregate time selection saves.

**Recommended combination, and why the rejected ones are worse.** All three of:
(a) `forceFull` on structurally-blind paths — cheap, removes most of the tail
risk, and unlike the others it is *precise* about which risk it removes;
(b) the history-derived every-N-commits full run at `/finish` — bounds how many
commits can sit on `main` behind a selection bug, with no shared state;
(c) a **nightly full recording run**, modelled on `bin/manual-tests-scheduled.sh`.
(c) is not redundant with (b): it is the map's natural producer, so the map
refreshes without any human waiting, and it catches map rot on days when every
finish was selected-only. Dropping (a) leaves the config/template/subprocess
holes open. Dropping (b) leaves a full day of blind landings. Dropping (c) makes
every map refresh a human's wait.

**Direction — the nightly.** Reuse the manual-test runner's shape: a launchd job
in the main checkout runs `CB_TEST_MAP_DIR=… pnpm test` from `main`, then
`bin/test-map build`, then hands the log to a constrained Sonnet agent with the
same authority boundary (`--allowedTools` limited to reading the repo and
editing `issues/<category>/**`) and the same `TRIAGE:` return contract. Two
outcomes are worth an issue: a test failure (as today), and a **refused map
build** — because a map that stops refreshing is a silent slide back to full
runs, and the boxholder should learn that from an issue rather than from a slow
suite.

**First implementation chunk.** The `test:changed` script and the
`bin/test-select.ts --run` mode. The `/finish` and nightly changes land after,
because they depend on the selector existing.

---

## Could this be simpler?

**The simplest version that could plausibly work: a directory heuristic, no map.**
"If every changed path is under `src/frontend/`, run only `test/frontend/**`;
otherwise run everything." No recording, no cache, no cadence coupling, nothing
to rot. This is exactly the docs-only fast path generalized one notch, and it is
the shape the origin issue already praised
(`issues/exploration/2026-08-08-run-less-of-the-test-suite.md:61-64`).

**What the map buys over it, concretely.**

1. **The heuristic is unsafe for the directories that carry the cost.** A change
   to `src/core/box/package.ts` is under `src/core/`, so a directory rule would
   select `test/core/**`. But `test/helpers/test-server.ts:24` imports
   `../../src/core/box/package.js`, so *every route doctest* depends on it —
   `test/webapp/routes/**`, the most expensive tier in the suite. The heuristic
   silently drops them. Making the heuristic safe requires knowing the inbound
   edges of every directory, which is the map. Traces to principle #4: the
   heuristic's failure is silent under-selection.
2. **The safe subset of the heuristic is nearly empty.** Only leaf directories
   with no inbound edges can be selected on, and by the same argument you cannot
   know which those are without measuring. `src/frontend/` looks safe and mostly
   is; `src/lib/`, `src/core/`, `src/schemas/`, `src/webapp/` are not. Those four
   are where changes actually land.

So the extra complexity buys the ability to select on the directories that
matter, safely. If the map ever proves unmaintainable, the fallback is not "no
selection" — it is this heuristic restricted to `src/frontend/`, which is a real
and safe subset.

**A second, more serious alternative: a static import graph.** Build one esbuild
pass over all 480 test files with `metafile: true` and read the input graph per
entrypoint. This is strictly *safer* in one dimension — static analysis
over-approximates (a module imported but never executed still counts) where
runtime recording under-approximates — and it has **no staleness at all**: it is
derived from the tree on demand, so there is no cache, no producer, no
green-run invariant, no cross-worktree sharing, and no interaction with the TSX
flake. That is a large amount of the machinery in Tracks 1, 2 and 5(c) simply
deleted.

It was not adopted, for two reasons, and the second is the decisive one:

- Doctests are markdown, so the graph needs the `.doctest.md` → TS transform.
  That part is cheap — `generateTestSource` is already exported from
  `agent-doctest/src/doctest-hooks.mjs:366` and an esbuild plugin can call it.
- **Resolution fidelity.** A static pass has to reproduce this repo's real
  resolution: tsx's NodeNext `.js` → `.ts`/`.tsx` mapping, the frontend's own
  tsconfig, and the exact edge case the loader already hand-patches
  (`doctest-hooks.mjs:28-45`: *"Under heavy parallel startup that fallback has
  intermittently stopped at the missing .ts candidate"*). A resolution
  disagreement between the selector and the runner is a silent wrong answer.
  Runtime recording cannot disagree with the runner, because it *is* the runner.

This trade is genuinely close, and the argument above is a judgement, not a
proof. It is recorded as an open design question below rather than settled here,
because if a spike shows the esbuild pass runs in a few seconds and agrees with
the runtime map file-for-file, the simpler mechanism should win.

---

## Subplans

None. The one sub-question big enough to deserve its own design step — the
per-file cost floor — is deliberately out of scope (below) and belongs in its own
issue, not a subplan, because it is independent of this plan rather than
prerequisite to it.

---

## Failure modes

> **Critical gap:** none remaining. The one that existed in the first draft —
> a test process dying early (the TSX flake) contributing a short shard that
> becomes a map entry — is closed by Track 2's condition 2, and that condition
> is itself tested.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
| --- | --- | --- | --- |
| A test process dies early (TSX flake) and records a short shard | Yes — `bin/test-map.test.ts` feeds a shard set missing an owner and asserts the build refuses | Yes — Track 2 condition 2 | Clear: the build prints which owners are missing and exits non-zero; the nightly agent files an issue |
| The map is missing (fresh machine, never recorded) | Yes — `bin/test-select.test.ts` with `map: null` | Yes — rule 1 | Clear: `test-select: FULL (no map)` |
| The map is stale (recorded 300 commits ago) | Yes — rule 2 case | Yes — rule 2 | Clear: `test-select: FULL (map is 312 commits old)` |
| A source file changed that no test imports | Yes — rule for the untested-by-import case | Yes — selects `alwaysRun` only | Clear: names the file and says why the set is small |
| A file was renamed, so map keys are wrong | Yes — rule 5 case | Yes — rule 5 | Clear: `FULL (renamed paths)` |
| A module reached only by an untaken conditional `import()` maps to no test | Yes — Track 4's coverage test | Yes — the target must be statically imported or in `forceFull` | Clear: the coverage test fails at commit time |
| `writeSync` fails mid-run (ENOSPC, EMFILE) | Yes — the hook's disable path is unit-tested with a forced throw | Yes — recording self-disables, never rethrows into `resolve` | Clear: the shard's owner is absent from the final set, so Track 2 condition 2 refuses the build |
| Two sessions run `bin/test-map build` concurrently | No test (see note) | Yes — atomic temp-file + `rename` | Silent, and acceptable: the loser's write is simply replaced by an equally valid map |
| Concurrent `/finish` runs both compute the cadence | No test | Yes — crossing detection is a pure function of `main`'s count, recomputed on any `--ff-only` refusal | Clear: the finish that lands the boundary reports "full run (cadence)" |
| The selector itself throws | Yes — the shell's catch-all | Yes — non-zero exit, callers run full | Clear: the error prints and the full suite runs |
| `alwaysRun` names a test file that was deleted | Yes — rule 6 (test-file set differs) | Yes — rule 6 forces full | Clear |
| Recording is left on for an ordinary run | N/A | The env var is set only by the nightly and the cadence run | Silent but harmless — recording writes shards nobody reduces |

Note on the concurrent-build row: two nightlies cannot overlap (one launchd job),
and a human running `build` while the nightly runs produces two maps that are both
valid for their own commit. Writing a lock for that is defensiveness against a
failure with no consequence (principle #6).

---

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **ADDRESSED (not applicable in the usual form).**
  This plan introduces no card vocabulary. The analogous mistake is an agent
  running `pnpm test:changed` when it should have run `pnpm test`. Handled by
  leaving `pnpm test` meaning exactly what it means today, so the *safe* command
  is the one already in every agent's habit and every doc.
- **Stale ref** — **ADDRESSED.** The map is the ref, staleness is its central
  problem, and rules 2, 4, 5 and 6 in Track 3 are the handling. The selector
  prints the map's age on every run.
- **Two agents touching the same thing** — **ADDRESSED.** The map is shared
  across worktrees by design (`--git-common-dir`). Writes are atomic; reads of a
  map recorded on a commit that is not an ancestor of the reader's HEAD fall to
  full (rule 2). Concurrent `/finish` cadence races are addressed in Track 5.
- **Hand-edit drift** — **ADDRESSED.** The only hand-edited artifacts are
  `bin/test-select.config.ts`'s two lists. A `forceFull` glob matching nothing,
  or an `alwaysRun` entry naming a non-existent file, is caught: the latter by
  rule 6, the former by a test in `bin/test-select.test.ts` asserting every glob
  matches at least one path in the tree.
- **Fabricated free-form value** — **ADDRESSED.** The `reason` string in
  `SelectionResult` is generated from the rule that fired, never free-form, so
  an agent cannot report a selection reason that did not happen.
- **Validation error UX** — **ADDRESSED.** Every fallback prints one line
  beginning `test-select: FULL (` and the reason. That is the whole output
  budget, per the noisy-output rule.
- **Partial migration / transition state** — **ADDRESSED.** There is no
  transition: until a map exists, every call falls open to the full suite, which
  is today's behavior. The system's "not yet installed" state and its "broken"
  state are the same state, and it is the safe one.

---

## NOT in scope

- **The per-file cost floor.** Sized here, deliberately deferred. Every one of
  the 480 files pays Node boot + tsx + the loader, and the 37 files calling
  `makeTestServer()` additionally pay a 1,023 ms cold template-box build. The
  fastest observed file is 0.828 s (`test/core/external-url-fetch.doctest.md`),
  which is close to pure floor; at ~0.9 s × 480 that is roughly 430 file-seconds
  against the measured 3,374.8 aggregate — call it 12–13%, on the same
  loaded-machine caveat as every other number here. It is a real second lever, it
  helps the *full* suite too, and it carries no correctness risk — which is
  exactly why it should not be entangled with a correctness-sensitive selector.
  File it as its own `issues/code-quality/` item.
- **Selecting within the root `bin/` suite.** 2.60 s total. Not worth a decision.
- **Changing `jobs: 6` or `timeout: 300`.** The research explicitly does not
  revalidate them.
- **Fixing the TSX resolution flake.** This plan makes the flake *fail safe* for
  the map; it does not fix it. That stays its own issue.
- **A quiet-machine green baseline.** Owed, and this plan does not produce it.
  See "Rollout shape" — the first nightly run is the natural opportunity, and no
  speedup percentage should be claimed until it exists.
- **Coverage-based selection.** Rejected upstream of this plan by the boxholder;
  the origin issue records why (real overhead, under-attributes subprocesses).
- **Selection for `personal-vibe-check`, `canvas-loop`, `callback-clerk`,
  `ios-app`.** Their suites are small or absent; `/finish`'s per-path map already
  runs them only when touched.

---

## Open design questions

- **Static graph versus runtime recording.** Argued at length under "Could this
  be simpler?". My lean is runtime, on resolution-fidelity grounds. The cheap way
  to settle it: before Track 1, spend one session building the esbuild metafile
  pass and comparing its per-test input set against a runtime shard for twenty
  diverse test files. If they agree and the pass runs in a few seconds, adopt the
  static graph and delete Tracks 1, 2 and most of 5(c). If they disagree
  anywhere, the disagreement is the answer. **This spike should run before Track
  1 is implemented**, because it can delete two tracks.
- **`N = 20` for the cadence.** A starting value, not a derived one. It should be
  revisited once there is a real distribution of selection sizes (see Rollout).
- **Staleness bounds.** Proposed: full run if the map is more than 200 commits or
  7 days old. Both are guesses; the nightly should keep the map far inside them,
  so the bounds are a backstop for "the nightly stopped working" rather than a
  tuned parameter. If the nightly is reliable, tighter bounds cost nothing.
- **Whether `alwaysRun` should include a sample of route doctests.** The
  subprocess set is the known blind spot, but "known" rests on this plan's
  enumeration being complete. A cheap hedge is to add two or three of the
  heaviest route files unconditionally. My lean is no — it is unfocused
  defensiveness (principle #6), and Track 4's enforcement test is the focused
  version of the same worry. Worth a second opinion.

---

## Knowledge audits

**Skip, with rationale.** Knowledge audits verify what a *box* agent absorbed
from box-facing context (`callback-box/docs/knowledge-audits.md`). Everything in
this plan is dev-repo infrastructure: `bin/`, `agent-doctest/`, `.claude/`. Box
agents never see it, and an audit could not test it. The corresponding
"did the agent absorb this" surface here is `.claude/agents/finish.md` and
`callback-box/docs/testing.md`, which this plan updates directly.

---

## Implementation order

0. **Spike:** static-graph comparison (see Open design questions). Go/no-go on
   the whole recording half of the plan. One session, no commits to keep.
1. **Track 1** — recording in `agent-doctest`, plus its fixture doctest.
2. **Track 2** — `bin/test-map` build/status with the four refusal conditions and
   their tests. Depends on 1 for real shards; testable against synthetic shards
   first.
3. **Track 4** — the dynamic-import coverage test. Independent of 1–3 and
   deliberately early: it is the enforcement that makes Track 1's known weakness
   safe, so it should exist before anything relies on the map.
4. **Track 3** — `bin/test-select` and its config. Depends on 2's map schema.
5. **First real recording run** — a full `pnpm test` with `CB_TEST_MAP_DIR` set,
   on a quiet machine. This doubles as the owed green baseline.
6. **Track 5a** — `pnpm test:changed`, the agent iteration loop. Usable as soon
   as 4 and 5 are done.
7. **Track 5b** — `/finish` step 4 change plus the cadence arithmetic, and the
   `docs/testing.md` update.
8. **Track 5c** — the nightly launchd job and its triage agent.

---

## Rollout shape

**Test posture.** Every track above names its tests inline; they are design
tools, not coverage. The plan's done-when is the following assertions passing:

- `bin/test-select.test.ts` — one case per numbered fail-open rule, one for the
  untested-by-import case, one asserting every `forceFull` glob matches
  something real, and one asserting that an internal throw exits non-zero.
- `bin/test-map.test.ts` — one case per refusal condition, and one asserting the
  written map round-trips.
- `agent-doctest`'s recording doctest — a fixture test file records its owner and
  its imports; a forced `writeSync` failure disables recording without throwing.
- `test/dev/dynamic-import-coverage.doctest.md` — passes on the current tree, and
  fails when a new literal-specifier dynamic import is added without coverage.

**The measurement the plan owes.** Step 5 produces the first green full run on a
quiet machine — the baseline the research section explicitly says is missing.
Immediately after, replay `bin/test-select` against the last 50 real commits on
`main` and record the distribution of selection sizes (how many of the 480 files
each would have run, and how many fell open to full). Report it as *files
skipped*, never as a speedup percentage, until there is a green baseline to
divide by. That distribution is also what should retune `N`.

**Migration.** No data shape changes. The map is a cache; deleting it is always
safe and always correct.

**Docs that land with it.** `callback-box/docs/testing.md` gains a short section
on when to use `test:changed` versus `test`, and `.claude/agents/finish.md`
gains the cadence rule in step 4. Both are agent-facing and both are the reason
the knowledge-audit section above is skipped rather than empty.
