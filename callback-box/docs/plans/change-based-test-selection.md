**Status:** proposed 2026-08-09, measurement done

# Test failure ledger, and change-based selection on the iteration loop

Two things, in this order of importance:

1. **A ledger of test runs**, one appended line each, green ones included —
   green runs are the denominator that turns failure counts into failure rates.
   Each failure is classified *attached* (a test the change should have run),
   *missed* (a test the change had no apparent relation to, which failed
   anyway), or *flaky*. It lives inside `.git/`, so it is never committed, and
   nothing branches on it. It is an instrument.
2. **Change-based selection on the worktree iteration loop** — an import graph
   derived from the tree with esbuild, intersected with the branch's diff
   against `main`. Selection applies only where the graph accounts for every
   changed path; anything else runs the full suite. `/finish` keeps running
   everything, so the ledger always has ground truth at the merge boundary.

The ledger is first because it answers a question this repo cannot currently
answer: **which tests have ever failed in a way that mattered?** That is worth
knowing whether or not selection ever ships, and it is what should eventually
decide how much verification each kind of change deserves.

**Issues addressed**

- `issues/exploration/2026-08-08-run-less-of-the-test-suite.md` — the origin
  item, whose `## Research (2026-08-08)` is the timing baseline and whose
  `## Track 0 measurement (2026-08-09)` is this plan's own measurement.
- `issues/bugs/2026-08-05-doctest-loader-tsx-resolution-flake-recurred.md` and
  `issues/bugs/2026-07-29-flaky-login-redirect-doctest.md` — **partly addressed.**
  Neither is fixed here, but both are flakes with no measured frequency, and the
  ledger's flake classification is the first thing in this repo that would
  produce one. Do not close either on the strength of this plan.
- `issues/code-quality/2026-08-09-src-untested-by-import.md` — not addressed;
  produced as a by-product of the measurement, and the dominant reason selection
  fires as rarely as it does.

**How this plan got here, including a reversal.** Two cross-model reviews and a
measurement, all recorded. The first review found four fidelity failures in an
empirically-recorded import map, and the mechanism was flipped to a derived
graph. The second attacked the architecture and found the safety model was a
whitelist that had come up short twice and missed a whole class — tests
depending on bytes read from disk rather than modules — and the trust model was
inverted: unaccounted paths run everything. Then Track 0 measured it, and **the
gate it set was not met**: 25% of real branches are fully accounted for, against
a bar of 50%.

The plan continues anyway, and the reason must be stated plainly rather than
buried, because "the gate failed, we proceeded" is exactly the shape of motivated
reasoning. **The gate was set for a project whose value was the speedup.** The
boxholder's response to the result reframed the project: if three quarters of
branches touch code no test imports, running 484 tests for them is not
verification, it is ritual — the honest description of a change to untested code
is *this code has no tests*, and a full suite does not fix that, it hides it.
What is actually unknown is whether those full runs ever catch anything, and no
replay over git history can answer it, because history records what was
committed, not what failed on the way. So the deliverable became the instrument
that can answer it. The speedup is now a secondary benefit, arriving on the 25%
of branches where it is free.

---

## Stated preferences this plan trades against

- `docs/engineering-principles.md` **#4 — "Resilient AND never silent."** The
  ledger is the strongest form of this: it turns a category of silent event — "a
  test failed that the graph thought was unrelated" — into a recorded one.
- **#6 — Right-sized defensiveness.** Every prior draft was larger. The cadence,
  the marker, the recorded map, the `forceFull` list, the write-only-from-a-green-run
  invariant, and finally the per-run ledger record were all deleted as the design
  got more honest. Each removal is noted where it happened; the pattern is the
  point.
- **#8 — One way to do each thing.** Resolution rules get extracted into one
  module the loader and the graph builder share, not a second authority.
- **#10 — Testability is architectural**, and its neighbour: a test's value is
  what it catches. The ledger is the first thing here that measures that.
- **#12 — The maintainer is usually an agent.** One line of selector output; the
  ledger is silent unless something is worth saying.
- Precedent: `/finish`'s docs-only fast path (`.claude/agents/finish.md:73-74`)
  — *"It's docs-only **iff** every changed path sits under a `docs/` directory
  AND none is a `.doctest.md`."* An **iff over every changed path**, defaulting
  to the expensive branch. Track 2 is the same rule with a graph in place of a
  directory check.

---

## What already exists

- **The transform is a shared, exported function.** `generateTestSource` at
  `agent-doctest/src/doctest-hooks.mjs:366`, published as `agent-doctest/hooks`.
  The graph pass calls it rather than reimplementing it. **Verified working** —
  the spike built all 484 entrypoints through it.
- **The resolution rules live in one file and must stay that way.** The loader's
  `resolve` (`doctest-hooks.mjs:20-45`). Track 1 extracts, does not copy.
- **The resolution surface is one alias.** `"@shared/*": ["./src/shared/*"]`
  (`callback-box/tsconfig.json:37-39`); the frontend's other four are
  deliberately unresolvable in the doctest program (`tsconfig.json:34-36`).
- **esbuild already drives a build step** (`scripts/build-cli.mjs:32`,
  `packages: "external"`). Reused with `metafile: true`, `write: false`.
- **`/finish` already computes the diff** (`.claude/agents/finish.md:69-70`) and
  has a per-path verification map (`:184-196`). Reused verbatim.
- **`/finish` already performs the flake re-run.** Its tracked-flake protocol
  (`.claude/agents/finish.md:34-52`) re-runs a failing file in isolation and
  checks whether the branch touched the code it exercises. That is precisely the
  flaky/attached discrimination the ledger needs — today the outcome is written
  in prose and discarded. Track 5 captures it instead of inventing it.
- **`bin/manual-tests-scheduled.sh`** is a working scheduled-agent pattern
  (`:49-57`, `:59-96`), the model for the nightly.
- **The spike code exists** in gitignored `scratch/test-selection-spike/`. Not
  shipped; it is the working reference for Tracks 1–2.

---

## Prior art (external)

- **Jest `--changedSince` / Vitest `--changed`** — the same derive-and-intersect
  mechanism, with the same default: a changed file the graph cannot place runs
  everything. https://jestjs.io/docs/cli#--changedsince
- **Microsoft Test Impact Analysis** — the industry name, and the source of the
  never-selected-only posture.
  https://learn.microsoft.com/en-us/azure/devops/pipelines/test/test-impact-analysis
- **Bazel / Nx** achieve precision on non-import coupling by requiring *declared*
  dependencies, including data files. The natural successor if the ledger shows
  precision is wanted where the graph has none.
  https://bazel.build/reference/be/common-definitions#common.data
- **Flaky-test dashboards (Google TAP, Chromium's flakiness dashboard)** are the
  closest prior art for the ledger itself. The published lesson: flake rate per
  test over time is the actionable unit, not per-run pass/fail, and the data only
  becomes useful after months. Both points are taken as given: rate-per-test is
  why the ledger records green runs (the denominator), and the months-long ramp
  is why time-to-signal is called out explicitly in Track 5.
  https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
- **Searched and found nothing** for deriving an import graph from a markdown
  doctest corpus — expected, the format is ours.

---

## The measurement (Track 0, done 2026-08-09)

Full method and caveats in the origin issue. Summary:

| Question | Bar set in advance | Measured | |
| --- | --- | --- | --- |
| Graph build time | under ~10 s | **1.8 s** for 484 entrypoints | pass |
| Real branches fully accounted for | over 50% | **25%** | **fail** |
| Selected size when it selects | median under 40% | **median 13%** (1%–59%) | pass |

Measured over 334 real branches — each merge commit's `^1...^2` diff, which is
the unit the loop and the gate actually key on. Per-*commit* the accounted rate
is 63%; commits are the wrong unit, and the gap between the two is a ratchet: a
branch accumulates paths, and one unaccounted path forces full for the rest of
its life.

What forces the full suite, over the 250 branches that would run it:

| Branches | Cause |
| ---: | --- |
| 194 | `src/frontend/**` untested by import |
| 111 | config, script, or data files |
| 101 | other `src/**` untested by import |
| 91 | `src/cli/**` untested by import |
| 22 | a `test/` helper or fixture that is not itself an entrypoint |

**The dominant cause is coverage, not the mechanism**: 430 of 1,288 `src/**`
files are imported by no test, 327 of them frontend. Two verified corrections are
folded in — files deleted since a commit were dropped rather than counted (a
replay artifact), and prose markdown inside `callback-box/` is treated as out of
scope (checked, not assumed, that no doctest reads the repository's own prose).
Both make 25% an **upper** bound.

---

## Tracks / scope

### Track 1 — Derive the import graph

`bin/test-graph`: one esbuild pass over every test entrypoint, returning per-test
transitive imports plus the universe of repo files appearing anywhere in the
graph. Config as validated by the spike: `bundle`, `packages: "external"`,
`write: false`, `metafile: true`, `platform: "node"`, `format: "esm"`,
`resolveExtensions` covering `.ts/.tsx/.mjs/.js/.jsx/.json`, and empty loaders
for `.css/.svg/.png`.

Two plugins: the doctest transform (`generateTestSource`, `loader: "ts"`,
`resolveDir` = the file's directory), and a resolution plugin consuming rules
**extracted** from `doctest-hooks.mjs` into `agent-doctest/src/resolve-rules.ts`,
with the `@shared/*` alias passed in as a parameter — `agent-doctest` is a
standalone published package and must not learn this repo's tsconfig.

**Candidates must be filtered to files, not directories.** The spike's first
failure was `Cannot read file "src/frontend/src/lib/trpc": is a directory` — the
same directory-index shape as the open TSX flake. An `existsSync` check is not
enough; it needs `statSync().isFile()`.

**Ambiguity is additive.** More than one candidate → pick one, record the rest as
extra edges the selector unions in. (Measured: zero ambiguous specifiers in the
current tree, so this path is untested by reality and needs a fixture test.)

**Unresolvable is per-test fail-open**: mark the entrypoint, always select it, do
not fail the build.

**No cache.** 1.8 s measured; the content-keyed cache earlier drafts contemplated
is not needed and is not built.

**First chunk.** `bin/test-graph.ts` + the `resolve-rules` extraction with
`agent-doctest`'s own suite still green + `bin/test-graph.test.ts` over a fixture
tree (transitive imports; `.js`→`.tsx`; a directory-vs-file candidate; an
ambiguous case yielding both edges; a dangling import marking rather than
throwing).

### Track 2 — The selector

`bin/test-select` prints test files or `FULL`. A pure function behind a thin
shell.

**The rule:** select **iff every changed path is accounted for** — it is a test
entrypoint, or it appears in the graph's universe. Otherwise `FULL`.

```
selected = alwaysRun
         ∪ graph.unresolved
         ∪ { changed test entrypoints }
         ∪ { test | graph.tests[test] ∩ changed ≠ ∅ }
```

**Scope.** Only paths under `callback-box/`, `agent-doctest/`, and the root pnpm
files can affect this suite; everything else (`issues/`, `bin/`, `ios-app/`,
`research/`, …) is outside selection's concern and does not force full. Within
scope, prose markdown that is not a `.doctest.md` is also out — verified, and
load-bearing: counting it in drops the per-commit accounted rate from 63% to
27%. If a doctest ever starts reading repo prose that assumption breaks silently,
so Track 3 carries a guard asserting none does.

Plus `FULL` on: the graph build throwing; a changed path untracked and not
ignored; an undeterminable diff base; and any error at all — non-zero exit, which
**every caller treats as "run the full suite"**, never as "skip".

**`alwaysRun`** covers what the graph cannot: a `src/cli/**` change is accounted
(CLI doctests import it) but the tests that exercise the CLI by spawning
`dist/cli.mjs` are not selected by that edge. Generated by Track 3c.

**Expected behaviour, from the measurement:** ~25% of branches select, at a median
of 13% of the suite. Three quarters run everything. That is the honest
expectation to hold, not a disappointment to discover later.

**First chunk.** `bin/test-select.ts` + `bin/test-select.test.ts` covering the
accounted/unaccounted rule (with explicit `pub-worker/wrangler.jsonc`, `.taprc`,
and untested-frontend cases all yielding `FULL`), scope handling, `unresolved`
pass-through, every `FULL` condition, and non-zero exit on internal error.

### Track 3 — Precision guards

Four tests, each turning an assumption into a build failure. They are **not** the
safety mechanism — the inverted default is — so a gap here costs precision, not
correctness. That demotion is deliberate: a mechanism that is not load-bearing
cannot fail silently.

- **3a — computed dynamic `import()`.** Literal specifiers are ordinary graph
  edges. Computed ones must resolve outside the repo.
- **3b — `createRequire`.** Literal specifiers must resolve to packages, not repo
  source. Two current sites, both packages.
- **3c — child processes**, over **every test entrypoint and helper**, not just
  `.doctest.md` — `test/frontend/trpc-directory-resolution.test.ts:8-17` spawns
  twelve children importing frontend source, and it is the regression test for
  the open TSX flake. Each spawner must be in `alwaysRun` or import in-parent what
  its child imports. Generates `alwaysRun`.
- **3d — no doctest reads the repository's own prose markdown.** Guards the scope
  assumption Track 2 depends on. Verified true today; the guard exists because if
  it stops being true, selection starts skipping a test that reads a doc that
  changed, silently.

**First chunk.** `test/dev/import-coverage.doctest.md` carrying all four.

### Track 4 — The worktree iteration loop

Selected testing as the default way an agent runs tests in a worktree, on the
branch's diff against `main`, computed exactly as `/finish` does
(`.claude/agents/finish.md:69-70`): `git diff --name-only main...HEAD` plus
`git status --porcelain`. `--base <ref>` / `--since <sha>` exist; `main` is the
default and the habit.

**Rejected optimization: "only what changed since my last green run."** Needs
per-session state and drifts out of agreement with the gate. Keeping both on the
same diff means a green loop run predicts a green finish.

```json
"pretest:changed": "node scripts/build-cli.mjs",
"test:changed":    "node --import tsx ../bin/test-select.ts --run"
```

`pretest:changed` is required: npm lifecycle hooks are per script *name*, so
`pretest` does not fire for `test:changed`, and a stale `dist/cli.mjs` would
defeat `alwaysRun`'s whole purpose.

**`pnpm test` keeps its meaning** — narrowing it would weaken
`.claude/agents/finish.md:27-32`.

**What this costs the ledger, stated up front.** With the loop selected, a test
skipped mid-iteration cannot be observed failing mid-iteration. Ground truth
moves to `/finish`, which still runs everything: roughly one clean data point per
branch rather than many. Over the measured period that is still hundreds of
branches. The loss is resolution, not signal — but transient misses (a test that
would have failed mid-branch and was incidentally fixed before merge) are
invisible, so the ledger's miss count is a **lower** bound.

**Guidance.** `callback-box/CLAUDE.md:11` and `:17` become the two-command story;
per-worktree `AGENTS.md` mirrors regenerate from it.

### Track 5 — The failure ledger

**What.** Every suite run appends a record. Every failure gets classified.

**Why this is the point.** Nobody can currently answer "which tests have ever
failed meaningfully?" A test that has never failed is either a load-bearing
regression anchor or dead weight, and there is no way to tell them apart. Two
flakes are open with no measured frequency. And the question that decides
selection's future — does a full run on an unaccounted branch ever catch anything
— is unanswerable from git history, because history records what was committed,
not what failed on the way.

**Direction.** A tap output capture (reporter or wrapper) on `pnpm test` and
`pnpm test:changed`, appending **one JSONL record per run** — green runs
included — to `$(git rev-parse --git-common-dir)/callback-test-ledger.jsonl`.
The file sits **inside `.git/`, so it is never committed and appears in no
diff**, while `--git-common-dir` resolves the same path from the main checkout
and every worktree, so one ledger serves them all.

**Green runs are recorded because they are the denominator.** A failure count
answers "which file keeps breaking"; a failure *rate* answers "is this getting
worse", and that needs to know how often the file ran and passed. The asymmetry
is what decides it: the denominator is free to collect now and **impossible to
reconstruct later** — start with failures only and the rate is permanently
unavailable for however long that ran.

```jsonc
{ "ts": "...", "commit": "...", "branch": "...", "dirty": true,
  "mode": "full",                              // or "selected"
  "ran": 484, "passed": 483, "ms": 566500,
  "changed": ["callback-box/src/..."],         // the diff at that moment
  "selected": [],                              // file list, only when mode = "selected"
  "durations": { "test/webapp/routes/scan-upload.doctest.md": 58177 },
  "failures": [ { "file": "test/...", "class": "attached" } ] }
```

A `full` record needs no file list — "full" means every entrypoint at that
commit — so the common case stays small. Only `selected` runs carry one (median
62 paths). Per-file denominator = full runs + selected runs that included it.

**Per-file durations come free, and pay a debt.** The capture is already parsing
tap output, which carries `# time=Nms` per file. Recording it means the
`## Research (2026-08-08)` profiling — hand-collected, on a loaded machine,
never repeated — becomes something the ledger accumulates continuously. That is
the measurement
`issues/code-quality/2026-08-09-test-suite-per-file-cost-floor.md` needs, and
the quiet-machine baseline this plan still owes stops being a one-off exercise.

**Classification is mechanical, not a judgement call.** `attached` vs `missed`
falls out of the graph and the diff, which the capture already has. No agent
decides it, so it cannot vary between sessions or be argued with after the fact.

**Classification.**

- **attached** — the failing file is in the selection for this diff. The graph
  explains it.
- **missed** — the failing file is *not* in the selection. The graph said it was
  unrelated and it failed anyway. **This is the number that decides selection's
  future**, and it is only observable on a `full` run, which is why `/finish`
  keeps running everything.
- **unknown** — recorded when the diff or the graph could not be computed. Never
  silently folded into either of the others.
- **flaky** is a *later* determination, not a field written at capture time. It
  comes from `/finish`'s existing isolated re-run
  (`.claude/agents/finish.md:34-52`): same file, same commit, passes on re-run,
  branch touched neither the test nor the code it exercises. `/finish` already
  performs this and discards the result; Track 5 has it append the outcome.

**`bin/test-ledger report`** answers: failure rate per file over time, with the
flake share broken out; the miss count and which files produced it; which files
have never failed; and per-file duration trends. A local query, not a dashboard.

**Nothing branches on the ledger.** It is observational. A write failure warns
and the run proceeds. That is what makes shipping it risk-free, and why it lands
even though its payoff is months out.

**Honest note on time-to-signal.** Failures are sparse and misses rarer. A miss
count of zero after two weeks is not evidence of safety — it may mean nothing
failed at all. The first useful output will be flake rates, which accumulate
faster. Any future decision must divide by *failures observed*, not weeks
elapsed.

**The nightly** (`bin/manual-tests-scheduled.sh`'s shape) runs the full suite
from `main` and appends to the same ledger, so `main` breakage that no branch ran
is captured too.

---

## Could this be simpler?

**The simplest version: ship only the ledger, change nothing about how tests
run.** Genuinely close, and it was the alternative on the table. What
selection-on-the-loop buys over it: agents get a real speedup on the quarter of
branches where the graph is confident, at no correctness cost, since `/finish`
still runs everything. What it costs is ledger resolution (Track 4). The
boxholder chose to take the speedup; if the ledger later looks too sparse, the
loop can revert to full runs without touching anything else.

**A simpler graph: a directory heuristic.** Unsafe for the directories that carry
the cost — `test/helpers/test-server.ts:24` imports
`../../src/core/box/package.js`, so a `src/core/` change reaches every route
doctest and a directory rule silently drops them. Traces to principle #4.

**Simpler than all of it: the per-file cost floor.** ~12–13% of suite time, helps
every run, no correctness risk, filed as
`issues/code-quality/2026-08-09-test-suite-per-file-cost-floor.md`. Not an
alternative to the ledger — they answer different questions — but it *is* an
alternative to selection, and on expected saving (~22% vs ~12–13%) the two are
closer than they look, because selection's saving is concentrated in a quarter of
branches while the floor's is universal. Worth doing regardless of this plan.

---

## Subplans

None.

---

## Failure modes

> **Critical gap: none.** Earlier drafts had one — a changed source file no test
> imports ran almost nothing, safe only if an enumeration of coupling channels
> was complete. The inverted default closed it: unaccounted runs everything, so
> no enumeration is trusted. The ledger is what would let that default be
> loosened later *with evidence* rather than by argument.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
| --- | --- | --- | --- |
| A changed path is coupled to tests by something other than an import (data, config, template, spawned binary) | Yes — explicit `pub-worker/wrangler.jsonc` and `.taprc` cases | Yes — unaccounted → `FULL`, by default not by list | Clear: `FULL (…is not imported by any test)` |
| A doctest starts reading repo prose markdown, breaking Track 2's scope assumption | Yes — Track 3d | Yes — the guard fails at commit time | Clear: fails before it can skip anything |
| A specifier resolves to a directory rather than a file | Yes — fixture case (the spike's first real failure) | Yes — `statSync().isFile()` filter | Clear: build error surfaces, entrypoint marked |
| A specifier resolves to nothing | Yes | Yes — entrypoint marked `unresolved`, always runs | Clear |
| Two resolution candidates exist | Yes — fixture (zero occur in the current tree) | Yes — both become edges | Silent by design, safe: can only select more |
| The esbuild pass throws | Yes | Yes — non-zero exit, caller runs full | Clear |
| **Selection would have skipped a test that failed** | This is what the ledger measures | Yes — `/finish` runs everything, so the miss is observed at merge | Clear: classified `missed`, surfaced by `report` |
| A transient miss is fixed before merge and never observed | No — inherent to selecting on the loop | None | **Silent, and accepted**: it makes the miss count a lower bound, stated in Track 4 |
| The ledger is unwritable or corrupt | No test (see note) | Yes — warn, proceed | Clear: a warning; the run is unaffected |
| A flake is misclassified as attached | Partly — `/finish`'s re-run is the discriminator | Yes — flake status is a later determination, not a capture-time guess | Clear: `unknown` is a real class, never folded into the others |
| `alwaysRun` names a deleted test file | Yes | Yes — no such entrypoint in the graph | Clear: error → non-zero → full |

Note on the ledger rows: it records evidence and gates nothing, so handling
beyond "warn" is defensiveness against a failure with no consequence
(principle #6) — the same reasoning that deleted `forceFull`.

---

## Agent-flow / user-flow edge cases

- **Wrong command** — **ADDRESSED.** `pnpm test` keeps meaning the full suite, so
  the safe command stays the habitual one and the new one is opt-in. An agent
  that ignores `test:changed` loses speed and nothing else.
- **Stale ref** — **ADDRESSED, dissolved.** The graph is derived from the tree.
  No recorded map, no cadence marker, nothing with an age.
- **Two agents touching the same thing** — **ADDRESSED.** Each worktree derives
  its own graph. The ledger is append-only and gates nothing; interleaved writes
  from concurrent sessions are fine (one JSON object per line, appended).
- **Hand-edit drift** — **ADDRESSED, mostly dissolved.** `forceFull` is gone;
  `alwaysRun` is generated by Track 3c.
- **Fabricated free-form value** — **ADDRESSED.** Both the selector's `reason`
  and the ledger's `class` are generated from the rule that fired. `unknown` is a
  real value, so nothing is ever forced to guess a classification.
- **Validation error UX** — **ADDRESSED.** One line beginning `test-select:`,
  naming the rule and, on `FULL`, the path that caused it.
- **Partial migration** — **ADDRESSED.** No transition. Before any of this exists,
  and any time it errors, behavior is today's: run everything.

---

## NOT in scope

- **Changing what `/finish` verifies.** It keeps running the full suite. The
  options — selected at the gate, full-minus-a-named-exclusion-set, or unchanged
  — are a later decision from ledger data, not a design question now.
- **The aggressive rule** (unaccounted → run almost nothing, on the argument that
  untested code is not verified by a full suite anyway). This is the boxholder's
  position and it may well be right; the ledger exists partly to earn it. Not
  taken on argument.
- **Declared data dependencies (Bazel model).** How precision is earned back
  under an inverted default. Premature until the ledger shows where precision is
  wanted.
- **Committing test results.** The ledger is per-machine and lives in `.git/`.
  Sharing it across machines is a separate decision (see open questions).
- **Pruning or rotating the ledger.** JSONL at a few tens of KB per day; a year
  is well under what any local query cares about. Revisit if it ever bites.
- **The per-file cost floor** — filed separately, worth doing regardless.
- **Fixing either open flake.** The ledger measures them; it does not fix them.
- **Selecting within the root `bin/` suite** (2.60 s), **changing `jobs: 6` or
  `timeout: 300`**, **coverage-based selection**, and **selection in other
  packages** — all unchanged from prior drafts.
- **A quiet-machine green baseline.** Still owed; no speedup percentage should be
  claimed until it exists.

---

## Open design questions

- **How much ledger data is enough to act on.** Needs a denominator in *failures
  observed*, not weeks elapsed. I do not know the number, and it should be set
  before anyone reads the report, not after.
- **Whether the loop should occasionally run full to sample the counterfactual.**
  With selection on the loop, mid-iteration misses are invisible (Track 4). A
  cheap fix is to run full on, say, the first invocation of each branch: one full
  run per branch, and some resolution recovered. Not proposed for v1 because it
  partly undoes the speedup that motivated selecting on the loop — revisit once
  the ledger shows how sparse misses are.
- **What to do about tests that never fail.** The ledger will produce that list.
  Deleting them is one answer and probably wrong for regression anchors; the
  interesting version is asking which of them *could* have failed. No plan yet —
  the data comes first.
- **Whether the ledger should be shared beyond one machine.** It is per-machine by
  construction (in the git common dir). Aggregation would need a real decision
  about where it lives; not now.

---

## Knowledge audits

**Skip, with rationale.** Knowledge audits verify what a *box* agent absorbed
from box-facing context. Everything here is dev-repo infrastructure — `bin/`,
`agent-doctest/`, `.claude/` — which box agents never see and an audit could not
test. The agent-facing surface for this work is `callback-box/CLAUDE.md`,
`docs/testing.md`, and `.claude/agents/finish.md`, updated by Tracks 4 and 5.

---

## Implementation order

1. **Track 3** — the four precision guards. First: cheap, independent of the
   mechanism, and 3c generates the `alwaysRun` list Track 2 needs while 3d
   protects a scope assumption Track 2 rests on.
2. **Track 1** — `bin/test-graph`, including the `resolve-rules` extraction from
   `doctest-hooks.mjs`, with `agent-doctest`'s suite green afterwards.
3. **Track 2** — `bin/test-select`.
4. **Track 5a** — the ledger capture and `report`, wired to `pnpm test` first,
   while every run is still a full run. **Deliberately before Track 4**: it gets
   a period of clean full-run ground truth before selection narrows anything.
5. **First full green run on a quiet machine** — the owed baseline, and the
   ledger's first records.
6. **Track 4** — `test:changed` / `pretest:changed`, `--base`, CLAUDE.md
   guidance. The point at which behavior changes for agents.
7. **Track 5b** — the `/finish` flake-outcome capture, and the nightly.

Note what is absent: any change to what `/finish` verifies.

---

## Rollout shape

**Test posture.** Done-when is these passing:

- `bin/test-graph.test.ts` — transitive imports; `.js`→`.tsx`; a
  directory-vs-file candidate (the spike's first failure); an ambiguous case
  yielding both edges; a dangling import marking rather than throwing.
- `bin/test-select.test.ts` — the accounted/unaccounted rule with explicit
  `pub-worker/wrangler.jsonc`, `.taprc`, and untested-frontend cases; scope
  handling; `unresolved` pass-through; every `FULL` condition; non-zero exit on
  internal error.
- `bin/test-ledger.test.ts` — a green run appends a record with no failures; a
  synthetic failing run classifies attached vs missed correctly; an uncomputable
  diff yields `unknown`, never a guess; a write failure warns without failing the
  run; `report` computes a per-file rate whose denominator counts full runs plus
  the selected runs that included that file.
- `test/dev/import-coverage.doctest.md` — 3a–3d pass on the current tree and each
  fails when its assumption is violated.

**The measurements owed.** The quiet-machine green baseline (step 5). Then, from
the ledger rather than from a replay: flake rate per file, and the miss count with
its denominator in failures observed.

**Migration.** No data shape changes. The ledger is append-only and
observational; deleting it loses evidence and nothing else.

**Docs that land with it.** `callback-box/CLAUDE.md:11` and `:17` gain the
two-command story; `docs/testing.md` gains a section on when each applies and what
the ledger is for; `.claude/agents/finish.md` gains the flake-outcome capture in
its tracked-flake protocol.
