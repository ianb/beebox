**Status:** proposed 2026-08, gated on a measurement spike

# Change-based test selection from a derived import graph

Run fewer tests during worktree iteration by deriving the test→source import
graph from the working tree with esbuild and intersecting it with the branch's
diff against `main`. Selection applies **only where the graph can account for
every changed path**; anything it cannot account for runs the full suite. The
merge gate keeps running everything while the mechanism proves itself in shadow.

**Issues addressed**

- `issues/exploration/2026-08-08-run-less-of-the-test-suite.md` — the origin
  item. Its `## Research (2026-08-08)` section is the measured baseline; the plan
  does not re-derive it.
- `issues/bugs/2026-08-05-doctest-loader-tsx-resolution-flake-recurred.md` — not
  resolved here. Relevant twice: the first draft would have instrumented the
  flaky hook (this one does not), and shadow mode keeps flake signatures visible
  at the gate where attribution is strongest.

**How this plan got here.** Two cross-model reviews, both in
[`change-based-test-selection.review.md`](change-based-test-selection.review.md).
The first found four fidelity failures in an empirically-recorded import map and
led the boxholder to flip the mechanism to a derived graph. The second attacked
the architecture and found that the safety model — enumerate the non-import
coupling channels, enforce them with tests — was a whitelist that had already
come up short twice, and that it missed an entire class: tests that depend on
*bytes read from disk* rather than modules. The boxholder then inverted the trust
model, which is the current design. Three prior positions were reversed
deliberately, not overlooked: runtime recording (briefing), selected-only at
`/finish` (briefing), and enumerate-the-exceptions (first two drafts).

Checked and not addressed: `issues/bugs/2026-07-29-flaky-login-redirect-doctest.md`
and `issues/docs-and-chores/2026-08-08-maintenance-cadence-framework.md` (this
plan adds one scheduled job that should later fold into that framework; it does
not build the framework).

---

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` **#4 — "Resilient AND never
  silent."** The risk is a selector that quietly runs too few tests. Every
  fallback is loud, and no failure degrades into "ran fewer tests" silently.
- **#6 — Right-sized defensiveness.** Bounds the above. The current design is
  *smaller* than the previous two drafts, and that is the main thing to check
  when reading it: every deletion below was a mechanism that turned out to be
  defending a case the default now covers.
- **#8 — One way to do each thing.** The second review's finding 6: a sibling
  tool that re-derives module resolution creates a second authority over what
  "this test imports" means. Track 1 answers it by extracting one shared module.
- **#10 — Testability is architectural.** The selection decision is pure logic
  over a graph and a file list, separable from the git and esbuild I/O.
- **#12 — The maintainer is usually an agent.** One line of output, no flag
  required, always naming the rule that fired.
- `CLAUDE.md`: "Treat noisy command output as a bug" — this runs on every
  iteration; its output budget is one line.
- Precedent: `/finish`'s docs-only fast path (`.claude/agents/finish.md:73-74`)
  — *"It's docs-only **iff** every changed path sits under a `docs/` directory
  AND none is a `.doctest.md`."* Note the shape: an **iff over every changed
  path**, defaulting to the expensive branch. This plan is the same rule with a
  graph in place of a directory check, and matching that precedent exactly is
  what the trust inversion accomplished.

---

## What already exists

- **The markdown→TS transform is already a shared, exported function.**
  `generateTestSource(markdown, filePath)` at
  `agent-doctest/src/doctest-hooks.mjs:366`, published as `agent-doctest/hooks`
  (`agent-doctest/package.json:10`). **Reused, not rebuilt** — the graph pass
  does not reimplement how a doctest becomes code; it calls the function the
  runner calls.
- **The resolution rules live in one file today and must stay that way.** The
  loader's `resolve` (`doctest-hooks.mjs:20-45`) handles the `.doctest.md` case
  and the one TSX fallback, delegating everything else to Node/tsx. Track 1
  **extracts** those rules rather than reimplementing them (second review,
  finding 6).
- **The resolution surface is one alias.** Doctests run under the root tsconfig,
  whose `paths` is exactly `"@shared/*": ["./src/shared/*"]`
  (`callback-box/tsconfig.json:37-39`). The frontend's four other aliases are
  deliberately unresolvable there — `tsconfig.json:34-36`: *"@backend/@core/
  @schemas stay unresolvable on purpose — a frontend module reaching for those in
  a doctest is a boundary violation, not a config gap."*
- **No `index.ts`/`index.tsx` ambiguity exists.** Counted: 20 `index.ts`, 1
  `index.tsx`, no directory with both. The resolution the loader hand-patches has
  one correct answer per specifier here.
- **esbuild already drives a build step.** `scripts/build-cli.mjs` bundles with
  `packages: "external"` (`:32`) for the same reason this needs it. **Reused**
  with `metafile: true`, `write: false`.
- **`/finish` already computes this diff** (`.claude/agents/finish.md:69-70`) and
  already has a per-path verification map (`:184-196`). **Reused verbatim.** The
  root suite (19 `bin/*.test.ts`, 2.60 s) is never selected — cheaper to run than
  to reason about.
- **`bin/manual-tests-scheduled.sh`** is a working "launchd → constrained triage
  agent → files an issue → notification" pattern (`:49-57`, `:59-96`). **Reused
  as the model** for the nightly.
- **No existing changed-file utility.** Root `package.json` has
  `path-leak-check`, `commit-blocklist-check`, `mobile-contract-check` — all
  `node --import tsx bin/*.ts` with sibling `bin/*.test.ts`.

---

## Prior art (external)

- **Jest `--changedSince` / Vitest `--changed`** derive the static import graph
  per test entrypoint and intersect with the changed set — the same mechanism.
  Both make the same default choice this plan now makes: a changed file the graph
  cannot place runs everything.
  https://jestjs.io/docs/cli#--changedsince
- **Microsoft Test Impact Analysis (Azure DevOps)** — the industry name, and the
  source of the safety posture: never selected-only forever, force periodic full
  runs, treat "unknown" as "run everything".
  https://learn.microsoft.com/en-us/azure/devops/pipelines/test/test-impact-analysis
- **Bazel / Nx** are the counter-example worth naming: they achieve safe
  selection by requiring dependencies to be *declared*, including data files
  (`data = [...]` in Bazel). That is the only widely-deployed way to get
  precision on non-import coupling, and it costs a declaration discipline this
  repo does not have. It is the natural successor to this plan if the inverted
  default proves too coarse — see NOT in scope.
  https://bazel.build/reference/be/common-definitions#common.data
- **esbuild `metafile`** documents `outputs[].inputs` as the per-output resolved
  input set. Documented caveat that matters: it reports what esbuild *resolved*,
  so a wrong `onResolve` produces a wrong graph silently — hence Track 1 makes
  ambiguity additive rather than a choice.
  https://esbuild.github.io/api/#metafile
- **Searched and found nothing** for deriving an import graph from a markdown
  doctest corpus, which is expected — the format is ours.

---

## Tracks / scope

### Track 0 — The measurement spike (a gate, not a phase)

**What.** A throwaway graph + selector, replayed over the last ~50 real commits
on `main`, answering four questions before any of the tracks below are built.

**Why this needs to change.** The second review's finding 1: the plan commits to
a permanent correctness liability before showing the payoff. That is backwards,
and it is cheap to fix — the replay is a day's work and it can kill the plan.

**The four questions.**

1. **How long does the esbuild pass take** over ~484 entrypoints? Under ~3 s it
   runs on every invocation and the plan needs no cache at all. Tens of seconds
   and it needs a content-keyed one. Minutes and the design is wrong.
2. **What fraction of real commits are fully accounted for by the graph?** This
   is the question the trust inversion makes decisive. A commit touching any
   unaccounted path runs full, and config, template, fixture, script, and
   untested-frontend changes are all unaccounted. If most real commits fall open,
   there is no plan here.
3. **When a commit *is* accounted for, how many test files does it select?** The
   distribution, not the mean — a median of 40 with a fat tail at 400 is a
   different product than a median of 40 with a tail at 60.
4. **How does that compare against the per-file floor?** The floor is ~12–13% of
   aggregate suite time (see NOT in scope), it helps the full suite too, and it
   carries no correctness risk. If selection's realistic saving is comparable,
   the floor is the better first investment and this plan should be shelved.

**Exit criteria — state them before running it.** Proceed only if the pass is
under ~10 s, more than half of sampled commits are fully accounted, and their
median selection is under ~40% of the suite. Otherwise write the numbers into the
origin issue and stop. Fixing the bar afterwards to match the result is how a
measurement gate becomes theatre.

**First implementation chunk.** The whole spike; nothing is kept.

### Track 1 — Derive the import graph

**What.** `bin/test-graph` builds one esbuild pass over every test entrypoint and
returns, per test file, the set of repo files it transitively imports — plus the
set of every repo file that appears anywhere in that graph.

**Direction.** One `esbuild.build()`:

```
entryPoints: test/**/*.doctest.md (minus test/manual/**) and test/**/*.test.ts
bundle: true            // required for the metafile input graph
packages: "external"    // node_modules stay out, as in build-cli.mjs
write: false            // nothing is emitted; the metafile is the product
metafile: true
platform: "node", format: "esm"
```

Two plugins:

- **The doctest plugin.** `onLoad` for `.doctest.md` calls `generateTestSource`
  from `agent-doctest/hooks`, returns it with `loader: "ts"`.
- **The resolution plugin.** Consumes the rules **extracted** from
  `doctest-hooks.mjs` into a new shared module (`agent-doctest/src/resolve-rules.ts`),
  which the loader then also consumes. The callback-box-specific `@shared/*`
  alias is passed in as a parameter — `agent-doctest` is a standalone published
  package and must not learn this repo's tsconfig. **One authority for what a
  specifier resolves to**, per principle #8 and the second review's finding 6.

**Ambiguity is additive, never a choice.** If more than one candidate exists, the
plugin picks one and records the others as extra edges the selector unions in. A
derived graph can deliberately over-approximate; the empirically-recorded map
this plan started from structurally could not, and that asymmetry is why the
mechanism was flipped.

**Unresolvable is per-test fail-open.** A specifier resolving to nothing marks
that entrypoint `unresolved`; it is then **always selected** until fixed, and the
build does not fail. Deleted files fall out for free: delete `src/foo.ts` and
every test importing it becomes unresolved, so all of them run.

**Freshness.** Derived from the working tree, so it cannot be stale. If Track 0
says a cache is needed, its key is a content hash (`git rev-parse HEAD^{tree}`
plus a hash of `git status --porcelain -z` and the mtimes it names) — a hit is by
construction a graph for exactly this tree. No staleness bound, no producer, no
write invariant.

**First implementation chunk.** `bin/test-graph.ts` exposing
`buildGraph(): Promise<{ tests: Map<string, Set<string>>; universe: Set<string>; unresolved: Set<string> }>`,
the `resolve-rules` extraction with `agent-doctest`'s own tests still passing, and
`bin/test-graph.test.ts` over a fixture tree: transitive imports appear;
`.js`→`.tsx` resolves; an ambiguous case yields **both** edges; a dangling import
marks the entrypoint rather than throwing.

### Track 2 — The selector

**What.** `bin/test-select` prints the test files to run, or `FULL`.

**Direction.** A pure function behind a thin I/O shell:

```ts
selectTests(input: SelectionInput): SelectionResult
// SelectionInput  = { changed: string[]; graph: TestGraph; alwaysRun: string[] }
// SelectionResult = { kind: "full"; reason: string }
//                 | { kind: "selected"; tests: string[]; reason: string }
```

**The rule, in one sentence:** select **iff every changed path is accounted for
by the graph** — it is a test entrypoint, or it appears in `graph.universe` as
something at least one test imports. Otherwise `FULL`.

```
accounted(p)  =  p ∈ graph.entrypoints  ∨  p ∈ graph.universe
if not every changed path is accounted → FULL

selected = alwaysRun
         ∪ graph.unresolved
         ∪ { changed test entrypoints }
         ∪ { test | graph.tests[test] ∩ changed ≠ ∅ }
```

Plus `FULL` on: the graph build throwing; a changed path being untracked by git
and not ignored; the diff base being undeterminable (detached HEAD, missing
`main`, shallow clone); and any error at all — the shell exits non-zero, and
**every caller treats a non-zero exit as "run the full suite"**, never as "skip".

**What this deleted, and why that is the headline.** The previous draft carried a
hand-maintained `forceFull` list of eleven globs — `.taprc`, `tsconfig*.json`,
`templates/**`, `test/fixtures/**`, `pnpm-lock.yaml`, `scripts/build-cli.mjs`,
`bin/cb`, `agent-doctest/**`, and others. **Every one of them is unaccounted by
construction** — no test imports a `.taprc` or a lockfile — so the inverted
default forces full on all of them without naming any. The list is gone, not
shortened. It had already come up short twice (5 spawners found by hand against
11 in the tree; `pub-worker/**` never considered at all), and the right response
to a list that keeps coming up short is to stop needing the list.

**The critical gap is closed, not documented.** Both prior drafts carried an
accepted critical gap: a changed source file no test imports selected almost
nothing, and that was safe only if an enumeration of non-import coupling channels
was complete. The second review found the enumeration missing a whole class —
`test/publish/pub-worker-meta.doctest.md:49-51` exists specifically so *"a
drive-by edit that breaks provisioning … fails here first"*, and reads
`pub-worker/wrangler.jsonc` with `readFile` (`src/publish/pub-worker-meta.ts:159-172`),
so the old design would have skipped that test on exactly that edit. Under the
inverted rule, `pub-worker/wrangler.jsonc` is unaccounted and runs everything. No
enumeration is trusted, so none can come up short.

**What the inversion costs.** Selection now helps only when a change touches
exclusively *tested* code. Editing an untested frontend component, a template, a
script, or any config runs the full suite. That is a large share of real work,
and it is precisely why Track 0's question 2 is a gate rather than a curiosity.

**`alwaysRun` survives, narrowly.** It covers the one case the inversion does not:
a change to `src/cli/**` *is* accounted (the CLI doctests import it), so it
selects — but the tests that exercise the CLI by spawning `dist/cli.mjs` are not
among them. Generated and enforced by Track 3c rather than hand-maintained.

**First implementation chunk.** `bin/test-select.ts` and `bin/test-select.test.ts`
covering the accounted/unaccounted rule, `unresolved` pass-through, each `FULL`
condition, and the shell's non-zero exit.

### Track 3 — Precision guards

**What.** Three tests over the non-import coupling channels: computed dynamic
`import()`, `require()`/`createRequire()`, and child processes that load repo
code.

**Why these changed role.** In the previous draft these were the *safety*
mechanism — the enumeration everything rested on. Under the inverted default they
are no longer load-bearing for safety; an unaccounted path already runs
everything. They now do two smaller, honest jobs: they keep `alwaysRun` accurate
(so accounted changes do not miss a spawner), and they fail loudly when a new
coupling channel appears, which is a rot signal rather than a safety boundary.
Demoting them is the point — a mechanism that is not load-bearing cannot fail
silently.

- **3a — computed dynamic `import()`.** Eight dynamic imports exist in `src/`.
  Literal specifiers (`src/cli/bootstrap.ts:37`, `src/cli/commands/validate.ts:342`)
  are ordinary graph edges — esbuild resolves them, which is one place the derived
  graph beats a recording that would only have seen executed branches. The test
  asserts every *computed* specifier resolves outside the repo.
- **3b — `createRequire`.** Literal specifiers must resolve to packages, not repo
  source. The two current sites (`test/helpers/test-server.ts:22`,
  `src/webapp/views/node-view-runtime.ts:81`) resolve packages; the test exists to
  fail the day someone `require`s a repo module.
- **3c — child processes.** Over **every test entrypoint and helper**, not just
  `.doctest.md`. The second review's finding 5 was that scoping it to an
  extension misses `test/frontend/trpc-directory-resolution.test.ts:8-17`, which
  spawns twelve children importing `src/frontend/src/lib/view-bindings.ts` — and
  that file is the regression test for the open TSX flake, a poor thing to miss.
  Each spawner must be in `alwaysRun` or import in-parent what its child imports.
  This test generates `alwaysRun`.

**First implementation chunk.** `test/dev/import-coverage.doctest.md` carrying all
three. A `callback-box` doctest because it reads `callback-box/src/` and `test/`.

### Track 4 — The worktree iteration loop

**What.** Selected testing as the default way an agent runs tests inside a
worktree, keyed on the branch's diff against `main`.

**Why here and not at the gate.** This is where the cost lands. A worktree
session runs the suite many times while iterating and once at `/finish`, so the
loop is where nearly all the savings are — and it is where a wrong answer is
cheapest, because the gate catches it before anything merges.

**Direction.** Default base `main`, computed exactly as `/finish` does
(`.claude/agents/finish.md:69-70`):

```bash
git diff --name-only main...HEAD     # three-dot: merge-base, so a merged-in main doesn't widen it
git status --porcelain               # plus uncommitted work — the iteration loop's whole point
```

`--base <ref>` / `--since <sha>` exist for other framings; `main` is the default
and the habit.

**Rejected optimization: "only what changed since my last green run."** Narrower
and faster, but it needs per-session state and drifts out of agreement with the
gate. Keeping the loop and the gate on the same diff means a green loop run
predicts a green finish. The set widens as a worktree ages, which is correct.

**Scripts.**

```json
"pretest:changed": "node scripts/build-cli.mjs",
"test:changed":    "node --import tsx ../bin/test-select.ts --run"
```

`pretest:changed` is required, not decorative: npm lifecycle hooks are per script
*name*, so `pretest` fires for `test` and not for `test:changed`, and without it
the selected path can exercise a stale `dist/cli.mjs` — exactly where `alwaysRun`
is covering the subprocess channel.

**`pnpm test` keeps its meaning.** Narrowing it would weaken a load-bearing
sentence in the merge procedure (`.claude/agents/finish.md:27-32`: *"If `pnpm
test` reports ANY failure — anywhere in the suite, in any file, for any reason —
you do not proceed and you do not merge"*).

**Guidance.** `callback-box/CLAUDE.md:11` and `:17` become the two-command story;
the gitignored per-worktree `AGENTS.md` mirrors regenerate from it.

### Track 5 — Shadow mode at the gate, then a decision

**What.** `/finish` keeps running the full suite, *and* computes what selection
would have run, and records whether the difference would have mattered.

**Why this shape.** The second review's findings 2 and 7 are that selection at the
gate makes "the tests passed" conditional and pushes flake attribution to nightly
runs. The boxholder's answer was neither "always full forever" nor "selected now"
but: run both for a while and keep track of whether the full run was necessary.
That converts an argument into evidence, at zero risk, using the merges that are
happening anyway.

**Direction.** At `/finish` step 4, after the full suite runs:

1. Compute the selection for this branch's diff.
2. Append one record to `$(git rev-parse --git-common-dir)/callback-test-select-log.jsonl`:
   the commit, the changed-path count, `FULL` or the selected count, the total,
   and — the load-bearing field — **whether any test that FAILED was outside the
   selected set.**
3. If a failed test was outside the selected set, say so prominently in the
   finish report and file an issue. That is the mechanism producing a regression,
   observed live, before it can cost anything.

`bin/test-select report` summarizes the log: how often selection fell open, the
distribution of selected sizes, and the miss count. **The miss count is the
number the decision turns on**, and it starts at zero by construction — the full
run still gates the merge throughout.

**The decision this defers, with its options already named.** Once the log has
enough merges (and enough *failures* — a miss count of zero over a period with no
failures is not evidence), pick one:

- **Selected at the gate.** Cheapest. Accepts that a branch can merge on a
  selected green.
- **Full-minus-exclusions.** Run everything except a small named set of slow or
  finicky files, *unless the graph implicates them*, in which case they are
  pulled back in. Default stays "run"; the exclusion is narrow, named, and
  reviewable; and the graph can only ever add tests back. This inverts the gate's
  trust the same way Track 2 inverts the selector's, and it bounds the residual
  risk to a set small enough to inspect by hand. It is the boxholder's
  suggestion, and on present reasoning it is the better of the two — but the log
  is what should decide it, which is the whole point of shadow mode.
- **Stay full.** If the log shows real misses, this is the finding, not a failure.

**The nightly.** Reuse `bin/manual-tests-scheduled.sh`'s shape: a launchd job runs
the full suite from `main` and hands the log to a constrained Sonnet agent with
the same authority boundary and `TRIAGE:` contract. Independent of shadow mode
and worth having regardless — it catches breakage on `main` that no branch ran.

**No cadence, no marker, no debt arithmetic.** The previous draft's every-N-commits
gate and its last-full-run marker are deleted: while the gate is always full, there
is no cadence to compute. If the decision above later lands on selected-at-the-gate,
the cadence question comes back and gets designed then, with the log in hand.

**First implementation chunk.** The log write and `report` subcommand, then the
`/finish` step 4 edit.

---

## Could this be simpler?

**The simplest version: a directory heuristic.** "Changes confined to
`src/frontend/` run only `test/frontend/**`; otherwise everything." No graph.
It is unsafe for the directories that carry the cost: `test/helpers/test-server.ts:24`
imports `../../src/core/box/package.js`, so a `src/core/` change reaches every
route doctest, and a directory rule silently drops them. The safe subset is
whatever has no inbound edges, and you cannot know that without computing edges.
Traces to principle #4. If the graph proves unmaintainable, the fallback is this
heuristic restricted to `src/frontend/` — a real, safe subset.

**The version this plan was rewritten away from twice.** Draft 1 recorded the
graph empirically from the doctest loader; draft 2 derived it but trusted an
enumeration of non-import channels. Both are argued against above and in the
review file. The pattern across both: each tried to be *precise* about a coupling
it could not fully observe, and each was found short by a reviewer within one
pass. The current design is less precise on purpose.

**Is the graph still earning its keep after the inversion?** Honest answer: less
obviously than before, and that is what Track 0 exists to settle. Under the
inverted rule the graph's only job is to answer "is every changed path something a
test imports, and if so which tests" — a narrower job than it had two drafts ago.
If Track 0 shows most real commits touch at least one unaccounted path, the graph
answers "FULL" most of the time and the correct conclusion is to shelve this and
do the per-file floor work instead. That outcome is a success of the gate, not a
failure of the plan.

---

## Subplans

None. The per-file cost floor is the one sub-question big enough to deserve its
own design, and it is out of scope (below) as an independent issue rather than a
subplan — Track 0 explicitly measures this plan against it.

---

## Failure modes

> **Critical gap: none.** Both prior drafts had one — a changed source file no
> test imports ran almost nothing, safe only if an enumeration was complete. The
> inverted default closes it structurally: an unaccounted path runs everything,
> so no enumeration is trusted and none can come up short. This is the single
> most important consequence of the second review.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
| --- | --- | --- | --- |
| A changed path is coupled to tests by something other than an import (data file, config, template, spawned binary) | Yes — `bin/test-select.test.ts` asserts `pub-worker/wrangler.jsonc` and `.taprc` both yield `FULL` | Yes — unaccounted → `FULL`, by default rather than by list | Clear: `FULL (pub-worker/wrangler.jsonc is not imported by any test)` |
| A specifier resolves to nothing (deleted file, typo, new alias) | Yes — fixture with a dangling import | Yes — that entrypoint is `unresolved` and always runs | Clear: the selector names unresolved entrypoints |
| Two resolution candidates exist for one specifier | Yes — fixture with both present | Yes — both become edges | Silent by design, and safe: it can only select more |
| The esbuild pass throws | Yes — the shell's catch-all | Yes — non-zero exit, caller runs full | Clear: the error prints and the full suite runs |
| A change to tested source misses a test that reaches it via a spawned child | Yes — Track 3c | Yes — the spawner is in `alwaysRun` | Clear: 3c fails at commit time when a new spawner appears |
| A module reached only by a computed dynamic `import()` or `createRequire` | Yes — Tracks 3a/3b | Yes — such specifiers must resolve outside the repo / to packages | Clear: fails at commit time |
| **Selection would have skipped a test that actually failed** | Yes — this is what shadow mode measures, on live merges | Yes — the full run still gates every merge while shadow runs | Clear and loud: named in the finish report and filed as an issue |
| An untracked new source file is edited | Yes | Yes — `FULL` | Clear: `FULL (untracked paths)` |
| The graph cache (if Track 0 says one is needed) serves the wrong tree | Yes — key-collision case | Yes — content-hash key over tree + working-tree status | Clear: a miss recomputes; there is no age to be wrong about |
| `alwaysRun` names a deleted test file | Yes — asserted against the entrypoint list | Yes — the graph has no such entrypoint | Clear: the selector errors → non-zero → full |
| The shadow log is missing, corrupt, or unwritable | No test (see note) | Yes — the log is observational; a write failure warns and the merge proceeds | Clear: a warning in the finish report |

Note on the log row: it records evidence and gates nothing. Building failure
handling for an observational log beyond "warn" is defensiveness against a
failure with no consequence (principle #6) — the same reasoning that deleted
`forceFull`.

---

## Agent-flow / user-flow edge cases

- **Wrong command** — **ADDRESSED.** `pnpm test` keeps meaning the full suite, so
  the safe command is the one already in every agent's habit and every doc; the
  new one is the opt-in. During shadow mode the merge gate is unchanged, so an
  agent that ignores `test:changed` entirely loses speed and nothing else.
- **Stale ref** — **ADDRESSED, and dissolved.** The graph is derived from the
  tree; there is no recorded state, no cadence marker, and nothing with an age.
  This was the hardest problem in draft 1 and successive rewrites removed it
  rather than managing it.
- **Two agents touching the same thing** — **ADDRESSED.** Each worktree derives
  its own graph from its own tree. The only shared artifact is the append-only
  shadow log, which gates nothing.
- **Hand-edit drift** — **ADDRESSED, and mostly dissolved.** `forceFull` is gone;
  `alwaysRun` is generated by Track 3c. The remaining hand-authored artifact is
  the exclusion list *if* the Track 5 decision lands on full-minus-exclusions,
  and that list would be small, named, and only ever able to remove tests the
  graph did not implicate.
- **Fabricated free-form value** — **ADDRESSED.** The `reason` string is generated
  from the rule that fired, never free-form.
- **Validation error UX** — **ADDRESSED.** One line beginning `test-select:`,
  always naming the rule and, on `FULL`, the specific path that caused it.
- **Partial migration / transition state** — **ADDRESSED.** There is no
  transition. Before the selector exists, and any time it errors, behavior is
  today's: run everything. Its "not installed" state and its "broken" state are
  the same state, and it is the safe one.

---

## NOT in scope

- **The per-file cost floor** — deferred, but Track 0 explicitly measures against
  it. Every test file pays Node boot + tsx + loader; the 37 files calling
  `makeTestServer()` also pay a 1,023 ms cold template-box build. The fastest
  observed file is 0.828 s (`test/core/external-url-fetch.doctest.md`), close to
  pure floor; ~0.9 s × 480 is roughly 430 file-seconds against the measured
  3,374.8 aggregate — 12–13%, on the same loaded-machine caveat as every other
  number here. It helps the *full* suite, and carries no correctness risk. File
  it as its own `issues/code-quality/` item. **If Track 0 comes out badly, this is
  what to do instead.**
- **Declared data dependencies (the Bazel model).** The way to earn precision back
  under an inverted default: a test declares the paths it reads, so
  `pub-worker-meta` claims `pub-worker/**` and a change there selects it instead
  of running everything. Deliberately not in v1 — it re-introduces a trust
  boundary one layer down (a path is "accounted" once *some* test declares it,
  and a second test that also depends on it and did not declare is the old bug
  again), and it should not be designed before the shadow log shows where
  precision is actually wanted.
- **Selecting within the root `bin/` suite.** 2.60 s total.
- **Changing `jobs: 6` or `timeout: 300`.** The research does not revalidate them.
- **Fixing the TSX resolution flake.** Draft 1 would have instrumented the flaky
  hook; this plan leaves it alone entirely.
- **A quiet-machine green baseline.** Owed; this plan does not produce it, and no
  speedup percentage should be claimed until it exists.
- **Coverage-based selection.** Rejected upstream; the origin issue records why.
- **Selection in `personal-vibe-check`, `canvas-loop`, `callback-clerk`,
  `ios-app`.** Small or absent suites; `/finish`'s per-path map already runs them
  only when touched.

---

## Open design questions

- **Track 0's four questions**, above. They are the plan's real open questions and
  they are answered by measurement, not argument. Question 2 — what fraction of
  real commits the graph fully accounts for — can end the plan.
- **The Track 5 decision** — selected at the gate, full-minus-exclusions, or stay
  full. Deliberately deferred to the shadow log. My present lean is
  full-minus-exclusions, because it keeps "run" as the default and bounds the
  risk to a set small enough to read; but the log should decide, and it may show
  the exclusions are not worth it.
- **How much shadow data is enough.** A miss count of zero across merges that
  contained no failures is not evidence of anything. The exit condition needs a
  denominator in *failures observed*, not merges elapsed, and I do not know the
  right number. Worth setting before shadow mode starts, not after.
- **Whether `test:changed` should ever become the pre-commit default.** Not
  proposed. The pre-commit hook runs typecheck + lint, not tests; adding a test
  tier to every commit is a bigger change than this plan should smuggle in.

---

## Knowledge audits

**Skip, with rationale.** Knowledge audits verify what a *box* agent absorbed from
box-facing context (`callback-box/docs/knowledge-audits.md`). Everything here is
dev-repo infrastructure: `bin/`, `agent-doctest/`, `.claude/`. Box agents never
see it and an audit could not test it. The "did the agent absorb this" surface is
`callback-box/CLAUDE.md`, `docs/testing.md`, and `.claude/agents/finish.md`, which
Tracks 4 and 5 update directly.

---

## Implementation order

0. **Track 0 — the spike. A gate.** Nothing below starts until its four numbers
   exist and clear the stated exit criteria.
1. **Track 3** — the three precision guards. First among the real tracks: cheap,
   independent, and 3c generates the `alwaysRun` list Track 2 needs.
2. **Track 1** — `bin/test-graph`, including the `resolve-rules` extraction from
   `doctest-hooks.mjs` (with `agent-doctest`'s own suite green afterwards).
3. **Track 2** — `bin/test-select`. Depends on 1's graph shape and 3's `alwaysRun`.
4. **First full green run on a quiet machine** — the owed baseline.
5. **Track 4** — `test:changed` / `pretest:changed`, `--base` handling, CLAUDE.md
   guidance. The agent-visible change, and the point at which savings start.
6. **Track 5** — the shadow log and the `/finish` step 4 edit, then the nightly.
   The gate's behavior does not change here; only its bookkeeping.

Note what is *not* in this list: any change to what `/finish` verifies. That
change is a separate decision, made later, from the shadow log.

---

## Rollout shape

**Test posture.** Each track names its tests inline. Done-when is these passing:

- `bin/test-graph.test.ts` — transitive imports appear; `.js`→`.tsx` resolves; an
  ambiguous case yields **both** edges; a dangling import marks the entrypoint
  rather than throwing; a cache key computed for a different tree misses.
- `bin/test-select.test.ts` — the accounted/unaccounted rule, including explicit
  cases for `pub-worker/wrangler.jsonc`, `.taprc`, and an untested frontend
  component all yielding `FULL`; `unresolved` entrypoints always selected; every
  `FULL` condition; an internal throw exiting non-zero.
- `test/dev/import-coverage.doctest.md` — 3a/3b/3c pass on the current tree, and
  each fails when its assumption is violated (a computed dynamic import pointing
  inside the repo, a `require` of repo source, a new spawning test entrypoint of
  either extension).

**The measurements this plan owes.** Track 0's four numbers before anything is
built, and step 4's green quiet-machine full run as the baseline the research
section says is missing. Report savings as *files skipped* and *fraction of
commits fully accounted*, never as a speedup percentage, until there is a green
baseline to divide by.

**Migration.** No data shape changes and no artifact to migrate. The shadow log is
append-only and observational; deleting it loses evidence and nothing else.

**Docs that land with it.** `callback-box/CLAUDE.md:11` and `:17` gain the
two-command story, `docs/testing.md` gains a section on when each applies, and
`.claude/agents/finish.md` gains the shadow-log step. All three are agent-facing.
