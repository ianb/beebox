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

**Reviewed.** [Cross-model review](change-based-test-selection.review.md) (Codex,
2026-08-08) raised nine findings; all nine were accepted. Two changed the design
rather than the prose: the rewired-graph selection term in Track 3, and replacing
the commit-count cadence with one derived from the map's own age. The review file
records each finding verbatim with its disposition.

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
- **#11 — Enforcement beats convention.** The three non-import blind spots
  (below) are closed by tests that fail, not by notes in a doc.
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
  it runs **first** in the resolve chain and sees every **ESM** specifier the
  test process resolves, at any depth. It does not see `require()` resolved via
  `module.createRequire()` — async `register` hooks do not intercept those. Track
  1 states the bound; Track 4b enforces it. **Reused**, not rebuilt: recording is
  an addition to this hook, not a new mechanism.
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
  (`bin/manual-tests-scheduled.sh:49-57` and `:59-96`). **Reused as the model** for the
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

Presented in dependency order — recording produces the map, the map feeds the
selector, the selector feeds the two callers, and the map's age gates the
callers. Note that the *implementation* order (below) leads with Track 4, which
is independent of all of them.

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
  } catch (e) {
    // Fail CLOSED, deliberately. A half-written shard is indistinguishable
    // from a complete one, so a recording failure must kill the run rather
    // than quietly produce a short shard. Safe because recording is only ever
    // on during a full recording run, where aborting means "no map refresh
    // tonight" — the outcome we want. Ordinary runs never reach this code.
    console.error(`doctest import recording failed; aborting: ${e}`);
    process.exit(1);
  }
}
```

The fail-closed choice here is the correction from the cross-model review
(`change-based-test-selection.review.md`, finding 4): the first draft set a
`recordingDisabled` flag and expected the reducer to notice, but a write failure
*after* the owner line was already written leaves a shard that looks complete.
There is no durable "I gave up" signal available to a process whose writes are
failing, so the process must not survive.

and in `resolve`, after the existing branches:

```js
const resolved = await nextResolve(specifier, context);
recordResolved(resolved.url);
return resolved;
```

The two existing short-circuit branches (`.doctest.md`, the TSX fallback) also
call `recordResolved` on their return value.

**Attribution.** The first repo-relative `.doctest.md` or `.test.ts` URL a
process resolves is that process's *owner* — tap spawns one child process per
test file (`node_modules/@tapjs/run/dist/esm/execute-test-suite.js:101-112` and
`run.js:145-160`, confirmed for tap v21 during the cross-model review).
Everything the process resolves afterwards is a dependency of the owner. A test
file that imports another test file records the second one as a dependency,
which is the correct edge.

**What this hook does and does not see.** It sees every ESM specifier the test
process resolves, at any depth, including dynamic `import()` — that is the whole
mechanism. It does **not** see `require()` resolved through
`module.createRequire()`, which async `module.register` hooks do not intercept.
The repo has such call sites (`test/helpers/test-server.ts:22`,
`src/webapp/views/node-view-runtime.ts:81`), and the ones checked resolve
*packages* rather than repo source — so the gap is currently empty, not
theoretically absent. Track 4 turns that from an observation into an enforced
rule. Node's synchronous `module.registerHooks()` covers `require` and would
close the gap structurally; the spike (step 0) should evaluate it.

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

1. the run exited 0 — which, given Track 1's fail-closed abort, is also what
   catches a shard truncated by a write failure;
2. the set of owner files across all shards equals the set of test files tap
   discovered (`tap --list` or the same glob as `.taprc`'s `include`/`exclude`);
3. the working tree was clean at the recorded commit.

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
  "sourceInventory": ["src/core/box/package.ts", "..."], // `git ls-files` at recordedAtCommit
  "sources": { "src/core/box/package.ts": ["test/core/box.doctest.md", "..."] }
}
```

`sourceInventory` is **every tracked file in the repo at `recordedAtCommit`** —
`git ls-files`, not "files the loader saw". The distinction is load-bearing and
the first draft got it wrong (review finding 5): if the inventory were the
loader's view, then every file no test imports would be *absent* from it, rule 4
below would fire on it, and the plan's main win — cheap selection for the
frontend, most of which no doctest imports — would evaporate. Defining it from
`git ls-files` is what makes "in the repo but imported by no test" a state the
selector can name and act on, distinct from "the map has never heard of this
path".

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

**The rewired-graph rule — the one the first draft missed.** Rules 1–7 all treat
the map's *keys* as the thing that can go stale. Its *edges* go stale too, and
that is the more dangerous case (review finding 1). Concretely: commit A adds
`import "../../src/foo.js"` to an existing test; the map is not refreshed;
commit B changes only `src/foo.ts`. Every rule above passes — no new file, no
rename, no test added — and the map still says no test imports `src/foo.ts`. The
test that would have caught the regression is skipped.

The fix is a third selection term. Let `D` be every file changed between
`map.recordedAtCommit` and the working tree. The selected set is:

```
selected = alwaysRun
         ∪ { tests the map maps the changed files to }        // the base case
         ∪ { test files in D }                                // their own imports may have moved
         ∪ { tests the map says import anything in D }        // an edge below them may have moved
```

Why that closes it: suppose test `T` imports `S` at HEAD but did not at record
time. Some edge on the path `T → … → S` was added, so the file that owns that
edge is in `D`. If that file is `T`, the third term runs it. Otherwise take the
shortest unchanged prefix `T → … → F` where `F ∈ D`; the old map records that
prefix, so the fourth term runs `T`. Induction terminates at `T`. Any newly
reachable module is therefore covered by a test the selector already runs.

The cost of the fourth term is proportional to how stale the map is, which is
the right incentive: a map refreshed nightly makes it "every test touching one
day of changes", and a map a week old makes selection converge toward the full
suite on its own, before any staleness bound fires. Traces to principle #4 —
degradation is gradual and visible in the printed file count, not a cliff.

**The genuinely interesting case — a changed source file that is in
`sourceInventory` but in no test's import list.** This is untested-by-import
code. Running the whole suite for it is not just wasteful, it is wasteful in the
most common case there is: most of `src/frontend/src/components/` is imported by
no doctest, and a component tweak is a frequent change. Since no test imports it,
no test can observe it *through an import* — the only ways it can break a test
are the non-import channels this plan enumerates below. So the rule is: select
`alwaysRun` (the non-import-coupled set) and nothing else, and **say so**:

```
test-select: 7 files (src/frontend/src/components/Composer.tsx is imported by no test — running the blind-spot set only)
```

That line is the rot detector. A file that should be tested and is not shows up
in the agent's terminal the moment someone edits it, on every edit, forever.

**This rule is the plan's one deliberate act of trust, and it should be read as
such.** It is safe exactly to the degree that the non-import coupling audit
(`forceFull` plus `alwaysRun` plus Track 4's enforcement) is complete. That is an
argued position, not a proof — see the open question below for the conservative
fallback if it proves optimistic.

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

Solo cost of that set is roughly 55 s by the research table's solo/loaded
ratios — the standing price of every selected run. That price is what buys
coverage of the subprocess blind spot, and it is worth naming as a cost rather
than discovering it later.

**This table is a starting point, not the authority.** The review found the
hand-built list too narrow (finding 7), and a direct count agrees: **11**
`.doctest.md` files under `callback-box/test/` call `spawn`/`execFile`/`fork`,
not the 5 a `dist/cli|bin/cb` grep finds. Some of the other six spawn a Node
child that imports repo source directly — `test/webapp/auth-capabilities.doctest.md:33-38`
spawns `node --import tsx --eval` importing `src/webapp/auth-capabilities.ts` —
which the parent process's own import happens to cover today, but only by
coincidence. So the list is **generated and enforced**, not maintained by hand:
Track 4's test enumerates every spawning test file and requires each to be in
`alwaysRun` or to demonstrably import in the parent everything its child
imports. A hand list that drifts is the failure mode this whole plan exists to
avoid.

**First implementation chunk.** `bin/test-select.ts` (pure `selectTests` +
shell), `bin/test-select.config.ts`, `bin/test-select.test.ts` covering every
numbered rule above plus the untested-by-import case. No open questions inside it.

### Track 4 — Close the non-import blind spots with tests, not notes

**What.** Three enforcement tests, each turning one of this plan's stated
assumptions into a build failure when it stops being true.

**Why this needs to change.** Runtime recording under-approximates in three
structural ways, and all three are silent: a module reached only through an
untaken conditional `import()`; a module reached only through
`require()`/`createRequire()`, which async loader hooks do not intercept; and a
module loaded only inside a spawned child process. Each produces a source file
that maps to no test, so changing it selects nothing.

**4a — dynamic `import()` coverage.** The surface is small and enumerable —
eight dynamic imports in `src/`, of which the ones with repo-local targets are:

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
decides.

**4b — `createRequire` coverage.** Same shape, over `createRequire(...)`/
`require(...)` call sites in `src/` and `test/`. Each literal specifier must
resolve to a package, not to repo source. The two current call sites
(`test/helpers/test-server.ts:22`, `src/webapp/views/node-view-runtime.ts:81`)
both resolve packages, so the test passes today; it exists to fail the day
someone `require`s a repo module and silently drops it out of every map.

**4c — child-process coverage.** Over the 11 `.doctest.md` files that spawn a
child: each must either appear in `alwaysRun`, or the modules its child imports
must also be imported by the parent process (which the map does see). This is
what generates and polices the `alwaysRun` table above.

All three trace to principle #11: the difference between a documented caveat and
an enforced one. They are also the reason the plan can honestly claim a bounded
blind spot rather than an unbounded one.

**First implementation chunk.** `test/dev/import-coverage.doctest.md` carrying
all three. It is a `callback-box` doctest, not a `bin/` test, because it reads
`callback-box/src/` and `callback-box/test/`.

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

`--run` execs `tap` with the selected files, or plain `tap` on `FULL`. A sibling
`"pretest:changed": "node scripts/build-cli.mjs"` is required — npm lifecycle
hooks are per script *name*, so `pretest` fires for `test` and not for
`test:changed` (review finding 6). Without it the selected path can exercise a
stale `dist/cli.mjs`, which is exactly where `alwaysRun` is supposed to be
covering the subprocess blind spot. `pnpm test` keeps its current meaning — the
full suite, unchanged — so nothing that says "run the tests" today silently
starts running fewer.

**Direction — `/finish` and the cadence.** Three candidate triggers were
weighed:

- **A counter on `main`.** Rejected. It is shared mutable state written by
  several concurrent `/finish` runs; two landings racing on it either double-run
  or skip. It also has to be committed, which puts a churning file in every
  merge.
- **Scheduled-only.** Rejected as the *sole* gate. At ~35 commits/day a nightly
  cadence leaves a full day of landings unverified by anything but selection, and
  a selection bug is precisely what a nightly cannot bound.
- **A commit-count multiple.** Rejected — this was the first draft's adopted
  answer and the review broke it (finding 2). The scheme computed
  `floor((before+adds)/N) > floor(before/N)` at `/finish` step 3. But a
  **docs-only** finish skips the whole verification tier
  (`.claude/agents/finish.md:58-89`), so it *cannot* run a full suite — while its
  commits still advance `main`'s count. A docs-only landing that steps over a
  multiple consumes the boundary and no full run happens; the next code landing
  sees a count already past it and defers to the next multiple. The cadence
  silently stretches to 2N precisely when docs land, which is often.
- **Derived from the map's own age.** **Adopted.** At `/finish` step 3, after
  `git merge main`:

  ```
  debt = git rev-list --count <map.recordedAtCommit>..main
  full = debt >= N        # and always full when there is no map at all
  ```

  Three properties fall out of using the map as the clock:

  1. **A docs-only landing cannot consume a boundary.** It refreshes no map, so
     the debt it leaves is still owed, and the next landing that *can* run tests
     is the one that pays it.
  2. **It is not shared mutable state on `main`.** The map is a gitignored
     cache. Two concurrent finishes that both see `debt >= N` both run full and
     both refresh — wasteful once, never unsafe, and no merge-order race.
  3. **It unifies the cadence with map freshness**, which is the same quantity
     the rewired-graph rule in Track 3 already depends on. One number to reason
     about instead of two, and running the full suite is exactly the act that
     pays down both debts at once.

  `N = 20` as the starting value: about half a day of landings at the observed
  rate, and one ~570 s full run per 20 commits is a small fraction of the
  aggregate time selection saves. The count is of all commits including merges,
  so N is a rough cadence, not an exact one — fine for a safety net.

  A full run at `/finish` writes the map (Track 2's conditions still gate the
  write), so a green cadence run leaves the next landing with zero debt.

**Recommended combination, and why the rejected ones are worse.** All three of:
(a) `forceFull` on structurally-blind paths — cheap, removes most of the tail
risk, and unlike the others it is *precise* about which risk it removes;
(b) the map-age-derived full run at `/finish` — bounds how many commits can sit
on `main` behind a selection bug, with no shared state and no docs-only leak;
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
proof. **The cross-model review pushed on it and moved the balance toward the
static graph, not away from it** (review finding 8): findings 1–4 were all
fidelity failures in the *runtime* design — a rewired graph the cache cannot
see, a cadence that leaks, `require()` the hooks do not intercept, an
unimplementable completeness signal. Each has a fix in this revision, but their
existence is the point: the runtime path has at least as much fidelity risk as
the resolution risk it accuses the static path of. So the spike below is a
**gate**, not a prelude — the plan does not assume its own answer.

---

## Subplans

None. The one sub-question big enough to deserve its own design step — the
per-file cost floor — is deliberately out of scope (below) and belongs in its own
issue, not a subplan, because it is independent of this plan rather than
prerequisite to it.

---

## Failure modes

> **Critical gap (accepted, documented):** a changed source file that the map
> says no test imports selects only `alwaysRun`. If a non-import coupling
> channel exists that this plan did not enumerate, the regression it causes
> ships silently. Track 4's three enforcement tests bound the channels the plan
> *did* find; they cannot prove the enumeration is complete. This is the one
> place the design trusts an argument rather than a mechanism, and it is the
> reason the open question below names a conservative fallback.
>
> The first draft's other critical gap — a test process dying early (the TSX
> flake) contributing a short shard that becomes a map entry — is closed by
> Track 2's condition 2, and that condition is itself tested.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
| --- | --- | --- | --- |
| A test process dies early (TSX flake) and records a short shard | Yes — `bin/test-map.test.ts` feeds a shard set missing an owner and asserts the build refuses | Yes — Track 2 condition 2 | Clear: the build prints which owners are missing and exits non-zero; the nightly agent files an issue |
| **A test gained an import after recording; only the imported source then changes** | Yes — `bin/test-select.test.ts` replays exactly this two-commit sequence | Yes — Track 3's rewired-graph rule (terms 3 and 4) | Clear: the extra files appear in the printed count, attributed to map age |
| The map is missing (fresh machine, never recorded) | Yes — `bin/test-select.test.ts` with `map: null` | Yes — rule 1 | Clear: `test-select: FULL (no map)` |
| The map is stale (recorded 300 commits ago) | Yes — rule 2 case | Yes — rule 2, and the rewired-graph rule degrades toward full before it | Clear: `test-select: FULL (map is 312 commits old)` |
| A source file changed that no test imports | Yes — the untested-by-import case | Partly — selects `alwaysRun` only; see the critical gap above | Clear: names the file and says why the set is small |
| A file was renamed, so map keys are wrong | Yes — rule 5 case | Yes — rule 5 | Clear: `FULL (renamed paths)` |
| A module reached only by an untaken conditional `import()` maps to no test | Yes — Track 4a | Yes — the target must be statically imported or in `forceFull` | Clear: the coverage test fails at commit time |
| A module reached only through `createRequire()` maps to no test | Yes — Track 4b | Yes — literal specifiers must resolve to packages, not repo source | Clear: the coverage test fails at commit time |
| A module loaded only inside a spawned child maps to no test | Yes — Track 4c | Yes — the spawning test must be in `alwaysRun` or import the same modules in-parent | Clear: the coverage test fails at commit time |
| `writeSync` fails mid-run (ENOSPC, EMFILE) | Yes — the hook's abort path is tested with a forced throw | Yes — the process aborts non-zero (fail-closed) | Clear: the run exits non-zero, so Track 2 condition 1 refuses the build |
| Two sessions run `bin/test-map build` concurrently | No test (see note) | Yes — atomic temp-file + `rename` | Silent, and acceptable: the loser's write is simply replaced by an equally valid map |
| Concurrent `/finish` runs both see cadence debt | No test | Yes — both run full and both refresh; the map is a cache, not a claimed lock | Silent, and acceptable: one redundant full run, never a skipped one |
| A docs-only `/finish` lands while cadence debt is owed | Yes — the cadence is a pure function of `map.recordedAtCommit`, unit-tested | Yes — a docs-only landing refreshes no map, so the debt survives it | Clear: the next test-running finish reports "full run (cadence: N commits since map)" |
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
  problem, and rules 2, 4, 5 and 6 plus the rewired-graph rule in Track 3 are the
  handling. The selector prints the map's age on every run. Stale *keys* and
  stale *edges* are different failures and get different rules; conflating them
  was the first draft's main defect.
- **Two agents touching the same thing** — **ADDRESSED.** The map is shared
  across worktrees by design (`--git-common-dir`). Writes are atomic; reads of a
  map recorded on a commit that is not an ancestor of the reader's HEAD fall to
  full (rule 2). Concurrent `/finish` runs can each decide independently that
  cadence debt is owed; both then run full, which costs a redundant run and can
  never skip one.
- **Hand-edit drift** — **ADDRESSED.** The only hand-edited artifacts are
  `bin/test-select.config.ts`'s two lists. A `forceFull` glob matching nothing,
  or an `alwaysRun` entry naming a non-existent file, is caught: the latter by
  rule 6, the former by a test in `bin/test-select.test.ts` asserting every glob
  matches at least one path in the tree. `alwaysRun` drifting *short* — the
  failure the review actually found — is caught by Track 4c, which derives the
  spawning-test set from the tree rather than trusting the list.
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

- **Static graph versus runtime recording — the gate, not a preference.** Argued
  under "Could this be simpler?". Settle it before Track 1: build the esbuild
  metafile pass and compare its per-test input set against a runtime shard for
  twenty diverse test files, including at least three frontend `.tsx` files and
  two route doctests. Three outcomes: they agree and the pass runs in a few
  seconds → **adopt the static graph and delete Tracks 1, 2 and most of 5(c)**;
  they disagree → the disagreement names which mechanism is wrong, and is the
  answer; the pass is slow (tens of seconds) → runtime wins on cost. The spike
  should also evaluate Node's synchronous `module.registerHooks()`, which would
  close the `require()` gap in the runtime design and change the comparison.
  This is a **gate**: no Track 1 code until it resolves.
- **Whether the untested-by-import rule is too trusting.** This is the plan's one
  accepted critical gap (see Failure modes). The conservative fallback, if it
  proves optimistic in practice: an unimported changed source file also runs the
  test directory that mirrors its source directory (`test/` mirrors `src/` per
  `callback-box/CLAUDE.md`'s source-layout table). That is a heuristic and this
  plan is otherwise heuristic-free, which is why it is not the default — but it
  is cheap, and one real missed regression should be enough to adopt it. My lean
  is to ship without it and instrument: the selector already prints the file that
  triggered the rule, so the evidence accumulates in agent transcripts.
- **`N = 20` for the cadence.** A starting value, not a derived one. It should be
  revisited once there is a real distribution of selection sizes (see Rollout).
- **Staleness bounds.** Proposed: full run if the map is more than 200 commits or
  7 days old. Both are guesses; the nightly should keep the map far inside them,
  so the bounds are a backstop for "the nightly stopped working" rather than a
  tuned parameter. Note the rewired-graph rule already degrades selection toward
  the full suite as the map ages, so these bounds are a second line, not the
  first.
- **Whether `alwaysRun` should include a sample of route doctests.** A cheap
  hedge against an incomplete blind-spot enumeration: add two or three of the
  heaviest route files unconditionally. My lean is no — it is unfocused
  defensiveness (principle #6) and Track 4c is the focused version of the same
  worry — but the review's finding 7 (the hand list was in fact too narrow by
  6 of 11 files) is evidence that my enumeration instinct here was not reliable.
  Worth the boxholder's call rather than mine.

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

0. **Spike (GATE):** static-graph comparison, plus a `registerHooks()`
   evaluation. Go/no-go on the whole recording half of the plan. One session, no
   commits to keep. Nothing below starts until this resolves.
1. **Track 4** — the three coverage tests. Deliberately first, ahead of the
   mechanism they protect: they are cheap, they are independent of which
   mechanism the spike picks, and they generate the `alwaysRun` list that Track 3
   needs. Landing them first also means the blind-spot enumeration is enforced
   before anything depends on it being right.
2. **Track 1** — recording in `agent-doctest`, plus its fixture doctest.
   (Deleted if the spike picks the static graph; replaced by the esbuild pass.)
3. **Track 2** — `bin/test-map` build/status with the three refusal conditions
   and their tests. Depends on 2 for real shards; testable against synthetic
   shards first.
4. **Track 3** — `bin/test-select` and its config, including the rewired-graph
   rule. Depends on 3's map schema and 1's generated `alwaysRun`.
5. **First real recording run** — a full `pnpm test` with `CB_TEST_MAP_DIR` set,
   on a quiet machine. This doubles as the owed green baseline.
6. **Track 5a** — `pnpm test:changed` and `pretest:changed`, the agent iteration
   loop. Usable as soon as 4 and 5 are done.
7. **Track 5b** — `/finish` step 4 change plus the map-age cadence rule, and the
   `docs/testing.md` update.
8. **Track 5c** — the nightly launchd job and its triage agent.

---

## Rollout shape

**Test posture.** Every track above names its tests inline; they are design
tools, not coverage. The plan's done-when is the following assertions passing:

- `bin/test-select.test.ts` — one case per numbered fail-open rule; the
  rewired-graph case (a test gains an import, then only the imported source
  changes, and the selector still runs that test); the untested-by-import case;
  one asserting every `forceFull` glob matches something real; one asserting an
  internal throw exits non-zero; and one asserting the map-age cadence is a pure
  function of `recordedAtCommit` (so a docs-only landing cannot consume it).
- `bin/test-map.test.ts` — one case per refusal condition, and one asserting the
  written map round-trips.
- `agent-doctest`'s recording doctest — a fixture test file records its owner and
  its imports; a forced `writeSync` failure aborts the process non-zero rather
  than producing a short shard.
- `test/dev/import-coverage.doctest.md` — 4a/4b/4c all pass on the current tree,
  and each fails when its assumption is violated (a new literal-specifier dynamic
  import, a `require` of repo source, a new spawning test file).

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
gains the map-age cadence rule in step 4. Both are agent-facing and both are the reason
the knowledge-audit section above is skipped rather than empty.
