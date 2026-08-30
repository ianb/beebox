---
title: "refresh-maps convergence"
status: implemented
workstream: unknown
issues: []
---
# refresh-maps convergence

`bbx refresh-maps` banks its progress only if the agent reaches the last step of
its prompt. When the agent runs out of turns first, nothing is recorded and the
next run produces an identical brief — the procedure never converges. When the
agent *does* finish half the work and then finalizes, it silently stamps the
untouched half as current. This plan makes progress bankable on evidence rather
than on agent cooperation, and stops one under-powered run from being worth
nothing.

**This plan supersedes the analysis in
`issues/bugs/2026-07-15-refresh-maps-wedges-on-unresolvable-dir.md`.** That
issue's deadlock does not reproduce; see "What the repro established". The issue
should be updated or closed when this plan lands.

## What the repro established

A synthetic repro (`scratch/refresh-maps-repro.ts`, gitignored) built a v2 box
for each candidate mechanism and ran the real `precheck` and `finalize` against
it. Results, verbatim:

```
Hypothesis A (issue's: dir absent at a resolvable asOf)  → CONVERGES: true
Hypothesis B (asOf commit unresolvable)                  → CONVERGES: true
```

**Neither mechanism deadlocks.** In both cases `finalize` stamps `asOf = head`,
`precheck.ts:131` (*"if (stateEntry.asOf === head) continue;"*) short-circuits on
the next run, and the box is clean. The filed issue's chain fails at two points:
`finalize.ts:135-152` already stamps per-task, and `engine-step.ts:254-258` runs
`stageAll`/`commit` regardless of `succeeded`, so a failing step does not prevent
`asOf` from advancing.

The genuine defects the repro *did* surface:

```
agent rewrote inbox/MAP.md, then died (uncommitted)
finalize TODAY: applied=[inbox, store] — 2 tasks stamped, only 1 map rewritten
```

and, comparing candidate evidence baselines for the same run:

```
inbox (rewritten):  asOf..HEAD=false   asOf..worktree=true   task.head..worktree=true
store (untouched):  asOf..HEAD=false   asOf..worktree=false  task.head..worktree=false
```

Two conclusions the plan is built on. First, `finalize` stamps directories whose
MAP.md was never touched. Second, any commit-to-commit baseline reads `false` for
work that is still uncommitted — which is the normal state at finalize time — so
evidence must compare against the **working tree**.

There is exactly one way this procedure fails to converge: the agent never
reaches finalize. Everything else is severity, not deadlock.

## Stated preferences this plan trades against

- **[`docs/engineering-principles.md`](../engineering-principles.md) #4
  (resilient AND never silent)** — the central violation: an error handler
  invents an empty listing, and finalize invents "the agent did the work".
- **#1 (types are structure)** — the listing helper cannot express "unknown", so
  callers cannot branch on it.
- **#5 (failure paths visible in signatures)** — precheck genuinely dispatches on
  *why* a listing is unavailable. [`src/lib/result.ts`](../../src/lib/result.ts)
  is the one Result convention.
- **#3 (validate at boundaries)** — `git` subprocess output is an input boundary.
- **#6 (right-sized defensiveness)** — checks go at the subprocess boundary, not
  through interior code.
- **#10 (testability is architectural)** — every new path is reachable from a
  doctest with existing helpers.
- **[`code-style.md`](../../code-style.md)** — logging levels, max 2 positional
  params, no default parameters, no `as`, explicit return types on exports.
- **[`CLAUDE.md`](../../CLAUDE.md)** — don't add features beyond the task;
  doctests are the test format.

Precedent: `engine-parse.ts:78` (*"severity: step.validate.severity ?? \"warn\""*)
— the engine already treats `warn` as the default posture and `abort` as the
exception. `warn` is a legal enum value (`src/schemas/procedure.ts:47`).

## What already exists

- **Per-task finalize** — `finalize.ts:135-152` loops per-task and stamps only
  `appliedTasks`. **Reused.** Granularity is already right; the *evidence* is
  wrong.
- **The `asOf === head` short-circuit** — `precheck.ts:131`. The convergence
  mechanism the whole plan leans on. **Reused unchanged.**
- **`MapTask.head`** — `precheck.ts:46` (*"Current HEAD commit hash."*) already
  records the brief-time HEAD on every task. **Reused** as Track A's evidence
  baseline; no new field needed.
- **Run-phase shells run even when the agent fails** —
  `engine-run-phase.ts:143-145` logs `Agent failed` and returns rather than
  throwing; `:225` then calls `runRunShells` unconditionally. Max-turns returns
  `success: false` rather than throwing, so this holds for the case that matters.
  **Reused** — the guaranteed floor under Track B.
- **`ensureGitClean`** — `engine-phase.ts:169-197`, commits at `:189` when the
  tree is dirty. Runs at `engine-run-phase.ts:226`, i.e. **after** run shells
  (`:225`) and **before** validate (`:255`). This ordering is why Track A must
  diff against the working tree.
- **Failed steps still commit** — `engine-step.ts:254-258`. **Reused.**
- **`severity` gating** — `engine-step.ts:212` gates only on `abort`.
- **Run-shell failure gates regardless of severity** — `engine-step.ts:215`
  (`runFailure !== undefined || ...`). Constrains Track B.
- **`Result<T, E>`** — `src/lib/result.ts:31-34`. **Reused** in Track C.
- **`gitBoxPrefix`** — used at `precheck-listing.ts:103` because
  `ls-tree --full-tree` forces repo-root interpretation. **Deliberately NOT
  reused** in Track A: `git diff` pathspecs are CWD-relative, and `simpleGit`
  runs with `cwd = boxRoot`, so a box-relative path is already correct. Adding
  the prefix would produce `content/content/...` and match nothing.
- **`listChildrenAtCommit`** — `precheck-listing.ts:94-129`, the error-hiding
  site at `:113`. **Rebuilt** in Track C.
- **Doctests** — `test/core/maps/maps-precheck.doctest.md`,
  `maps-finalize.doctest.md`, `makeTmpBox({ git: true })`. **Reused.**

## Prior art (external)

- **`git ls-tree` cannot distinguish "path absent" from "commit unresolvable"
  via exit code or stderr** in the `<rev>:<path>` peel form this code uses. An
  initial search claimed exit 0 for an absent path; that is true of the
  *pathspec* form only. Verified directly: both cases exit **128** with a
  byte-identical `fatal: Not a valid object name <rev>:<path>`. Stderr matching is
  not viable. https://git-scm.com/docs/git-ls-tree
- **`git rev-parse --verify <sha>^{commit}` is the reliable discriminator** —
  verified: exit 0 resolvable, exit 1 not. https://git-scm.com/docs/git-rev-parse
- **Historic git bug: `ls-tree` could exit 0 on internal tree-read corruption**,
  arguing for an affirmative pre-check over trusting exit codes.
  https://git.vger.kernel.narkive.com/x44l4nsT/patch-v3-2-2-ensure-ls-tree-exits-with-a-non-zero-exit-code-if-read-tree-recursive-fails
- **`--full-tree` is the documented fix for the CWD-relative footgun** —
  confirms `precheck-listing.ts:96-105` is correct as written, and by contrast
  confirms `git diff` needs the opposite treatment.
  https://git-scm.com/docs/git-ls-tree
- **"Error hiding"** is the name for the anti-pattern at `precheck-listing.ts:113`
  — catching an error and continuing as if nothing happened. The canonical case
  study is mapping a 404 to a fallback the caller cannot distinguish from a real
  value. https://en.wikipedia.org/wiki/Error_hiding
- **Sentinel Object pattern** — the established fix for a default value colliding
  with a real one; `[]` currently carries two meanings.
  https://python-patterns.guide/python/sentinel-object/
- **"High-water mark" / "checkpointing"** are the industry names for banking
  per-item progress across resource-limited runs. `state.maps[dir].asOf` is
  already a per-item high-water mark; this plan fixes how it advances.
  https://www.palantir.com/docs/foundry/pipeline-builder/management-checkpoints
- **No prior art found** for a single named pattern covering the three-way
  "absent / unknown / error" split. Recording the gap rather than inventing a term.

## Tracks / scope

Ordered by implementation dependency. Track A is the correctness fix, Track B is
the convergence fix and depends on A, Track C is independent and lower value.

### Track A — finalize stamps on evidence, not on a file merely existing

**What.** Replace `finalize`'s `fileExists` guard for `update` tasks with a check
that the MAP.md actually changed during this run.

**Why this needs to change.** `finalize.ts:142` guards with `await
fileExists(mapAbs)` — but an `update` task's MAP.md already exists, untouched, so
the guard always passes. The docstring at `finalize.ts:118-122` claims it *"guards
against agents that exit without writing every promised MAP.md"*; that holds only
for `create`. Demonstrated: an agent that rewrote one of two maps had both
stamped. This is exactly what the procedure card's own `whys` says the design
exists to prevent (`refresh-maps.procedure.card:161-164`).

**Direction.** Evidence is a working-tree diff against the brief-time HEAD:

```
git diff --quiet <task.head> -- <task.map>      # exit 1 ⇒ changed ⇒ stamp
```

Run via `simpleGit(boxRoot)`, so `task.map` is used as-is with **no**
`gitBoxPrefix`. `task.head` (`precheck.ts:46`) scopes the question to "did this
map change during this run", which is what we mean — and unlike an `asOf`-based
range it cannot false-positive on unrelated history between `asOf` and now.
Working-tree (not `..HEAD`) because `ensureGitClean` has not committed yet at
finalize time.

`create` tasks keep `fileExists` **plus** the diff check, so a task downgraded to
`create` by Track C (whose MAP.md already exists) still needs real evidence.
`FinalizeResult` gains `skippedUnchanged: string[]`.

**First implementation chunk.** The evidence check, the result field, CLI
reporting in `refresh-maps.ts:95-107`, and doctests.

### Track B — finalize runs unconditionally; validate stops gating

**What.** Move `bbx refresh-maps --finalize` out of the agent prompt into a
run-phase shell; set `validate.severity` to `warn`.

**Why this needs to change.** This is the only real convergence defect. Banking
depends on the agent reaching prompt STEP 4 at exactly the moment it has run out
of budget. A run-phase shell has no such dependency
(`engine-run-phase.ts:143-145`, `:225`). Separately, `severity: abort`
(`refresh-maps.procedure.card:165`) turns "there is more to do next run" into a
permanently red step.

**Direction.** In `templates/procedures/refresh-maps.procedure.card`: delete
prompt STEP 4, add a `run.shells` entry, change `severity: abort` → `warn`.

The shell must not introduce a new gate. `engine-step.ts:215` fails a step on any
non-zero run shell **regardless of severity**, and `refresh-maps.ts:89-91` exits 1
when no brief is saved — a state this plan makes *more* likely, since a dead agent
may never have run `--brief`. Two changes together:

- `runFinalize` treats a missing brief as a no-op success (nothing to bank is not
  an error), reserving exit 1 for genuine failures.
- The shell is written plainly (`bbx refresh-maps --finalize`) so a genuine crash
  still surfaces, rather than being masked with `|| true`.

**Hard dependency on Track A.** Making finalize unconditional before the evidence
fix converts "banks nothing" into "falsely banks everything" — strictly worse.

**First implementation chunk.** The `runFinalize` no-op change, the card edit, and
a doctest covering agent-fails-then-shell-banks.

### Track C — the listing stops inventing facts

**What.** `listChildrenAtCommit` returns a `Result` distinguishing a resolved
listing from an unresolvable commit; `MapBrief` grows `anomalies`.

**Why this needs to change.** Demoted from the original plan: this does **not**
fix a deadlock, and the plan no longer claims it does. What it fixes is real but
narrower — with an unresolvable `asOf`, the repro's run 1 reported
`inbox[+3] store[+3]` when the true diff was `+0`. An inflated brief burns the
agent's turn budget (making Track B's failure path more likely) and hides
box-data corruption behind a `console.debug`.

**Direction.**

```ts
export type ListingUnavailable = { reason: "commit_unresolvable"; commit: string };

export async function listChildrenAtCommit(
  opts: ListChildrenAtCommitOptions,
): Promise<Result<string[], ListingUnavailable>>;
```

Discrimination is an affirmative `git rev-parse --verify <commit>^{commit}`,
**not** stderr matching. Commit resolves + `ls-tree` fails ⇒ path genuinely absent
⇒ `ok([])`, silent, correct. Commit does not resolve ⇒ `err(...)`.

`precheck` records a `MapAnomaly { kind: "asof_unresolvable"; dir; asOf }`,
downgrades the task to `create` (with no trustworthy prior state, "regenerate from
the current listing" is the only honest instruction), and logs once at
`console.warn` per `code-style.md`'s level policy. `anomalies` is non-optional so
consumers cannot forget it (#1, #12).

**Vocabulary lock-ins.** `anomalies`; `asof_unresolvable`; `commit_unresolvable`.
Singleton unions so a second cause needs no shape change.

**First implementation chunk.** Signature change + `rev-parse` pre-check + the two
call sites at `precheck.ts:133-144`; then the brief field, downgrade, and CLI
summary line.

## Subplans

None. Each track is a contained change with a settled shape. The one genuinely
open question (below) is a single-bit choice, not a design problem.

## Failure modes

No critical gaps (no row is untested + unhandled + silent).

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Agent exhausts max-turns before finalizing | New doctest: agent writes 1 of 2 maps, shell finalizes | Track B run-shell + Track A evidence | Clear — `finalized N/M` |
| Agent finalizes having done half the work | New doctest (the regression anchor) | Track A diff evidence | Clear — `skippedUnchanged` |
| Agent writes a MAP.md but never commits | Covered by the above; repro shows worktree diff sees it | Track A diffs the working tree | Clear |
| No brief saved when the shell runs | New doctest: `--finalize` with no brief | Track B no-op success | Clear — prints "nothing to finalize" |
| `asOf` commit unresolvable | New doctest: bogus `asOf` → anomaly + `create` | Track C | Clear — `console.warn` + brief + run card |
| Path absent at a *resolvable* `asOf` | New doctest (guards against over-firing) | `ok([])` — correct today | Silent **by design**; repro confirms it converges |
| `rev-parse` pre-check fails (git missing, repo unreadable) | Existing `not_a_repo` doctest at `precheck.ts:81` | Throws → handler at `refresh-maps.ts:144-147` | Clear — infrastructure throws (#5) |
| MAP.md changed by a *concurrent* writer, not the agent | Not tested | None — accepted | Silent. **Documented risk:** `task.head` scopes the window to one procedure run, and `precheck.ts:102-104` bails on a dirty tree, so a concurrent writer is largely excluded upstream. A false-positive stamp costs one stale map until that dir next changes — cheaper than trusting agent self-report. |
| `.bbx-maps-state.json` corrupt | Existing — `state.ts:50-56` | Existing | `console.debug`. Pre-existing; **not in scope** |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **ADDRESSED (N/A by shape).** No agent-authored
  vocabulary; `anomalies` is engine-generated.
- **Stale ref** — **ADDRESSED.** `asOf` is precisely a ref that can go stale;
  Track C detects it, and the repro confirms it is survivable either way.
- **Two agents touching the same card** — **ADDRESSED by existing gating.**
  `precheck.ts:102-104` bails with `uncommitted_work` when the tree is dirty
  (`:99-101` deliberately exempts `procedure/runs/`).
- **Hand-edit drift** — **ADDRESSED.** A hand-edited MAP.md produces a non-empty
  diff and gets stamped — correct. A hand-edited bogus `asOf` now warns loudly
  instead of silently inflating the brief.
- **Fabricated free-form value** — **ADDRESSED.** Track A is exactly this: stop
  trusting "the agent says it did the work", ask git. Honesty becomes structural.
- **Validation error UX** — **ADDRESSED.** Validate stdout gains an anomaly block.
  With `severity: warn` the agent is not resumed with it, so the audience is the
  human reading the run card.
- **Partial migration / transition state** — **ADDRESSED.** No on-disk shape
  change; `state.ts:27-33` schema unchanged. A box mid-wedge self-heals on its
  next run.

## NOT in scope

- **Repairing box-packageify doubled subtrees** — paired issue
  `2026-07-15-box-packageify-doubled-subtrees.md`. Data repair on diverged copies;
  this plan makes refresh-maps survive it, not fix it.
- **Raising `max-turns: 40`** (`refresh-maps.procedure.card:137`) — Track A+B turn
  this from a correctness bug into a throughput knob. Tuning without evidence is
  guessing; filed separately.
- **Health-check surfacing of anomalies** — the brief and run card carry them
  durably. A nagging surface is a separate decision; see Open questions.
- **Strengthening validate's convergence check** — validate greps for
  `"needsWork": true` on a tree `ensureGitClean` has already committed
  (`engine-run-phase.ts:226` before `:255`). Track B makes this non-gating, so its
  weakness stops mattering; genuinely fixing it means teaching validate to
  distinguish its own procedure's writes. Deferred.
- **`severity: review` self-heal** — see Open questions.

## Open design questions

- **`warn` vs `review` for `validate.severity`.** `review`
  (`engine-run-phase.ts:274-289`) resumes the agent once with failure context, but
  a still-failing retry sets `reviewExhausted` and fails the step anyway
  (`engine-step.ts:215`) — reintroducing the red-step complaint on a box that
  needs several runs. **Lean: `warn`.** Track A's ratchet already guarantees
  forward progress per run, which is what `review` would have bought; paying for a
  resumed agent to redo work already banked is cost without benefit.
- **Should a persistent anomaly eventually go red?** With `warn`, a corrupt box
  reports anomalies forever without nagging. **Lean: leave it** — a recurrence
  counter is state we would have to invent, and the prod audit found all seven
  boxes clean, so there is no live incident justifying it.

## Knowledge audits

Skip, with rationale. Tracks A and C are infrastructural — no agent needs to
recall how finalize gathers evidence or how the listing signals ignorance. Track B
*removes* an instruction (prompt STEP 4) rather than adding one, which reduces
what the agent must remember. The box-facing MAP.md authoring convention is
untouched.

Conditional: if `review` is ever chosen over `warn`, the agent would need to act
on `asof_unresolvable`, and that decision should bring a `knows_directly` audit
with it. Recorded rather than deferred silently.

## Implementation order

1. **Track A** — evidence-based stamping. Self-contained.
2. **Track B** — `runFinalize` no-op-on-missing-brief, then the card edit.
   **Hard dependency on A.**
3. **Track C** — `Result` listing, `rev-parse` pre-check, anomalies. Independent;
   last because it is the lowest-value of the three.

## Rollout shape

**Test posture.** Doctests named as part of the design, per `docs/testing.md`:

- `maps-finalize.doctest.md`
  - `update` task whose MAP.md was not rewritten → **not** stamped, reported as
    `skippedUnchanged` *(the regression anchor for the demonstrated bug)*
  - `update` task whose MAP.md was rewritten (uncommitted) → stamped
  - two-run ratchet: partial work run 1, remainder run 2, `asOf` advances
    monotonically per dir and never regresses
  - `--finalize` with no saved brief → no-op success
- `maps-precheck.doctest.md`
  - unresolvable `asOf` → one `asof_unresolvable` anomaly, task downgraded to
    `create`
  - dir added after a *resolvable* `asOf` → no anomaly, all-added `update`
    (guards against over-firing)
  - healthy box → `anomalies` is `[]`

Done-when, as checkable assertions: on a box where the agent rewrites a strict
subset of the briefed maps, `finalize` stamps exactly that subset; and two
successive cycles strictly reduce the task count.

**Knowledge audits.** None land (rationale above).

**Migration.** None. `.bbx-maps-state.json` keeps its schema; wedged boxes
self-heal.

**Issue hygiene.** `2026-07-15-refresh-maps-wedges-on-unresolvable-dir.md` must be
updated or closed when this lands — its stated mechanism is disproven.

**Ship.** Worktree `worktree-refresh-maps-convergence`; commits per track; merge
to main only on the boxholder's explicit signal.
