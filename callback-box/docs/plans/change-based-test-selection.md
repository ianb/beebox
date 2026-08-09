**Status:** proposed 2026-08

# Change-based test selection from a derived import graph

Run only the test files a change can plausibly break, instead of the whole
`callback-box` suite, on every agent iteration in a worktree and at every
`/finish`. The selector derives the test→source import graph from the working
tree on demand with esbuild, intersects it with the worktree's diff against
`main`, and falls back to the full suite whenever anything is unknown or
ambiguous.

**Issues addressed**

- `issues/exploration/2026-08-08-run-less-of-the-test-suite.md` — the origin
  item. Its `## Research (2026-08-08)` section is the profiling baseline this
  plan builds on; the plan does not re-derive it.
- `issues/bugs/2026-08-05-doctest-loader-tsx-resolution-flake-recurred.md` — not
  resolved here, but the plan's first draft instrumented the flaky `resolve`
  hook, and dropping that instrumentation is one reason the current mechanism is
  preferred. The interaction is recorded rather than inherited.

**Revision history.** The first draft recorded the graph empirically — a runtime
import map written by the doctest loader during full runs, cached across
worktrees. A [cross-model review](change-based-test-selection.review.md) raised
nine findings, four of them fidelity failures in that recording design, and the
boxholder then flipped the mechanism to the derived graph (2026-08-08). The
review file is kept because its findings shaped the fail-open rules that
survived the flip, and because the runtime alternative is argued against below
using them. The briefing that started this work specified runtime recording;
that decision was reversed deliberately, not overlooked.

Checked and not addressed: `issues/bugs/2026-07-29-flaky-login-redirect-doctest.md`
(a different flake; selection reduces parallel load, which may reduce its
frequency, but this plan claims no fix) and
`issues/docs-and-chores/2026-08-08-maintenance-cadence-framework.md` (this plan
adds one scheduled job that should later fold into that framework; it does not
build the framework).

---

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` **#4 — "Resilient AND never
  silent"**. The central risk is a selector that quietly runs too few tests.
  Every fallback must be loud, and no failure may degrade into "ran fewer tests"
  without saying so.
- **#6 — Right-sized defensiveness**, and the boxholder's
  `stop-over-engineering-rare-failures` guidance. Bounds the above: no machinery
  for failures that cannot occur on the real path. This is the principle that
  most of the first draft violated.
- **#10 — Testability is architectural.** The selection decision is pure logic
  over a graph and a file list; the plan keeps it separable from the git and
  esbuild I/O so it can be doctested exhaustively.
- **#11 — Enforcement beats convention.** The three non-import blind spots are
  closed by tests that fail, not by notes in a doc.
- **#12 — The maintainer is usually an agent.** The selector's output is read by
  agents mid-iteration. One line, no flag required, always saying what it chose
  and why.
- `CLAUDE.md`: "Treat noisy command output as a bug" — this runs on every
  iteration; its output budget is one line.
- Precedent: `/finish`'s docs-only fast path (`.claude/agents/finish.md:73-74`)
  — *"It's docs-only **iff** every changed path sits under a `docs/` directory
  AND none is a `.doctest.md`."* This plan generalizes that shape: path-precise,
  conservative, and it names its carve-outs.

---

## What already exists

- **The markdown→TS transform is already a shared, exported function.**
  `generateTestSource(markdown, filePath)` at
  `agent-doctest/src/doctest-hooks.mjs:366`, published as the `agent-doctest/hooks`
  subpath export (`agent-doctest/package.json:10`). **Reused, not rebuilt** —
  and this is the plan's central fidelity claim: the static pass does not
  reimplement how a doctest becomes code, it calls the same function the runner
  calls. Only module *resolution* is reimplemented, and the next two bullets
  bound that surface.
- **The resolution surface a static pass must reproduce is one alias.** Doctests
  run under the root tsconfig, whose `paths` is exactly
  `"@shared/*": ["./src/shared/*"]` (`callback-box/tsconfig.json:37-39`). The
  frontend's other four aliases are deliberately unresolvable in that program —
  `tsconfig.json:34-36`: *"@backend/@core/@schemas stay unresolvable on purpose
  — a frontend module reaching for those in a doctest is a boundary violation,
  not a config gap."*
- **The directory-index ambiguity that would make static resolution risky does
  not exist in this tree.** Counted: 20 `index.ts` and 1 `index.tsx` under
  `callback-box/src/`, and **no directory contains both**. The resolution the
  loader hand-patches (`doctest-hooks.mjs:28-45`, the `.js` → `.tsx` fallback
  that *"has intermittently stopped at the missing .ts candidate"*) has exactly
  one correct answer per specifier here, not a judgement call.
- **esbuild is already a dependency and already drives a build step.**
  `callback-box/scripts/build-cli.mjs` bundles the CLI with
  `packages: "external"` (`:32`) for the same reason this plan needs it —
  node_modules stay out of the graph. esbuild 0.25.12 is installed. **Reused**:
  the graph pass is the same tool with `metafile: true` and `write: false`.
- **`/finish` already computes this exact diff.** `.claude/agents/finish.md:69-70`
  runs `git diff --name-only main...HEAD` plus `git status --porcelain` to
  classify its docs-only fast path. **Reused verbatim** as the selector's input.
- **`/finish` already has a per-path verification map**
  (`.claude/agents/finish.md:184-196`). **Reused**: the selector plugs into the
  `callback-box/` row only. The root suite (19 `bin/*.test.ts`, 2.60 s) is never
  selected — it is cheaper to run than to reason about.
- **`bin/manual-tests-scheduled.sh`** is a complete, working "launchd →
  constrained triage agent → files an issue → macOS notification" pattern
  (`snapshot_open_issues` at `:49-57`, `validate_triage_result` at `:59-96`).
  **Reused as the model** for the nightly full run; not rebuilt.
- **No existing changed-file utility.** Root `package.json` has
  `path-leak-check`, `commit-blocklist-check`, `mobile-contract-check` — all
  `node --import tsx bin/*.ts` with sibling `bin/*.test.ts`. The selector follows
  that shape; nothing to reuse beyond the convention.

---

## Prior art (external)

- **Jest `--changedSince` and Vitest `--changed`** are exactly this mechanism:
  derive the static import graph from each test entrypoint, intersect with the
  changed set. This plan is the same idea with a doctest transform in front of
  it, which is reassuring — the first draft's runtime recording had no
  comparable precedent in a general-purpose runner, and that should have been a
  signal.
  https://jestjs.io/docs/cli#--changedsince
- **Microsoft Test Impact Analysis (Azure DevOps)** — the named industry
  practice, and the source of the safety posture copied here: never
  selected-only forever, force a periodic full run, and treat "the graph does
  not know about this" as "run everything".
  https://learn.microsoft.com/en-us/azure/devops/pipelines/test/test-impact-analysis
- **esbuild `metafile`** documents `outputs[].inputs` as the per-output resolved
  input set, which is precisely the per-entrypoint dependency list this needs.
  The documented caveat that matters: it reflects what esbuild *resolved*, so an
  `onResolve` plugin that returns the wrong path produces a wrong graph silently
  — which is why Track 1 makes ambiguity additive rather than a choice.
  https://esbuild.github.io/api/#metafile
- **Node.js module customization hooks** — read during the first draft, and the
  source of a finding that killed it: async `register` hooks run on a separate
  loader thread and do not intercept `require()` via `module.createRequire()`.
  Still relevant here as the reason Track 3b exists.
  https://nodejs.org/api/module.html#customization-hooks
- **Searched and found nothing** for deriving an import graph from a *markdown
  doctest* corpus specifically, which is expected — the format is ours. Nothing
  found either on stateless full-run cadences; published schemes all use
  CI-server state, which this repo does not have.

---

## Tracks / scope

Ordered by implementation dependency. Track 3 is independent of all of them and
lands first (see Implementation order) because it generates a list Track 2 needs.

### Track 1 — Derive the import graph

**What.** `bin/test-graph` builds one esbuild pass over every test file and
returns, per test file, the set of repo files it transitively imports.

**Why this needs to change.** Nothing derives this today. It is the one piece of
information that makes safe selection possible, and unlike the first draft's
version it is computed from the tree rather than remembered from a past run.

**Direction.** One `esbuild.build()` call:

```
entryPoints: every test/**/*.doctest.md (minus test/manual/**) and test/**/*.test.ts
bundle: true            // required for the metafile input graph
packages: "external"    // node_modules stay out, as in build-cli.mjs
write: false            // nothing is emitted; the metafile is the product
metafile: true
platform: "node", format: "esm"
```

Two plugins carry the whole fidelity burden:

- **The doctest plugin.** `onLoad` for `.doctest.md` calls
  `generateTestSource(readFileSync(path), path)` from `agent-doctest/hooks` and
  returns it with `loader: "ts"`. Same function, same output as the runner.
- **The resolution plugin.** `onResolve` for relative specifiers ending `.js`
  tries `.ts`, `.tsx`, `/index.ts`, `/index.tsx`, plus the `@shared/*` alias.

**Ambiguity is additive, never a choice.** If more than one candidate exists,
the plugin returns one *and records every other candidate as an extra edge* that
the selector unions in. This is the property the whole plan turns on: **a
derived graph can deliberately over-approximate, and an empirical one
structurally cannot.** A recording knows only what one run executed, so every
uncertainty in it resolves toward running fewer tests — the wrong direction when
a wrong answer ships a regression instead of turning a test red.

**Unresolvable is per-test fail-open, not a global abort.** If an entrypoint has
a specifier that resolves to nothing, that test is marked `unresolved` and is
**always selected**, on every run, until someone fixes it. The build does not
fail and the other 480-odd tests still get precise selection. Deleted files fall
out of this for free: delete `src/foo.ts` and every test importing it becomes
unresolved, so every one of them runs.

**Freshness.** The graph is derived from the working tree, so it cannot be
stale. If the pass proves slow enough to want a cache, the cache key is a
content hash — `git rev-parse HEAD^{tree}` plus a hash of `git status
--porcelain -z` and the mtimes it names — so a cache hit is by construction a
graph for exactly this tree. A key miss recomputes; there is no staleness bound,
no producer, and no invariant about which runs may write it.

**First implementation chunk.** `bin/test-graph.ts` exposing
`buildGraph(): Promise<{ tests: Map<string, Set<string>>; unresolved: Set<string> }>`,
plus `bin/test-graph.test.ts` over a fixture tree asserting: a doctest's
transitive imports appear; the `.js`→`.tsx` case resolves; an ambiguous case
yields both edges; an unresolvable import marks the test rather than throwing.

### Track 2 — The selector

**What.** `bin/test-select` prints the test files to run, or the token `FULL`.

**Why this needs to change.** This is where every fail-open rule lives. It must
be one place, pure, and exhaustively tested.

**Direction.** A pure function behind a thin I/O shell (principle #10):

```ts
selectTests(input: SelectionInput): SelectionResult
// SelectionInput  = { changed: string[]; graph: TestGraph; config: SelectionConfig }
// SelectionResult = { kind: "full"; reason: string }
//                 | { kind: "selected"; tests: string[]; reason: string }
```

The selected set is:

```
alwaysRun
∪ graph.unresolved                                  // per-test fail-open
∪ { test | graph.tests[test] ∩ changed ≠ ∅ }        // the actual selection
∪ { changed test files themselves }                 // a changed test runs itself
```

**Fail-open rules — any one yields `FULL`:**

1. The graph build throws, or esbuild reports an error the resolution plugin did
   not convert into an `unresolved` mark.
2. Any changed path matches a `forceFull` glob (below).
3. Any changed source path is not tracked by git and not ignored — an untracked
   file the graph pass may not have seen.
4. The diff base cannot be determined (detached HEAD, missing `main`, a shallow
   clone).
5. Any error at all. The shell exits non-zero, and **every caller treats a
   non-zero exit as "run the full suite"**, never as "skip".

That is five rules where the first draft had seven plus a staleness bound plus a
rewired-graph term. Rules 2, 4, and 6 of the old list — map not an ancestor of
HEAD, source unknown to the recorded inventory, test-file set changed since
recording — all described ways a *cache* could disagree with the tree. There is
no cache, so they have nothing to describe.

**The one case that still needs judgement: a changed source file no test
imports.** This is untested-by-import code, and it is common — most of
`src/frontend/src/components/` is imported by no doctest. Since no test imports
it, no test can observe it through an import; the only channels left are the
non-import ones Track 3 enumerates. So it selects `alwaysRun` and nothing else,
and says so:

```
test-select: 7 files (src/frontend/src/components/Composer.tsx is imported by no test — running the blind-spot set only)
```

That line is the rot detector: a file that should be tested and is not appears in
the agent's terminal on every edit, forever. **It is also the plan's one act of
trust** — safe exactly to the degree Track 3's enumeration is complete. See the
Failure modes critical gap and the open question.

**`forceFull` — paths no import graph can see.** Committed as
`bin/test-select.config.ts`, each entry carrying its reason:

| Glob | Why the graph cannot see it |
| --- | --- |
| `callback-box/.taprc` | Run configuration; imported by nothing. |
| `callback-box/package.json`, `pnpm-lock.yaml`, root `package.json` | Dependency and script changes. |
| `callback-box/tsconfig*.json`, `callback-box/src/frontend/tsconfig*.json` | Resolution config — changing it changes the graph itself. |
| `agent-doctest/**` | The runner and `generateTestSource`, which the graph pass depends on. |
| `callback-box/templates/**` | Read from disk by path — `src/core/box/defaults.ts:49`: `path.join(PACKAGE_ROOT, "templates", "procedures")`. |
| `callback-box/test/helpers/**` | Imported, so technically in the graph — but helpers fan out to hundreds of tests, so selection would approach full anyway. Forcing it is honest and no more expensive. |
| `callback-box/test/fixtures/**`, `callback-box/test/mobile-contract/fixtures/**` | Read by path, not imported. |
| `callback-box/scripts/build-cli.mjs` | Produces `dist/cli.mjs`, which spawned tests exercise. |
| `callback-box/bin/cb` | Spawned as a subprocess (`src/core/script-env.ts:30`, `src/cli/commands/view.ts:232`). |
| `bin/test-graph.ts`, `bin/test-select*.ts` | The selector deciding its own blast radius is not a decision it should make. |

**Deliberately NOT in `forceFull`: `src/lib/`.** The briefing proposed it. The
graph covers `src/lib/` exactly and transitively — a test importing a helper
that imports `src/lib/file-lock.ts` has that file in its input set. A
`forceFull` entry there is redundant with a precise mechanism, and redundant
entries are how selection quietly degrades into always-full. `forceFull` is for
coupling the graph *structurally cannot* observe. Traces to principle #6.

**`alwaysRun` — tests whose coupling is not an import.** Generated and enforced
by Track 3c, not hand-maintained. Seeded from the built-CLI spawners
(`test/hub/hub-e2e.doctest.md`, `test/webapp/views-compiler-v2.doctest.md`,
`test/cli/commands/view-test-command.doctest.md`,
`test/cli/commands/trick.doctest.md`, `test/cli/lib/view-lint-hooks.doctest.md`
— roughly 55 s solo between them, the standing price of every selected run).
The review found this hand list too narrow and it was: **11** `.doctest.md` files
call `spawn`/`execFile`/`fork`, not 5. A list maintained by hand drifts; Track 3c
derives it.

**First implementation chunk.** `bin/test-select.ts`, `bin/test-select.config.ts`,
`bin/test-select.test.ts` covering every numbered rule, the untested-by-import
case, and the `unresolved` pass-through.

### Track 3 — Close the non-import blind spots with tests, not notes

**What.** Three enforcement tests, each turning one stated assumption into a
build failure when it stops being true.

**Why this needs to change.** The graph is blind in three structural ways, and
all three are silent: a module reached only through a computed dynamic
`import()`; a module reached only through `require()`/`createRequire()`; and a
module loaded only inside a spawned child process. Each yields a source file
mapping to no test, so changing it selects nothing.

**3a — dynamic `import()` coverage.** Eight dynamic imports exist in `src/`:

```
src/cli/bootstrap.ts:37          await import("./lib/fetch.js")        // literal — in the graph
src/cli/commands/validate.ts:342 await import("./validate-hook.js")    // literal — in the graph
src/cli/commands/view.ts:176     await import("callback-box/view-widgets")
src/cli/commands/view.ts:170     await import(mod.moduleUrl)           // computed
src/webapp/views/view-meta-import.ts:27  await import(moduleUrl)       // computed
src/schemas/registry.ts:330      await import(... + "?v=" + hash)      // computed, box-local
```

Literal specifiers are ordinary graph edges — esbuild resolves them, so this is
one place the derived graph is *better* than a recording, which would only have
seen the branches a particular run took. The test asserts every computed
specifier resolves outside the repo; if one ever points inside, it fails and a
human decides.

**3b — `createRequire` coverage.** Over `createRequire(...)`/`require(...)` call
sites in `src/` and `test/`: each literal specifier must resolve to a package,
not repo source. The two current sites (`test/helpers/test-server.ts:22`,
`src/webapp/views/node-view-runtime.ts:81`) resolve packages, so it passes today;
it exists to fail the day someone `require`s a repo module.

**3c — child-process coverage.** Over the 11 `.doctest.md` files that spawn a
child: each must be in `alwaysRun`, or the modules its child imports must also be
imported by the parent (which the graph does see).
`test/webapp/auth-capabilities.doctest.md:33-38` spawns
`node --import tsx --eval` importing `src/webapp/auth-capabilities.ts`, which the
parent also imports at `:12-20` — covered today, but by coincidence. This test
generates `alwaysRun` and fails when a new spawner appears.

All three trace to principle #11. They are also why the plan can claim a
*bounded* blind spot rather than an unbounded one.

**First implementation chunk.** `test/dev/import-coverage.doctest.md` carrying
all three. A `callback-box` doctest, not a `bin/` test, because it reads
`callback-box/src/` and `callback-box/test/`.

### Track 4 — The worktree iteration loop

**What.** Make selected testing the default way an agent runs tests inside a
worktree, with the branch's diff against `main` as the base.

**Why this needs to change.** This is where the cost actually lands. Agents run
the suite repeatedly while iterating, and a worktree's diff against `main` is
precisely "what this branch could have broken". It is also the case where the
derived graph beats a recorded one most: a worktree created ten seconds ago
selects correctly on its first run, with no cache to warm, nothing shared
between worktrees, and nothing that can be stale.

**Direction.** The default base is `main`, computed exactly as `/finish` already
does it (`.claude/agents/finish.md:69-70`):

```bash
git diff --name-only main...HEAD     # three-dot: merge-base, so a merged-in main doesn't widen it
git status --porcelain               # plus uncommitted work — the iteration loop's whole point
```

`--base <ref>` and `--since <sha>` exist for other framings, but `main` is the
default and should stay the habit.

**The property this buys, and the optimization it rejects.** The loop and the
`/finish` gate compute the *same* set, so a green iteration run predicts a green
finish — the agent is not ambushed at merge time by a file it never ran. The
tempting optimization is "test only what changed since my last green run", which
is narrower and faster; it is rejected because it needs per-session state and
drifts out of agreement with the gate, which is the exact class of bug this plan
exists to avoid. The set therefore widens as a worktree ages, which is correct:
a long-lived branch has touched more and should test more.

**Scripts.**

```json
"pretest:changed": "node scripts/build-cli.mjs",
"test:changed":    "node --import tsx ../bin/test-select.ts --run"
```

`pretest:changed` is required and not decorative: npm lifecycle hooks are per
script *name*, so `pretest` fires for `test` and not for `test:changed`. Without
it the selected path can exercise a stale `dist/cli.mjs` — exactly where
`alwaysRun` is supposed to be covering the subprocess blind spot.

**`pnpm test` keeps its current meaning** — the full suite, unchanged. Narrowing
it would silently weaken a load-bearing sentence in the finish procedure
(`.claude/agents/finish.md:27-32`: *"If `pnpm test` reports ANY failure — anywhere
in the suite, in any file, for any reason — you do not proceed and you do not
merge"*). Two commands with two clear meanings beats one command that means
something different than it used to.

**Guidance.** `callback-box/CLAUDE.md:11` (*"`pnpm test` runs tap"*) and `:17`
(*"Run tests before committing"*) become the two-command story: selected while
iterating, full at the gate. The gitignored per-worktree `AGENTS.md` mirrors
regenerate from it, so worktree sessions pick it up with no extra plumbing.

**First implementation chunk.** The two scripts, `--run`/`--base`/`--since` in
the shell, and the CLAUDE.md edit.

### Track 5 — The full-run gate

**What.** `/finish` runs the full suite when enough has landed since the last
one; a nightly job runs it unattended.

**Why this needs to change.** Selection with no full-run gate is how a regression
ships. Selected on the loop, full at a cadence, is the boxholder's stated
requirement.

**Direction — the cadence.** Four candidates were weighed:

- **A counter committed on `main`.** Rejected: shared mutable state written by
  concurrent `/finish` runs, and a file churning in every merge.
- **Scheduled-only.** Rejected as the *sole* gate. At ~35 commits/day a nightly
  leaves a full day of landings behind nothing but selection.
- **A commit-count multiple** (`floor((before+adds)/N) > floor(before/N)`).
  Rejected — this was the first draft's answer and the review broke it. A
  **docs-only** finish skips the whole verification tier
  (`.claude/agents/finish.md:58-89`) so it cannot run a full suite, while its
  commits still advance the count. A docs-only landing that steps over a
  multiple consumes the boundary silently and stretches the cadence to 2N,
  precisely when docs land — which is often.
- **Debt against a last-full-run marker.** **Adopted.** A green full run writes
  `$(git rev-parse --git-common-dir)/callback-last-full-test.json`
  (`{ commit, iso }`), and the gate is:

  ```
  debt = git rev-list --count <marker.commit>..main
  full = (no marker) || debt >= N
  ```

  `--git-common-dir` resolves to the shared git directory from inside any
  worktree, so one marker serves the main checkout and every worktree; it is
  never committed and survives worktree removal. Three properties follow:

  1. **A docs-only landing cannot consume a boundary** — it writes no marker, so
     the debt survives and the next test-running finish pays it.
  2. **Not shared mutable state in any dangerous sense.** Two concurrent finishes
     that both see debt both run full and both write — one redundant run, never a
     skipped one. Missing or corrupt marker → full. It is fail-open by
     construction, which is why a ~40-byte file is acceptable where a cached
     graph was not.
  3. **It is not correctness-critical.** Unlike the first draft's map, nothing
     about *which tests get selected* depends on it. It only paces the gate.

  `N = 20` to start: about half a day of landings, and one ~570 s full run per 20
  commits is small against what selection saves. The count includes merge
  commits, so N is a rough cadence — fine for a safety net.

**Direction — the nightly.** Reuse the manual-test runner's shape: a launchd job
in the main checkout runs `pnpm test` from `main`, writes the marker on green,
and hands the log to a constrained Sonnet agent with the same authority boundary
(`--allowedTools` limited to reading the repo and editing `issues/<category>/**`)
and the same `TRIAGE:` return contract. It files an issue on failure, as today.

**Recommended combination, and why the rejected ones are worse.** All three of:
(a) `forceFull` on structurally-blind paths — precise about which risk it
removes; (b) the marker-debt full run at `/finish` — bounds how many commits sit
on `main` behind a selection bug, with no docs-only leak; (c) the nightly — pays
the debt down without a human waiting, and catches breakage on days when every
finish was selected-only. Dropping (a) leaves the config/template/subprocess
holes open. Dropping (b) leaves a full day of blind landings. Dropping (c) makes
every full run someone's wait.

**First implementation chunk.** The marker write/read in `bin/test-select.ts`,
the `/finish` step 4 edit, then the launchd job.

---

## Could this be simpler?

**The simplest version that could plausibly work: a directory heuristic, no
graph.** "If every changed path is under `src/frontend/`, run only
`test/frontend/**`; otherwise run everything." No esbuild pass, nothing to
derive. This is the docs-only fast path generalized one notch, and the origin
issue already praised the shape
(`issues/exploration/2026-08-08-run-less-of-the-test-suite.md:61-64`).

**What the graph buys over it.**

1. **The heuristic is unsafe for the directories that carry the cost.** A change
   to `src/core/box/package.ts` sits under `src/core/`, so a directory rule
   selects `test/core/**`. But `test/helpers/test-server.ts:24` imports
   `../../src/core/box/package.js`, so *every route doctest* depends on it —
   `test/webapp/routes/**`, the most expensive tier in the suite. The heuristic
   silently drops them. Traces to principle #4: its failure is silent
   under-selection.
2. **The safe subset is nearly empty.** Only leaf directories with no inbound
   edges can be selected on, and you cannot know which those are without
   computing the edges. `src/frontend/` mostly qualifies; `src/lib/`,
   `src/core/`, `src/schemas/`, `src/webapp/` do not. Those four are where
   changes land.

So the graph buys safe selection on the directories that matter. If it ever
proves unmaintainable, the fallback is not "no selection" — it is this heuristic
restricted to `src/frontend/`, which is a real and safe subset.

**The alternative this plan was rewritten away from: empirical recording.**
Instrument the doctest loader to record, per test process, every module it
resolved; reduce the shards to a map; cache it across worktrees; refresh it on
full runs. It has one genuine advantage — it cannot disagree with the runner's
resolution, because it *is* the runner — and that advantage was the first
draft's whole argument. It does not survive contact:

- **It can only under-approximate.** A recording knows what one run executed.
  Every uncertainty resolves toward fewer tests. The derived graph resolves
  ambiguity toward *more* (Track 1). For a mechanism whose wrong answer is a
  shipped regression rather than a red test, that asymmetry decides it.
- **The fidelity it claimed to protect is small here.** One path alias, a
  mechanical `.js`→`.ts`/`.tsx` rewrite, and zero ambiguous `index.ts`/`index.tsx`
  directories — measured, above. Meanwhile the transform, the genuinely subtle
  part, is a shared function either way.
- **The cross-model review found four fidelity failures in the recording design
  itself**: a rewired graph the cache could not see; a cadence a docs-only finish
  could consume; `require()` the loader hooks do not intercept; and a
  completeness signal that could not be implemented. Each had a fix, but their
  existence is the point.
- **It costs a cache, a producer, a green-run-only write invariant, a
  cross-worktree shared path, staleness bounds, a rewired-graph selection term,
  and instrumentation inside the `resolve` hook that is the subject of an open
  flake bug.** All of that is deleted here.
- **It is worst exactly where this plan is used most.** A fresh worktree has no
  local map. Making it work at all required putting the map in the shared git
  dir, and it still falls open to full whenever that map is stale.

The one thing the derived graph might cost is wall-clock: an esbuild pass over
~484 entrypoints has an unmeasured runtime. That is the single remaining
unknown, and it is a cost question with a cache answer, not a correctness
question.

---

## Subplans

None. The one sub-question big enough to deserve its own design step — the
per-file cost floor — is out of scope (below) and belongs in its own issue: it is
independent of this plan rather than prerequisite to it.

---

## Failure modes

> **Critical gap (accepted, documented):** a changed source file that no test
> imports selects only `alwaysRun`. If a non-import coupling channel exists that
> Track 3 did not enumerate, a regression through it ships silently. The three
> enforcement tests bound the channels the plan *did* find; they cannot prove the
> enumeration is complete. This is the one place the design trusts an argument
> instead of a mechanism, and the reason the open question below names a
> conservative fallback. The review demonstrated the enumeration instinct was
> wrong once already (5 spawning tests found by hand, 11 in the tree).

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
| --- | --- | --- | --- |
| A specifier resolves to nothing (deleted file, typo, new alias) | Yes — `bin/test-graph.test.ts` fixture with a dangling import | Yes — that test is marked `unresolved` and always runs | Clear: the selector names the unresolved entrypoints in its line |
| Two resolution candidates exist for one specifier | Yes — fixture with both `.ts` and `.tsx` present | Yes — both become edges (over-approximate) | Silent by design, and safe: it can only select more |
| The esbuild pass throws | Yes — the shell's catch-all | Yes — non-zero exit, caller runs full | Clear: the error prints and the full suite runs |
| A source file changed that no test imports | Yes — the untested-by-import case | Partly — `alwaysRun` only; see the critical gap | Clear: names the file and why the set is small |
| A module reached only by a computed dynamic `import()` | Yes — Track 3a | Yes — computed specifiers must resolve outside the repo | Clear: the coverage test fails at commit time |
| A module reached only through `createRequire()` | Yes — Track 3b | Yes — literal specifiers must resolve to packages | Clear: the coverage test fails at commit time |
| A module loaded only inside a spawned child | Yes — Track 3c | Yes — the spawner must be in `alwaysRun` or import in-parent | Clear: the coverage test fails at commit time |
| An untracked new source file is edited | Yes — rule 3 case | Yes — rule 3 forces full | Clear: `FULL (untracked paths)` |
| The graph cache (if built) returns a graph for the wrong tree | Yes — key-collision case in `bin/test-graph.test.ts` | Yes — the key is a content hash of tree + working-tree status | Clear: a key miss recomputes; there is no age to be wrong about |
| A docs-only `/finish` lands while cadence debt is owed | Yes — the gate is a pure function of the marker, unit-tested | Yes — a docs-only landing writes no marker, so the debt survives | Clear: the next test-running finish reports "full run (cadence: N commits since last full)" |
| Concurrent `/finish` runs both see debt | No test | Yes — both run full and both write the marker | Silent, acceptable: one redundant full run, never a skipped one |
| The marker file is missing or corrupt | Yes — `bin/test-select.test.ts` | Yes — treated as infinite debt → full | Clear: `full run (no last-full-run marker)` |
| `alwaysRun` names a deleted test file | Yes — asserted against the entrypoint list | Yes — the graph pass has no such entrypoint, so it is reported | Clear: the selector errors → non-zero → full |

Note on the concurrent-finish row: writing a lock for a marker whose only failure
mode is one redundant test run is defensiveness against a failure with no
consequence (principle #6).

---

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **ADDRESSED (in the applicable form).** No card
  vocabulary here. The analogous mistake is an agent running `test:changed` where
  `test` was required. Handled by leaving `pnpm test` meaning exactly what it
  means today, so the *safe* command is the one already in every agent's habit
  and every doc, and the new one is the opt-in.
- **Stale ref** — **ADDRESSED, and largely dissolved.** The graph is derived from
  the tree, so there is no recorded state to go stale. What remains is the
  cadence marker, whose only staleness effect is running the full suite more
  often. This was the first draft's hardest problem and the mechanism change is
  what removed it.
- **Two agents touching the same thing** — **ADDRESSED.** Each worktree derives
  its own graph from its own tree; nothing is shared and nothing can race. The
  only shared artifact is the cadence marker, whose contended outcome is a
  redundant full run.
- **Hand-edit drift** — **ADDRESSED.** The only hand-maintained artifact is
  `forceFull`. A glob matching nothing is caught by a test asserting every glob
  matches at least one tracked path. `alwaysRun` is generated by Track 3c rather
  than hand-maintained, which is the specific drift the review caught.
- **Fabricated free-form value** — **ADDRESSED.** The `reason` string is
  generated from the rule that fired, never free-form, so an agent cannot report
  a selection reason that did not happen.
- **Validation error UX** — **ADDRESSED.** One line, beginning `test-select:`,
  always naming the rule. That is the whole output budget.
- **Partial migration / transition state** — **ADDRESSED.** There is no
  transition. Before the selector exists, and any time it errors, the behavior is
  today's behavior: run everything. Its "not installed" state and its "broken"
  state are the same state, and it is the safe one.

---

## NOT in scope

- **The per-file cost floor.** Sized, deliberately deferred. Every test file pays
  Node boot + tsx + the loader, and the 37 files calling `makeTestServer()` also
  pay a 1,023 ms cold template-box build. The fastest observed file is 0.828 s
  (`test/core/external-url-fetch.doctest.md`), close to pure floor; ~0.9 s × 480
  is roughly 430 file-seconds against the measured 3,374.8 aggregate — call it
  12–13%, on the same loaded-machine caveat as every other number here. A real
  second lever that helps the *full* suite too and carries no correctness risk —
  which is exactly why it should not be entangled with a correctness-sensitive
  selector. File it as its own `issues/code-quality/` item.
- **Selecting within the root `bin/` suite.** 2.60 s total.
- **Changing `jobs: 6` or `timeout: 300`.** The research explicitly does not
  revalidate them.
- **Fixing the TSX resolution flake.** The first draft would have instrumented
  the flaky hook; this one leaves it alone entirely. That bug stays its own issue.
- **A quiet-machine green baseline.** Owed, and this plan does not produce it.
  See Rollout — no speedup percentage should be claimed until it exists.
- **Coverage-based selection.** Rejected upstream by the boxholder; the origin
  issue records why (real overhead, under-attributes subprocesses).
- **Selection in `personal-vibe-check`, `canvas-loop`, `callback-clerk`,
  `ios-app`.** Their suites are small or absent; `/finish`'s per-path map already
  runs them only when touched.

---

## Open design questions

- **How long the esbuild pass takes.** The only genuine unknown, and the first
  thing to measure. ~484 entrypoints over a shared graph, `packages: "external"`,
  `write: false`. Under ~3 s → run it on every invocation, no cache at all, and
  the plan loses its last piece of state. Tens of seconds → add the content-keyed
  cache described in Track 1. Minutes → the design needs rethinking, though
  nothing observed about esbuild suggests that. Measure before writing Track 2.
- **Whether the untested-by-import rule is too trusting.** The accepted critical
  gap. The conservative fallback: an unimported changed source file also runs the
  test directory mirroring its source directory (`test/` mirrors `src/` per
  `callback-box/CLAUDE.md`'s source-layout table). It is a heuristic and this plan
  is otherwise heuristic-free, which is why it is not the default. My lean is to
  ship without it and instrument — the selector already prints the triggering
  file, so evidence accumulates in agent transcripts — but one real missed
  regression should be enough to adopt it.
- **`N = 20`.** A starting value, not a derived one. Retune from the real
  distribution of selection sizes (see Rollout).
- **Whether `alwaysRun` should include a sample of route doctests** as a hedge
  against an incomplete blind-spot enumeration. My lean is no: it is unfocused
  defensiveness (principle #6) and Track 3c is the focused version of the same
  worry. But the review found my hand enumeration short by 6 of 11 files, so my
  instinct here has a track record and this is worth the boxholder's call.
- **Whether `test:changed` should eventually become the pre-commit default.** Not
  proposed now — the pre-commit hook runs typecheck + lint, not tests
  (`callback-box/CLAUDE.md:11`), and adding a test tier to every commit is a
  bigger change than this plan should smuggle in.

---

## Knowledge audits

**Skip, with rationale.** Knowledge audits verify what a *box* agent absorbed
from box-facing context (`callback-box/docs/knowledge-audits.md`). Everything
here is dev-repo infrastructure: `bin/`, `agent-doctest/`, `.claude/`. Box agents
never see it and an audit could not test it. The "did the agent absorb this"
surface for this work is `callback-box/CLAUDE.md`, `docs/testing.md`, and
`.claude/agents/finish.md`, which Tracks 4 and 5 update directly — and the
worktree `AGENTS.md` mirrors regenerate from the first of those.

---

## Implementation order

1. **Track 3** — the three coverage tests. First, ahead of the mechanism they
   protect: cheap, independent of everything else, and they generate the
   `alwaysRun` list Track 2 needs. Landing them first means the blind-spot
   enumeration is enforced before anything depends on it being right.
2. **Track 1** — `bin/test-graph`, with the cost measurement (open question 1) as
   its first output. The cache is built only if the number says so.
3. **Track 2** — `bin/test-select` and its config. Depends on 1's graph shape and
   3's generated `alwaysRun`.
4. **First full green run on a quiet machine** — the owed baseline, and the first
   cadence marker.
5. **Track 4** — `test:changed` / `pretest:changed`, the `--base` handling, and
   the CLAUDE.md guidance. Usable as soon as 3 and 4 are done.
6. **Track 5** — the `/finish` step 4 edit and the marker, then the nightly
   launchd job.

---

## Rollout shape

**Test posture.** Each track names its tests inline; they are design tools, not
coverage. The plan's done-when is these passing:

- `bin/test-graph.test.ts` — a doctest's transitive imports appear in its input
  set; the `.js`→`.tsx` case resolves; an ambiguous case yields **both** edges; a
  dangling import marks the entrypoint `unresolved` rather than throwing; a cache
  key computed for a different tree misses.
- `bin/test-select.test.ts` — one case per fail-open rule; `unresolved`
  entrypoints always selected; the untested-by-import case; every `forceFull`
  glob matches a real tracked path; an internal throw exits non-zero; the cadence
  is a pure function of the marker, so a docs-only landing cannot consume it.
- `test/dev/import-coverage.doctest.md` — 3a/3b/3c pass on the current tree, and
  each fails when its assumption is violated (a computed dynamic import pointing
  inside the repo, a `require` of repo source, a new spawning test file).

**The measurement the plan owes.** Step 4 produces the first green full run on a
quiet machine — the baseline the research section says is missing. Immediately
after, replay `bin/test-select` against the last 50 real commits on `main` and
record the distribution of selection sizes: how many test files each would have
run, and how often it fell open to full. Report it as *files skipped*, never as a
speedup percentage, until there is a green baseline to divide by. That
distribution also retunes `N` and tells you whether the untested-by-import rule
is firing more than expected.

**Migration.** No data shape changes and no artifact to migrate. The cadence
marker is regenerated by the next full run; deleting it is always safe.

**Docs that land with it.** `callback-box/CLAUDE.md:11` and `:17` gain the
two-command story, `docs/testing.md` gains a section on when each applies, and
`.claude/agents/finish.md` gains the marker-debt cadence in step 4. All three are
agent-facing, and they are why the knowledge-audit section above is skipped with
a reason rather than left empty.
