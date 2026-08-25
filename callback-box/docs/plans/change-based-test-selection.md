---
title: "Test failure ledger, and change-based selection on the iteration loop"
status: partial
workstream: test-economics
issues: []
---
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
  `agent-doctest/src/doctest-hooks.ts:366`, published as `agent-doctest/hooks`.
  The graph pass calls it rather than reimplementing it. **Verified working** —
  the spike built all 484 entrypoints through it.
- **The resolution rules live in one file and must stay that way.** The loader's
  `resolve` (`doctest-hooks.ts:20-45`). Track 1 extracts, does not copy.
- **The resolution surface is one alias.** `"@shared/*": ["./src/shared/*"]`
  (`callback-box/tsconfig.json:37-39`); the frontend's other four are
  deliberately unresolvable in the doctest program (`tsconfig.json:34-36`).
- **esbuild already drives a build step** (`scripts/build-cli.ts:32`,
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
**extracted** from `doctest-hooks.ts`.

The extraction target is specified, because leaving it open would put an
unresolved question inside a first chunk: **`agent-doctest/src/resolve-rules.ts`**
— `.mjs`, matching the hook that consumes it, so no cross-language boundary is
introduced into a published package. Added to `exports` as `./resolve-rules`
alongside the existing four (`agent-doctest/package.json:6-10`); imported
relatively by `doctest-hooks.ts` and by path from `bin/test-graph.ts`. The
`@shared/*` alias is a parameter, never baked in — `agent-doctest` is a
standalone package and must not learn this repo's tsconfig. No existing consumer
changes, and `agent-doctest`'s own suite must be green after the move.

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
"pretest:changed": "node scripts/build-cli.ts",
"test:changed":    "node --import tsx ../bin/test-select.ts --run"
```

`pretest:changed` is required: npm lifecycle hooks are per script *name*, so
`pretest` does not fire for `test:changed`, and a stale `dist/cli.mjs` would
defeat `alwaysRun`'s whole purpose.

**Full on the first invocation in a branch.** `test:changed` runs the whole suite
the first time it is called on a branch — detected from the ledger: no record for
this branch since it diverged from `main` — and selects thereafter. One full run
per branch buys back the integration signal the loop would otherwise defer to the
headless gate, and gives the ledger a clean per-branch baseline. Promoted from an
open question by the third review's finding 7.

**`pnpm test` keeps its meaning** — narrowing it would weaken
`.claude/agents/finish.md:27-32`.

**What this costs, stated up front.** Two things, and the second is worse.

*Resolution.* A test skipped mid-iteration cannot be observed failing
mid-iteration, so transient misses — a failure that would have surfaced mid-branch
and got incidentally fixed before merge — are invisible. The ledger's miss count
is therefore a **lower** bound. `implicated` is still recorded on every run, so
what survives is the counterfactual rather than the observation.

*Where failures land.* Real integration breakage moves out of the coding loop and
into `/finish` — a **headless subagent that cannot ask questions and must block on
any unexpected failure** (`.claude/agents/finish.md:10-14`, `:27-32`). That is the
worst actor to discover an integration bug in: attribution is weakest there, the
fix loop is longest, and the human is not in it. Mitigated by the first-invocation
full run below.

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

**The capture seam.** tap's `--output-file` writes raw TAP to a file **while
reporter output still goes to stdout** — so the capture does not replace the
configured `reporter: tap`, which `.taprc:31-36` chose deliberately for
agent-readable diagnostics. The wrapper runs tap with `--output-file`, preserves
the exit status exactly (per `.claude/agents/finish.md:198-202`, a pipe returns
the last command's status and can mask a failed suite), and parses the file
afterwards. Per-file `# time=Nms` records are in that file — precisely how the
`## Research (2026-08-08)` profiling collected them. No custom reporter is
written.

**Direction.** One JSONL record per run — green ones included — appended to
`$(git rev-parse --git-common-dir)/callback-test-ledger.jsonl`. The file sits
**inside `.git/`, so it is never committed and appears in no diff**, while
`--git-common-dir` resolves the same path from the main checkout and every
worktree, so one ledger serves them all.

```jsonc
{ "ts": "...", "commit": "...", "branch": "...", "treeHash": "...",
  "mode": "full",                              // or "selected"
  "accounted": true,                           // could the graph place every changed path?
  "changed": ["callback-box/src/..."],
  "ranFiles": "sha256:ab12…",                  // key into the sidecar manifest
  "implicated": "sha256:ef56…",                // what the graph alone points at
  "durations": { "test/webapp/routes/scan-upload.doctest.md": 58177 },
  "failures": [{ "file": "test/...", "class": "attached" }] }
```

**`ranFiles` is recorded exactly, not implied.** An earlier draft stored no file
list for `full` runs, on the theory that "full means every entrypoint at that
commit". That is not reconstructible: `.taprc:10-14` controls membership, test
files are added and deleted constantly, and a dirty tree matches no commit.
Without an exact set, per-file rates, never-failed, and duration trends all break
across renames. File lists are stored as a content hash into a sidecar
`{hash: [files]}` manifest — the entrypoint set changes rarely, so the manifest
stays small while every record carries an exact, rename-proof membership set.

**Record the graph's opinion, not a policy's.** `implicated` is what the graph
alone points at, and `accounted` is whether it could place every changed path.
Neither depends on the selector, which is why the ledger can land before it.

An earlier draft recorded what the *shipped selection rule* would have run and
classified failures as `attached` / `missed` / `covered-only-by-policy`. Two
problems, both found while building it. The classes overlap — on a `FULL` run
every unimplicated failure is simultaneously "not selected by the graph" and
"selected by policy", so the same failure satisfies two definitions. And a
recorded fact that encodes a policy goes stale the moment the policy changes,
which it is expected to. So the record holds facts and `report` applies
policies:

- **attached** — the file is in `implicated`. The graph explains the failure.
- **unimplicated** — it is not. Nothing in the graph pointed at it and it failed
  anyway. **This is the number that decides selection's future.**
- **unknown** — the diff or the graph could not be computed. Never silently
  folded into either of the others.

From those plus `accounted`, `report` answers both policy questions without
re-running anything: a conservative rule (unaccounted → full suite) would have
missed only the unimplicated failures on *accounted* runs, while the aggressive
rule the boxholder favours would have missed every unimplicated failure not in
`alwaysRun`. Recording the primitive rather than the verdict is what keeps both
answerable.

**Flakiness is derived from the ledger, not adjudicated by an agent.** An earlier
draft delegated it to `/finish`'s tracked-flake protocol
(`.claude/agents/finish.md:34-52`) — but that involves grepping issues, matching
signatures, and judging whether a branch touched "the code it exercises". What
that records is *flakes a finish subagent was willing to pass*, not flake rate.
Instead: a file that **failed in one run and passed in a later run at the same
`commit` and `treeHash`** is flaky by definition, computed by `report`. No agent,
no prose, and it catches flakes that surface during ordinary iteration rather
than only those a merge happened to adjudicate.

**`bin/test-ledger report`** answers: failure rate per file over time (with the
flake share broken out), the miss count and which files produced it, and per-file
duration trends.

It also lists files **never observed failing** — as an observation, with no
implication about worth. `docs/testing.md:5-11` puts decomposition and
documentation ahead of regression-catching, so a test that never fails may be
doing its main job perfectly. That list is the start of a human question, not a
delete-list.

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

## Revision 2026-08-25 — test economics

The tracks above were written when the value was a speedup and the risk posture
was "unaccounted → run everything." Sixteen days of ledger data and a decision
by the boxholder replace that posture. This section supersedes Tracks 2, 4 and
5b where they conflict; Tracks 1, 3 and 5a stand as landed.

### What the ledger showed (546 runs, 2026-08-09 → 08-25)

Each run's window was estimated from its timestamp and per-file durations
(`jobs: 6`); a run is *concurrent* if another run's window overlaps it.

| full runs | n | red | unimplicated failures | median wall |
| --- | ---: | ---: | ---: | ---: |
| solo | 256 | 18% | 215 | 2.4 min |
| concurrent (max 8 at once) | 87 | 46% | 367 | 5.4 min |

- A quarter of full runs, run under contention, produced 63% of all
  unimplicated failures and each took 2.2× as long. Queued is faster than
  parallel here, and greener.
- Of the 255 unimplicated failures on **solo** runs, 87 passed at the identical
  tree hash (flake by definition); most of the rest are the `test/frontend/*`
  thirteen-file block failing as one loader event, one 291-failure run with a
  broken environment, and a persistent timing-sensitive set —
  `test/core/box/file-watcher`, `test/hub/hub-e2e`, `test/lib/git-lock`,
  `test/field-test/run`, `test/field-test/lifecycle`. **No clear case was found
  of a full run catching an unexpected interaction bug in unrelated code.**
  (Caveat: a real failure fixed by the next commit is indistinguishable from a
  flake in this data; this is absence of evidence.)
- The cost is volume: 343 full runs across 56 branches — median 4 per branch,
  max 31, 12 of them on a tree already recorded green — 28 wall-hours.

### The decision

Stated by the boxholder, recorded here so the plan carries its own risk
appetite rather than the earlier one:

- Test things that matter. Fast, useful tests; not tests run constantly
  because it is "the right way."
- Iteration runs affected tests only. **No full suite at merge.** A failure
  occasionally reaching `main` is acceptable provided it is caught within
  roughly a day; agents can reconstruct what happened and fix up.
- Full runs are batched — every ~10 landings or every hour, whichever first.
- Flaky tests are not deleted for being a nuisance; they run less often and
  more carefully.

### Mechanism

**A. Machine-wide run semaphore, in the ledger wrapper.** `bin/test-ledger.ts
run` already wraps every `pnpm test` and already owns a location in the shared
git common dir. It gains a lock: **2 slots** for ordinary runs; a *careful* run
takes **both**, so it starts only when nothing else is running. Lock files
`<common-dir>/callback-test-locks/<slot>` carry a pid and are stale when the
pid is dead, written before the current boot (`sysctl kern.boottime`), or
older than any run could be (2 h) — pid liveness alone wedges on pid reuse
after a reboot, the same hardening `bin/schedules`' run lock already carries.
**A waiting exclusive run is a barrier:** once a careful run is queued, new
ordinary runs queue behind it rather than taking freed slots, otherwise a
steady stream of iteration runs starves it forever. A queued run prints one line — `test-ledger: waiting for slot
(held by pid N, branch X, since T)` — then nothing until it starts. Every
record gains `concurrency: <runs live at start>` so the table above never has
to be estimated again. One slot was rejected as inviting lockups (a wedged run
holding the only slot blocks everything); two bounds contention below the
thrash point measured above while a stale-pid check bounds the wedge.

**B. Selection, permissive.** `bin/test-select` per Track 2, with the rule
changed:

```
selected = alwaysRun ∪ graph.unresolved ∪ changedTests ∪ implicated
```

and **no `FULL` fallback.** An unaccounted path contributes nothing. If the
result is empty the selector prints `no test imports the changed paths` and
exits 0 having run nothing — that is the honest statement. tap is not
invoked at all in that case (a bare `tap` would fall back to `.taprc`'s
includes and run everything), so the wrapper cannot parse a TAP summary; the
selector appends the ledger record itself — `mode: "selected"`, empty
`ranFiles`, no failures — so the gap is counted, not hidden, and prints a
synthetic `# { total: 0, pass: 0, selected: 0 }` line so `/finish`'s
summary-line parse (`.claude/agents/finish.md:170-172`) has something to read
and treats it as green with a stated reason. `record()`'s current
"TAP output named no test files" error stays for the tap path.

**`treeHash` must hash content, not status.** Today it hashes `HEAD^{tree}`
plus porcelain *text* (`bin/test-ledger.ts:75-77`), so fail → edit the same
dirty file → pass keeps one hash and the flake derivation calls a real fix a
flake. Under full runs that was tolerable; with selected runs the derivation
is the only flake signal, so it is fixed first: hash `git diff HEAD` plus the
`git hash-object` of each untracked file. Careful-tier files (C) are dropped from the selection
unless the test file itself changed. `test:changed` is the agent's iteration
command; the "full on first invocation per branch" rule from Track 4 is
dropped. Internal error still exits non-zero, and callers treat that as "run
`pnpm test`."

**C. Careful tier.** A committed list, `callback-box/test/careful.txt`, one
test path per line, seeded from the ledger's flake set (the files named above
plus the `test/frontend/*` block only if its loader failure recurs after the
semaphore lands — that block is load, not flake). `.taprc` cannot express it,
and shell expansion of file lists in `package.json` is fragile (a list that
expands to nothing leaves a bare `tap` running everything), so the ledger
wrapper — already in front of every tap invocation — builds the argv:
`test-ledger run --tier ordinary -- tap` appends every `.taprc`-included
file not in `careful.txt`; `--tier careful` appends the list, forces `-j1`,
and takes the exclusive lock. A listed path that no longer exists fails the
run loudly rather than silently shrinking the tier. Membership is a
judgment, not an automatic demotion: `bin/test-ledger report` prints
candidates (flake share over the last N runs) and a human moves lines.
A careful test that starts failing in the batched run is a real signal, since
it ran alone on an idle machine.

**D. Batched full run — `schedules/full-suite/`.** Replaces Track 5b's nightly
and the full run `/finish` performs today. `bin/schedules` computes due-ness
from cadence only (`bin/CLAUDE.md`, "Due-ness is computed"); a schedule's
`check` is a post-run validator, not a due hook. So: `cadence: 1h`, and `run`
decides whether there is work — it reads the last full-suite record on `main`
from the ledger and exits via `bin/schedules done` when no landing has
arrived since. The "every 10 landings" half of the rule is dropped; hourly
with a landing is the batch, and a burst of landings inside an hour is one
run. `run` **pins the commit at start** — `git rev-parse main` once, then
runs in a detached worktree of that commit, not the live main checkout — so
a landing that arrives mid-run is neither tested nor marked tested; it is
the next hour's work. The ledger call passes `--base <last tested commit>`
so `changed` is the landed range (on `main`, `main...HEAD` is empty and
`implicated` would otherwise be nothing), which is what makes `unimplicated`
on these runs a real meter. It runs `pnpm test` then `pnpm test:careful`
under the semaphore, the careful half exclusive.

On red, in order: an *environment* failure (more than ~20 files, or the
loader block) raises one alert and does not bisect; a file that passes on
its isolated re-run is recorded as flake and does not open an issue (it
does count toward C's candidates); a file the ledger already shows with a
high flake share is treated the same even if it fails twice. What remains is
bisected over **landings only** — `git log --first-parent <last tested>..<pinned>`,
~a few candidates, one branch each — and files one issue per failing landing
naming the landing commit, the workstream from its subject (`Merge branch
'worktree-<name>'`; landing merges carry no `Workstream:` trailer, the
branch's own commits do), and the failing files, then reports via
`bin/schedules alert`. It does not fix anything; the workstream's own agent
does the fixup.

**E. `/finish` — a cheaper landing.** `.claude/agents/finish.md` changes in
five places; the dispatcher skill (`.claude/skills/finish/SKILL.md`) needs
only its description updated.

- *Step 4 runs `pnpm test:changed`*, plus typecheck and lint as today. The
  selection is computed after step 3's merge of `main`, on `main...HEAD`, so
  it is the branch's own change set. It takes one ordinary semaphore slot.
  "Read the full output" and the summary-line parse stay; the synthetic
  `total: 0` line from B is a green result with a stated reason, reported as
  "no test imports the change".
- *The docs-only fast path is subsumed.* Its `iff every path under docs/`
  rule (`finish.md:127-158`) is the selector's rule with a directory check
  in place of a graph: a docs-only diff selects nothing. Typecheck, lint and
  Track O are still skipped when the diff has no code, decided from the same
  path list; the special case stops being a separate procedure.
- *The test-failure rule gets stronger, and the flake protocol shrinks.*
  "Any failure blocks" (`finish.md:90-101`) stays, and now means more: every
  selected test was chosen because the branch touched what it imports, so a
  red one is the branch's to answer for, and "unrelated file" is no longer a
  plausible plea. The tracked-flake protocol (`finish.md:103-125`) loses its
  issue-grep, its "did the branch touch the code it exercises" judgment, and
  the one-full-suite re-run: the agent re-runs the failing file once in
  isolation; the ledger records fail-then-pass at the same content hash as a
  flake by definition; the agent proceeds on an isolated pass and names the
  file. Filing a flake issue is no longer the finish's job — `careful.txt`
  curation from the ledger report (C) is the channel.
- *Re-verification after green* (`finish.md:282-291`) is the same rule: a
  post-green code commit re-runs `test:changed`, which now includes only
  what that commit implicates.
- *"Never run the suite in the main checkout"* (`finish.md:122-125`) stays
  and gains its complement: the hourly run (D) is the only thing that tests
  `main`, and it does so from a detached worktree.

What is not changed and why: Track O (step 5), plan reconciliation (6) and
issue closing (7) are judgment passes, cheap in machine time and the reason a
landing is more than a merge; the strictness of BLOCKED-on-anything-unclear
is what lets a headless Sonnet do this at all. One inefficiency is noted and
left: a BLOCKED result re-dispatches from step 1 and repeats every step,
including verification. With verification now seconds instead of minutes,
that repeat stops mattering, which is the cheaper fix than a resume protocol.

**E2. Scripts for the finish.** `/finish` is invoked on every landing, and
`.claude/agents/finish.md` is 562 lines of prose that a headless Sonnet
re-derives each time: a dozen git commands to classify the diff, a per-path
verification map to apply by hand, PIPESTATUS discipline, a report template.
Every prose step is a place to be slow or wrong. The merge end already has a
script (`bin/land`: gate checks, `--no-ff`, refuses when main moved). The
front end gets two more, and the agent's instructions shrink to "run these,
act on what they print":

- **`bin/finish-preflight`** — steps 1–3 and the classification, one command,
  one JSON/text report. Confirms worktree state and the private leg; lists
  stragglers (it never commits them — whether they are intentional is the
  one thing the dispatcher passes in); merges `main` and stops on conflict
  with the paths; then prints the **decision sheet**: changed paths grouped
  by package; `docsOnly`; the selected test set (from `bin/test-select`) or
  "nothing implicated"; the verification commands to run, coalesced per the
  per-path map (`finish.md:251-280`), so the map lives in code; whether a
  plan (`Plan:` trailer / `workstream:` front matter) and any named issues
  exist, i.e. whether steps 5b, 6 and 7 have anything to do; and a Track O
  scope: the diff line count and whether any non-test source changed, so a
  tests-and-docs-only diff skips the review. Each step in the agent file
  becomes conditional on a field of this sheet rather than on re-derivation.
- **`bin/finish-verify`** — runs the verification commands the sheet named,
  each captured to a file outside the worktree with its real exit status,
  and prints one line per command (`ok` / `FAIL <path to output>`) and a
  final verdict. On a test failure it performs the isolated re-run of the
  failing file itself and reports `flake` or `real`, so the agent's
  remaining judgment is only "real failure → fix or BLOCKED". Re-running
  after a post-green commit is the same command; it re-selects.

Both are TypeScript under `bin/` with tests, like `test-ledger`. The agent
file is then rewritten around them **under a budget: at most 150 lines**,
against 562 today — instruction files only ever grow, so the rewrite is a
cut, and anything mechanical that would push it over the budget goes into a
script instead — kept are the rules that need judgment
(Track O's checklist, plan reconciliation, issue closing, the BLOCKED
contract, the report); removed are the mechanics the scripts now own. The
dispatcher skill passes the sheet's inputs (straggler intent, issues) as it
does today. Expected: a code landing's fixed cost drops from a suite run plus
several minutes of derivation to under a minute of scripts, with the agent's
tokens spent on the three judgment steps.

Guidance (`callback-box/CLAUDE.md:11`, `cb-guide-testing`, `doctest`) becomes:
iterate with `pnpm test:changed` or a named file; `pnpm test` is what the
schedule runs, and an agent reaching for it should say why.

### What this costs, stated

- Integration breakage now surfaces up to ~1 h (or 10 landings) after merge,
  on `main`, as a filed issue rather than a blocked merge. The boxholder has
  priced this as acceptable; the ledger's `unimplicated` count on schedule
  runs is the meter, and if it rises the dial to turn is the batch size, not
  the posture.
- A branch that touches only untested code merges with no test having run.
  That was already true in substance (the tests that ran did not import the
  change); it is now visible in the ledger as an empty `ranFiles`.
- Two lists to maintain (`alwaysRun`, generated; `careful.txt`, curated).
- Cross-model review (Codex, 2026-08-25) found the gaps now folded in above:
  the empty-selection record, content-based `treeHash`, pid-reuse and
  exclusive-starvation in the lock, the due-hook that does not exist, the
  pinned commit and `--base` for the schedule, argv building for the tiers,
  and flake/environment handling before bisect.

### Expected effect

Full runs machine-wide drop from ~21/day to ~4–8/day, each ~2× faster
without contention; iteration runs go from the suite (2.4–5 min) to a median
13% of it or a single file. The instrument keeps measuring whether the
escapes the posture accepts actually happen.

### Order

1. **A** (self-contained; lands first because it also cleans the ledger's
   signal for C).
2. **B** + Track 3's `alwaysRun` generator, with `test:changed`.
3. **C** — `careful.txt` seeded from the current report.
4. **D** — the schedule, with bisect + issue filing.
5. **E** — `bin/finish-preflight` + `bin/finish-verify`, then the agent-file
   rewrite around them and the guidance change, last, because it is the
   point where agent behavior changes.

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
- **A quiet-machine green baseline.** No longer owed — measured 2026-08-09 at
  143.9s green (see the origin issue). Note what it does to this plan's premise:
  the suite is 3.9x faster than the loaded profiling suggested, so any scheme
  justified against 9.5 minutes is being justified against a number that does
  not exist.

---

## Open design questions

- **How much ledger data is enough to act on.** Needs a denominator in *failures
  observed*, not weeks elapsed. I do not know the number, and it should be set
  before anyone reads the report, not after.
- **Whether first-invocation-full is enough sampling.** It is now in Track 4, so
  the open part is only whether one full run per branch recovers enough
  mid-iteration signal, or whether a periodic full run within a long branch is
  also wanted. The ledger will show it: if misses cluster on long branches, it is
  not enough.
- **What to do about tests that never fail.** The ledger produces the list, and
  the list does not mean what it looks like it means: `docs/testing.md:5-11` puts
  decomposition and documentation ahead of regression-catching, so never-failed is
  not evidence of low value. The interesting version of the question is which of
  them *could* have failed. No plan yet — the data comes first.
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

**The ledger lands first**, needing only the graph. The third review's finding 4
was right that an earlier order built the selector before the instrument: if the
ledger is the valuable thing and its payoff is months out, every week it is not
collecting is a week of data lost, while the selector's benefit is available any
time.

1. **Track 1 (landed 2026-08-09)** — `bin/test-graph`, including the
   `resolve-rules` extraction from `doctest-hooks.ts`, with `agent-doctest`'s
   suite green afterwards. Needed by the ledger for `implicated`.
2. **Track 5a** — the ledger: the `--output-file` capture, the sidecar manifest,
   `implicated` + `accounted`, mechanical classification, and `report`. Wired to
   `pnpm test` while **every run is still a full run**, so it collects clean
   ground truth before anything narrows. **Landed 2026-08-09** (`bin/test-ledger.ts`,
   `bin/test-ledger-lib.ts`), including the `pnpm test` wiring itself
   (`callback-box/package.json`).
3. **First full green run on a quiet machine** — the owed baseline, and the
   ledger's first records. **Done 2026-08-09: 6,623/6,623 green in 143.9s**,
   against 566.5s and not green on the loaded machine the profiling used. From
   here the ledger accumulates continuously.
4. **Track 3** — the four precision guards. 3c generates the `alwaysRun` list and
   3d protects a scope assumption, both of which Track 2 needs.
5. **Track 2** — `bin/test-select`.
6. **Track 4** — `test:changed` / `pretest:changed`, first-invocation-full,
   `--base`, CLAUDE.md guidance. The point at which behavior changes for agents,
   and deliberately last.
7. **Track 5b** — the nightly.

Note what is absent: any change to what `/finish` verifies, and any dependence on
`/finish`'s prose protocol for flake classification.

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
  synthetic failing run classifies **attached / missed / covered-only-by-policy**
  correctly, including the case where the run escaped to `FULL` (which must NOT
  read as `attached`); an uncomputable diff yields `unknown`, never a guess; a
  write failure warns without failing the run; the exit status of the wrapped tap
  run is preserved exactly; `report` derives flakiness from a fail-then-pass pair
  at identical `commit` + `treeHash`, and computes per-file rates from the
  recorded `ranFiles` sets rather than from run counts.
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
