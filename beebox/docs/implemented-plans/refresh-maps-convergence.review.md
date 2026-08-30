# Plan Engineering Review — refresh-maps convergence

> **Status (2026-07-19):** this review covers the plan's *first* draft. Its
> findings were accepted and the plan was rewritten against them — the diff
> baseline was corrected to a working-tree comparison, the `gitBoxPrefix`
> direction was fixed, the missing-brief exit path was made a no-op, and the
> "validate passes via uncommitted_work" claim was removed as false. The review's
> central challenge — that the plan's reframe was unverified — was settled by
> building the repro, which disproved *both* the issue's mechanism and the
> plan's. Kept as the record of that pass.

Adversarial review of [`refresh-maps-convergence.md`](refresh-maps-convergence.md),
following the `/bbx-plan` review discipline. Every claim below was checked against
the source in this worktree; the git-behavior claims were re-run empirically in a
throwaway repo rather than taken from the plan.

## What already exists

The plan's "What already exists" section is unusually strong — it is the most
accurate section in the document. Verified item by item:

- **`listChildrenAtCommit`** — `src/core/maps/precheck-listing.ts:94`:
  *"export async function listChildrenAtCommit(opts: ListChildrenAtCommitOptions): Promise<string[]> {"*.
  The defect is real. `precheck-listing.ts:113-114`:
  *"console.debug(`git ls-tree ${ref} failed, treating as empty listing:`, e);"* / *"return [];"*.
  Plan's characterization is correct.
- **Per-task finalize** — `finalize.ts:135`: *"for (const task of tasks) {"*, and
  `finalize.ts:147`: *"appliedTasks.push(task);"* with `finalize.ts:152`:
  *"await stampStateForTasks({ boxRoot, tasks: appliedTasks, head });"*. Confirmed:
  finalize already stamps per-task, so the filed issue's second proposed direction
  is already implemented. The plan is right to say so.
- **The `asOf === head` short-circuit** — `precheck.ts:131`:
  *"if (stateEntry.asOf === head) continue;"*. Verbatim match.
- **`Result<T, E>`** — `src/lib/result.ts:31-33`:
  *"export type Result<T, E = string> ="* / *"| { ok: true; value: T }"* /
  *"| { ok: false; error: E };"*. Plan cites `31-34`; the type ends at 33. Trivial drift.
- **Run-phase shells after the agent** — `engine-run-phase.ts:143-145`:
  *"if (!agentResult.success) {"* / *"ctx.writeLine(fmt.fail(`Agent failed: ${agentResult.error}`));"* / *"}"*
  — no rethrow. And `engine-run-phase.ts:225`:
  *"const { runStdout, runFailure } = await runRunShells(params);"*, unconditional.
  Verified.
- **Failed steps still commit** — `engine-step.ts:254-258`:
  *"await stageAll(boxRoot);"* / *"await commit(boxRoot, {"* /
  *"message: `[procedure] ${succeeded ? \"Complete\" : \"Failed\"} step: ${step.id}`,"*.
  Verified — the commit is outside any `if (succeeded)`. The plan correctly
  corrects the filed issue on this point.
- **`severity` vocabulary** — `engine-parse.ts:78`:
  *"severity: step.validate.severity ?? \"warn\","*. Verified. And
  `engine-step.ts:212-213`:
  *"const validationGated ="* / *"validateResult?.status === \"fail\" && step.validate?.severity === \"abort\";"*.
  Verified.
- **`severity: review` self-heal** — `engine-run-phase.ts:274`:
  *"while (validateResult.status === \"fail\" && attempt < MAX_REVIEW_RETRIES) {"*,
  and `engine-run-phase.ts:31`: *"export const MAX_REVIEW_RETRIES: number = 1;"*.
  Verified.
- **`gitBoxPrefix`** — `src/lib/git.ts:116-117`:
  *"export async function gitBoxPrefix(boxRoot: string): Promise<string> {"* /
  *"return (await simpleGit(boxRoot).revparse([\"--show-prefix\"])).trim();"*, used at
  `precheck-listing.ts:103`: *"const prefix = await gitBoxPrefix(boxRoot);"*. Verified.
- **Doctests + `makeTmpBox({ git: true })`** — `test/helpers/doctest-helpers.ts:39`:
  *"export async function makeTmpBox(opts?: { git?: boolean; deps?: boolean }): Promise<TmpBox> {"*,
  and `:57-58`: *"// Git lives at the PACKAGE root (the whole v2 package is one repo)."* /
  *"execSync(\"git init -q && git add -A && git commit --allow-empty -m init -q\", {"*.
  Verified — and this matters more than the plan notices, because it means every
  doctest box has a non-empty `gitBoxPrefix` of `content/` (see Finding 4).

What the section **omits** and should have covered, because the plan depends on it:

- **`ensureGitClean` runs *after* the run shells** — `engine-run-phase.ts:225-231`:
  `runRunShells(params)` on 225, then *"let gitRef = await ensureGitClean({"* on 226.
  This ordering is load-bearing for Track 3 and Track 4 and is never cited.
- **A non-zero run shell fails the step objectively** — `engine-run-phase.ts:171-179`
  and `engine-step.ts:215`:
  *"status: runFailure !== undefined || validationGated || reviewExhausted ? \"failed\" : \"completed\","*.
  Track 4 moves a command into `run.shells` without citing this.
- **The brief is persisted to disk and re-parsed in a separate process** —
  `refresh-maps.ts:43-50` (`saveBrief`) and `:52-63` (`readSavedBrief`), guarded by
  `refresh-maps.ts:39-41`:
  *"return isRecord(value) && typeof value[\"needsWork\"] === \"boolean\" && Array.isArray(value[\"tasks\"]);"*.
  This is a parse boundary that Track 2's shape change crosses.

## Prior art (external) — verified

I re-ran the plan's two load-bearing git claims in a scratch repo rather than
trusting them.

- **"`git ls-tree` cannot distinguish the two failure cases"** — **confirmed.**
  A valid commit with an absent path and a wholly bogus commit both produced
  exit 128 and the same message shape (`fatal: Not a valid object name <rev>:<path>`).
  The plan's correction of the initial search result is right, and its decision
  not to attempt stderr matching is well founded.
- **"`git rev-parse --verify <sha>^{commit}` is the reliable discriminator"** —
  **confirmed as a discriminator, but the plan's exit code is wrong.** The plan
  says *"exit 0 for a resolvable commit, exit 1 for an unresolvable one."* Measured:
  exit 0 resolvable, **exit 128** unresolvable. See Finding 10.
- **Historic `ls-tree` exit-0 bug, `--full-tree` rationale, "error hiding",
  Sentinel Object, high-water mark** — these are appropriate, correctly
  characterized, and genuinely used to justify design choices rather than
  decorating them. The `--full-tree` citation correctly defends
  `precheck-listing.ts:96-105` as written.
- **"No prior art found" for the three-way absent/unknown/error split** — recording
  the gap explicitly is the right move under the skill's "empty searches are
  findings" rule. I did not find a canonical name either.

The one prior-art *gap*: the plan searched git semantics for `ls-tree` but never
searched or verified `git diff`'s semantics, which is the mechanism Track 3
actually introduces. That omission is where the plan's most serious defect lives
(Finding 1).

## Stated preferences this plan trades against

The section is well constructed and the principle numbering is accurate against
`docs/engineering-principles.md` (#1 types are structure, #3 validate at
boundaries, #4 resilient AND never silent, #5 failure paths in signatures, #6
right-sized defensiveness, #10 testability is architectural, #12 the maintainer
is usually an agent — all confirmed at their cited headings).

The precedent claim is correct: `engine-parse.ts:78` does default `severity` to
`"warn"`, and `"warn"` is a legal enum member — `src/schemas/procedure.ts:47`:
*"severity: z.enum([\"warn\", \"review\", \"abort\"]).optional(),"*. **Track 4's
schema premise is sound.** This was the specific thing I was asked to attack and
it survives.

What the section does *not* trade against, and should: `code-style.md`'s
"A default may only replace a value the type system says can be absent. `?? x` on
a required field is a type-system lie — fix the type instead." Track 2 makes
`anomalies` required on a type that is round-tripped through JSON on disk. See
Finding 7.

## Failure modes

The plan's table is genuinely filled in, not perfunctory, and the "documented
risk" row for unrelated-diff false positives is honest work. Three rows are
wrong or missing:

- **Row "Agent writes a MAP.md but never commits"** claims
  *"`git diff asOf..HEAD` sees nothing → not stamped; engine's `stageAll`
  (`engine-step.ts:254`) commits it, next run stamps"*. The mechanism is right,
  but the plan does not notice that this row describes the *normal* Track 4 case,
  not an edge case — see Finding 1.
- **No row for "the finalize run shell itself exits non-zero."** Track 4 creates
  this codepath and it hard-fails the step. See Finding 6.
- **No row for "the agent invocation throws rather than returning
  `success: false`."** The plan's Track 4 safety argument depends on shells
  running after the agent; a throw from `runRunAgents` at
  `engine-run-phase.ts:224` skips line 225 entirely. Verified there is no
  `try`/`catch` around it. In fairness to the plan, the *specific* case it names
  — max-turns — does not throw: `src/core/agent/run.ts:121`:
  *"const isError = resultMessage.is_error || resultMessage.subtype !== \"success\";"*
  and `:143`: *"return { ...base, success: false, error };"*. So max-turns
  returns `success: false` and is absorbed as the plan claims. The unhandled-throw
  path is narrower than a wedge but is an untested + unhandled row that belongs in
  the table.

## Agent-flow / user-flow edge cases

All seven scenarios are present and none is dismissed with a bare "N/A" — the
section clears the skill's perfunctory-filling bar. Two entries do not survive
checking:

- **"Hand-edit drift — ADDRESSED."** The claim that a hand-edited MAP.md makes
  `git diff` non-empty is only true once the hand edit is *committed*. Same root
  cause as Finding 1.
- **"Validation error UX — ADDRESSED."** Fine as far as it goes, but it asserts
  the validate stdout lands somewhere a human reads without citing where. The
  run card is the implied destination (`engine-step.ts:238-249` does write
  `validate.stdout` into the step update), so this one is defensible — I am
  noting it as thinly cited rather than wrong.

"Partial migration / transition state — ADDRESSED … `.bbx-maps-state.json` keeps
its schema (`state.ts:27-33`)" is verified correct — `state.ts:27-33` is exactly
`MapStateEntrySchema` and `MapStateSchema`, and Track 2 touches neither. But the
section only considers the *state* file's transition and ignores the *brief*
file's, which Track 2 does change (Finding 7).

## Findings

### Track 3's diff range cannot see the agent's work, so finalize would stamp nothing

**Location in plan:** Track 3 — "Direction"
**Citation:** Plan: *"git diff --name-only <task.asOf> HEAD -- <repoRel(task.map)>"* and *"Non-empty → rewritten → stamp. Empty → untouched → leave for the next run."*
Source, `finalize.ts:11-13`: *"No git commit here — the procedure engine's \"Complete step\" commit sweeps these changes into the same commit as the agent's MAP.md writes."*
Source, `engine-run-phase.ts:225-226`: *"const { runStdout, runFailure } = await runRunShells(params);"* then *"let gitRef = await ensureGitClean({"*.
**Issue:** `git diff <a> HEAD` compares two *commits*. It is blind to the working tree. Finalize runs before `ensureGitClean`, so at finalize time the agent's MAP.md writes are uncommitted unless the agent itself committed them (prompt STEP 3, `refresh-maps.procedure.card:109-122`). I verified the semantics empirically: with an uncommitted modification to `a.txt`, `git diff --name-only <commit> HEAD -- a.txt` printed nothing, while `git diff --name-only <commit> -- a.txt` printed `a.txt`.
**Why it matters:** This is precisely inverted against Track 4's purpose. Track 4 exists so that finalize still banks progress *when the agent failed or ran out of turns* — and an agent that failed is exactly the agent that never reached its commit step. In that scenario every task's diff is empty, every task lands in `skippedUnchanged`, and the run banks **nothing**. The plan's headline Track 4 doctest — *"a doctest asserting finalize banks partial work after a simulated agent failure"* — cannot pass as designed. Worse, the two tracks interlock into a regression: today the agent's in-prompt finalize at least stamps when it does run; after Tracks 3+4 the common failure path stamps zero.
**Suggested action:** Change the evidence range to compare the recorded `asOf` against the **working tree**, not HEAD (`git diff --name-only <asOf> -- <path>`, or `git status --porcelain` unioned with a committed-range diff). Then re-derive the ratchet argument — the "run 1 banks 15, run 2 banks 15" story in the plan needs to be restated against whichever range is chosen. Add a doctest that writes a MAP.md **without committing** and asserts it is stamped.
**Traces to preference:** Principle #4 (resilient AND never silent) — an evidence check that silently reports "no evidence" for the exact case it was written to detect is a fallback that manufactures a wrong answer, the same class of defect Track 1 sets out to remove.

### Track 2's update→create downgrade routes anomalous dirs back into the no-op guard Track 3 removes

**Location in plan:** Track 2 "Direction" interacting with Track 3 "Direction"
**Citation:** Plan, Track 2: *"An unresolvable `asOf` downgrades that directory's task from `update` to `create`."*
Plan, Track 3: *"`create` tasks have no `asOf`; those keep the existing `fileExists` check, which is correct evidence for that action."*
Plan, Track 3, on that same check: *"for `action: \"update\"` tasks the MAP.md *already exists, untouched*. So the guard is a no-op for exactly the case it was written for."*
**Issue:** A downgraded task is a `create` in name only — its MAP.md exists on disk, because the directory was previously mapped (that is what having a state entry with an `asOf` means). So `fileExists(mapAbs)` at `finalize.ts:142` (*"if (!(await fileExists(mapAbs))) {"*) returns true immediately and the task is stamped whether or not the agent touched it. The plan's own sentence — the `fileExists` guard is a no-op when the map already exists — applies verbatim to downgraded tasks, but the plan asserts the opposite ("correct evidence for that action") without citation.
**Why it matters:** The anomalous directories are the ones the plan says drive the wedge and are the ones most likely to be left unfinished by a turn-exhausted agent. Tracks 2 and 3 combine to preserve the false-stamping hole precisely there — and false-stamping an anomalous dir sets `asOf = head`, which makes the anomaly *disappear* on the next run with a stale MAP.md left behind and no anomaly recorded. That is a new silent-corruption path the plan creates.
**Suggested action:** Decide explicitly what evidence a downgraded task carries. Options: keep the original `asOf` on the task (as a separate field from `action`) so the diff check still applies; or track "was this map present before the run" and require a content change for any task whose map pre-existed, regardless of `action`. Either way the plan must stop treating `action` as a proxy for "the map did not exist."
**Traces to preference:** Principle #1 (types are structure) — overloading `action: "create"` to mean both "no map on disk" and "map on disk but untrustworthy prior state" is the same value-collision the plan diagnoses in `listChildrenAtCommit`'s `[]`.

### The reframe contradicts the filed issue's repro and is asserted without evidence

**Location in plan:** "Tracks / scope" — the opening reframe
**Citation:** Plan: *"the wedge is per-commit, not per-directory. A directory legitimately absent at a *resolvable* `asOf` is not an anomaly at all … the agent writes a MAP.md, finalize stamps, and it converges. The pathological case is an **unresolvable `asOf` commit**"*.
Issue, `issues/bugs/2026-07-15-refresh-maps-wedges-on-unresolvable-dir.md`: *"any directory present on disk but absent from git at the stored `asOf` triggers it"* and *"The precheck lists a directory's children at `asOf` via `git ls-tree --full-tree <asOf>:<repoRelPath>` … When that ref doesn't resolve … the catch **treats it as an empty listing**"*.
**Issue:** The filed issue describes a *resolvable commit with an absent path*. The plan classifies exactly that case as "not an anomaly at all" and gives it `ok([])` — byte-identical behavior to today. So Tracks 1 and 2 change nothing for the only failure that was actually observed. The plan's substitute hypothesis (an unresolvable commit hitting all dirs at once) is offered with no citation, no repro, and no evidence from the affected box; it is a second unverified theory replacing the issue's first unverified theory.
**Why it matters:** The plan orders its tracks around this reframe (*"this is why … Track 3 (the ratchet) is load-bearing rather than a nicety"*). If the reframe is wrong, half the plan's implementation budget goes to a case that has never been seen, while the observed case is unchanged. The plan is also right that the issue's causal chain is broken — it correctly shows via `engine-step.ts:254-258` that a failing step still commits, and finalize lives in the *agent's prompt* (`refresh-maps.procedure.card:124-127`), so "the step failed therefore finalize never ran" is false. But having demolished the issue's mechanism, the plan owes a verified replacement, not another guess.
**Suggested action:** Before committing to the ordering, establish what actually happened on the affected box — inspect its `.bbx-maps-state.json` `asOf` values and run `git rev-parse --verify <asOf>^{commit}` against each. If the commits resolve, the reframe is falsified and Track 2's anomaly will never fire in production; the plan should then say so and justify Tracks 1–2 on their own merits (honest signatures) rather than as the wedge fix.
**Traces to preference:** The skill's citation discipline — *"If you say 'this case can't happen because Y handles it,' cite the line where Y handles it"*; the plan's central scoping claim is exactly the kind of assertion that needs verification rather than reasoning.

### `repoRel(task.map)` applies a prefix that `git diff` pathspecs must not have

**Location in plan:** Track 3 — "Direction"
**Citation:** Plan: *"git diff --name-only <task.asOf> HEAD -- <repoRel(task.map)>"*.
Source, `precheck-listing.ts:96-104`: *"`<commit>:<path>` is interpreted relative to the CWD when git runs inside a subdirectory of the repo … `--full-tree` pins the path to the repo root, and we spell it out repo-root-relative by prefixing the box's in-repo path (`content/`)"*.
**Issue:** The prefix treatment at `precheck-listing.ts:103-104` exists because `--full-tree` forces `<rev>:<path>` to be interpreted from the repo root. `git diff` has no `--full-tree`; its pathspecs are **CWD-relative** by default. Since `simpleGit(boxRoot)` runs with the box root as CWD (`content/` on a v2 box), passing a repo-relative `content/inbox/MAP.md` would be resolved as `content/content/inbox/MAP.md` and match nothing. The correct pathspec is the plain box-relative `task.map`. There is also no `repoRel` helper in the codebase — the name in the plan refers to nothing that exists.
**Why it matters:** This fails *silently and universally on v2 boxes* — the only shape that exists per `CLAUDE.md` — while passing on any test that happens to run at the repo root. Combined with Finding 1 it means nothing is ever stamped, with no error. And `makeTmpBox` boxes are v2 (`doctest-helpers.ts:52`: *"const root = join(packageRoot, \"content\");"*), so a doctest *would* catch it — if the doctest exercises the prefix path, which the plan's test list does not name.
**Suggested action:** Drop the prefix. Name the exact pathspec form in the plan (`task.map`, box-relative, with `simpleGit(boxRoot)`), and add an explicit note that the `gitBoxPrefix` treatment is `ls-tree --full-tree`-specific and must not be copied. Add a doctest assertion that the evidence check works on a `makeTmpBox({ git: true })` box, since those are always v2.
**Traces to preference:** Principle #3 (validate at boundaries) — the git subprocess is a boundary whose argument conventions differ per subcommand; assuming one subcommand's path convention transfers to another is exactly the boundary error the principle exists to catch.

### "Validate passes because finalize leaves the tree dirty" is uncited and contradicted by the engine's ordering

**Location in plan:** "NOT in scope" — *"Reworking validate's `uncommitted_work` pass-by-accident"*
**Citation:** Plan: *"validate currently passes because finalize leaves the tree dirty (`precheck.ts:102`), not because convergence was verified."*
Source, `engine-run-phase.ts:226`: *"let gitRef = await ensureGitClean({"* — which runs before validation is invoked at `engine-run-phase.ts:255`: *"let validateResult = await validate(gitRef);"*. And `engine-phase.ts:173-175`: *"if (!gitStatus.clean) {"* / *"// Fallback commit — the agent didn't commit its own work"* / *"await stageAll(boxRoot);"*.
**Issue:** The tree is committed clean by `ensureGitClean` *before* validate runs. Validate's `bbx refresh-maps --brief` therefore does not hit the `uncommitted_work` bail at `precheck.ts:102-104`; it runs a real precheck. The plan's stated reason for deferring this item is factually wrong.
**Why it matters:** A NOT-in-scope entry is a decision, and this one is justified by a mechanism that does not exist. If validate is in fact doing a genuine convergence check, the plan's framing of Track 4 ("validate keeps reporting residual work … it just no longer fails the step") is describing a *real* signal being downgraded to a warning, which is a bigger trade than the plan admits.
**Suggested action:** Re-derive what validate actually observes today (trace `ensureGitClean` → `executeValidation` → the card's validate shell at `refresh-maps.procedure.card:146-152`) and either rewrite the deferral rationale or promote the item into scope.
**Traces to preference:** Principle #4 (never silent) plus the skill's citation discipline — a deferral defended by an unverified mechanism hides a decision behind a wrong fact.

### Moving finalize into `run.shells` makes finalize failures gate the step harder than today

**Location in plan:** Track 4 — "Direction"
**Citation:** Plan: *"delete prompt STEP 4, add `run.shells` with `bbx refresh-maps --finalize`, change `validate.severity` from `abort` to `warn`."*
Source, `engine-run-phase.ts:171-179`: *"if (result.exitCode !== 0 && !result.skipped) {"* … *"runFailure: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },"*.
Source, `engine-step.ts:215`: *"status: runFailure !== undefined || validationGated || reviewExhausted ? \"failed\" : \"completed\","*.
Source, `refresh-maps.ts:89-91`: *"if (!brief) {"* / *"console.error(\"refresh-maps: no saved brief; run 'bbx refresh-maps --brief' first.\");"* / *"process.exit(1);"*.
**Issue:** A non-zero run shell fails the step unconditionally, and `severity: warn` does not soften it — the two gates are independent in `engine-step.ts:215`. `bbx refresh-maps --finalize` exits 1 whenever the saved brief is absent, and the brief is deleted on every successful finalize (`refresh-maps.ts:94`: *"await deleteSavedBrief(boxRoot);"*). The plan discusses the `severity` change at length and never mentions that it has simultaneously introduced a *new*, harder gate on the same step.
**Why it matters:** The user-visible complaint the plan sets out to fix is "the step goes permanently red." Track 4 removes one red-step cause and adds another, in a codepath (missing brief after an interrupted or re-entered run) that is more likely on exactly the wedged boxes this plan targets. The Failure-modes table has no row for it.
**Suggested action:** Decide and state the intended behavior when finalize has nothing to do — most likely `--finalize` should exit 0 (or `$CHECK_SKIP`) on a missing brief rather than 1, which is a `refresh-maps.ts` change the plan does not currently include. Add a Failure-modes row for a non-zero finalize shell.
**Traces to preference:** Principle #5 (failure paths visible in signatures where callers branch) — moving a command across a phase boundary changes who branches on its exit code, and that change belongs in the plan's Direction rather than being inherited silently.

### `MapBrief.anomalies` is made non-optional across a JSON round-trip boundary

**Location in plan:** Track 2 — "Direction"
**Citation:** Plan: *"anomalies: MapAnomaly[];   // always present; empty on a healthy box"* and *"`anomalies` is non-optional so consumers can't forget it exists (#1, #12)."*
Source, `refresh-maps.ts:39-41`: *"return isRecord(value) && typeof value[\"needsWork\"] === \"boolean\" && Array.isArray(value[\"tasks\"]);"*
Source, `refresh-maps.ts:56`: *"return isMapBrief(parsed) ? parsed : null;"*.
**Issue:** `MapBrief` is not an in-memory-only type: it is serialized to `.beebox/refresh-maps-brief.json` in one process and parsed back in another via a hand-written predicate that does not check `anomalies`. A brief written before the change (or by a partially-rolled-out box) narrows to `MapBrief` with `anomalies === undefined` while the type promises an array. Any `brief.anomalies.length` on that value throws.
**Why it matters:** `code-style.md` calls this out directly: *"A default may only replace a value the type system says can be absent. `?? x` on a required field is a type-system lie — fix the type instead."* The plan asserts the non-optional shape is safe on principle #1 grounds without citing the parse boundary that makes it unsafe. The plan's Agent-flow section explicitly claims *"No on-disk shape change"* — but the brief file's shape does change.
**Suggested action:** Extend `isMapBrief` to require `anomalies`, or parse the brief with a real Zod schema at that boundary (principle #3), and say in the plan which. Add the brief file to the "Partial migration / transition state" entry.
**Traces to preference:** Principle #3 (validate at boundaries) — the brief file is disk data crossing a process boundary, and the plan currently treats it as trusted interior state.

### The evidence diff is undefined when `asOf` doesn't resolve — the case the plan is about

**Location in plan:** Track 3 — "Direction"
**Citation:** Plan: *"For each task, stamp only if the map changed between the task's recorded `asOf` and current HEAD"*.
Source, `precheck.ts:156`: *"asOf: stateEntry.asOf,"* — the task's `asOf` is copied straight from the state file with no validation.
**Issue:** `git diff <unresolvable> HEAD` fails, and the plan never says what finalize does with that failure — stamp, skip, throw, or warn. The plan's only mitigation is Track 2's downgrade, which strips `asOf` — but Track 3 is explicitly declared *"Independent of 1–2 in code"* in the Implementation order, meaning Track 3 must be correct standing alone, and during the interval between Track 3 landing and Track 4 landing, Track 2's downgrade may or may not be in place depending on how the chunks are committed.
**Why it matters:** An unhandled subprocess failure inside a per-task loop either throws and aborts finalize for every remaining task (losing all banking — the exact wedge) or gets caught and defaulted, reintroducing the invented-fact pattern Track 1 exists to remove.
**Suggested action:** State the behavior explicitly in Track 3's Direction: an unresolvable `asOf` at finalize time is an anomaly, not an error to swallow — most likely reuse Track 1's `rev-parse` pre-check and treat the task as unstampable-with-a-warning. Note this makes Track 3 depend on Track 1, contradicting the current "independent of 1–2" claim.
**Traces to preference:** Principle #4 (never resilient to the impossible) — a `git` failure inside the evidence check must not be absorbed into a boolean, which is the same defect at a new call site.

### Track 3 is declared independent of Track 1 but shares its failure surface

**Location in plan:** "Implementation order", item 3
**Citation:** Plan: *"**Track 3** — evidence-based stamping; `skippedUnchanged`. Independent of 1–2 in code, but sequenced here because Track 4 requires it."*
**Issue:** The plan asked me to look for an ordering hazard beyond the stated Track 4 → Track 3 dependency, and this is it. Track 3 introduces a second consumer of a possibly-unresolvable commit ref (Finding 8) and a second consumer of the `action` field's meaning (Finding 2). Both couple it to Track 1 and Track 2 respectively. A further hazard: Track 2 changes what `tasks[]` contains (downgraded actions, missing `asOf`) and that array is what Track 3's loop iterates — so landing Track 3 first means its doctests encode `update` tasks that Track 2 will later reclassify, and those doctests will need rewriting rather than standing as regression anchors.
**Why it matters:** The plan's ordering rationale is the one place a reader checks before starting work. An "independent" label on a track with two hidden couplings invites a chunk to land in a state where its own doctests describe behavior the next chunk changes — which `docs/testing.md`'s "tests as a design tool" framing is specifically meant to avoid.
**Suggested action:** Re-state the dependency graph: Track 3 depends on Track 1 (for ref resolvability) and interacts with Track 2 (for `action` semantics). Either sequence 1 → 2 → 3 → 4 with the couplings named, or make Track 3's evidence check independent of both by keying on something other than `action`.
**Traces to preference:** Principle #10 (testability is architectural) — a chunk whose tests must be rewritten by the next chunk was not decomposed along a real seam.

### Prior-art exit code for `rev-parse` is wrong

**Location in plan:** "Prior art (external)"
**Citation:** Plan: *"**`git rev-parse --verify <sha>^{commit}` is the reliable discriminator.** Verified in the same run: exit 0 for a resolvable commit, exit 1 for an unresolvable one."*
**Issue:** Measured in a scratch repo: exit 0 for a resolvable commit, **exit 128** for an unresolvable one. The plan's stated verification produced a different number than a re-run does.
**Why it matters:** Small on its own — the implementation should branch on zero/non-zero, not on the specific code — but the plan presents this as an empirically verified result, and one of its two verified results is wrong. That weakens the "verified directly on git in this environment" framing that the neighboring `ls-tree` claim (which I confirmed) rests on.
**Suggested action:** Correct the number, and state in Track 1's Direction that the check branches on non-zero rather than on `1`, so nobody encodes the wrong constant.
**Traces to preference:** The skill's citation discipline — *"'Probably handled' / 'likely tested' … are not claims, they're guesses. Either verify or flag as unverified."* A misreported verification is worse than an unverified one because it discourages re-checking.

### The validate shell's own comment is false, and the plan preserves it unexamined

**Location in plan:** Track 4 — *"Validate keeps reporting residual work and anomalies in its stdout"*
**Citation:** Source, `refresh-maps.procedure.card:143-144`: *"# Use --brief (not the bare command) so we don't re-save the brief file."*
Source, `refresh-maps.ts:123-129`: *"await saveBrief(boxRoot, brief);"* — placed **before** the `if (options.brief)` branch at 125, so both modes save.
**Issue:** The comment's stated rationale is wrong: `--brief` re-saves the brief exactly like the bare command. Under Track 4 this acquires consequence — the run shell's finalize deletes the brief (`refresh-maps.ts:94`), then the validate shell immediately writes a fresh one, leaving a stale brief on disk after every run. The plan keeps this shell verbatim and never inspects it.
**Why it matters:** A leftover brief is the input to the next `--finalize`. Combined with Finding 6's exit-1-on-missing-brief, the file's lifecycle is now load-bearing for whether the step goes red, and it is currently governed by a comment that misstates what the code does.
**Suggested action:** Fix the comment and decide the brief file's lifecycle explicitly under the new phase ordering — a short "brief file lifecycle" paragraph in Track 4 covering write (precheck), read+delete (run shell), re-write (validate).
**Traces to preference:** `CLAUDE.md`'s *"Read before writing. Don't guess file formats"* — the plan reused a shell block on the strength of its comment rather than its code.

### Minor citation drift

**Location in plan:** "What already exists"
**Citation:** Plan cites *"`precheck-listing.ts:113`: \"console.debug(…); return [];\""* (the `return []` is on 114); *"`finalize.ts:118-122` claims"* (the quoted docstring runs 119-122); *"`src/lib/result.ts:31-34`"* (the type ends at 33); *"`engine-run-phase.ts:143-145` logs `Agent failed` and returns rather than throwing"* (143-145 logs; the return is at 148, and the "rather than throwing" property is an absence, not a line).
**Issue:** Each is off by one line or attributes a property to a line range that doesn't contain it. None changes a conclusion.
**Why it matters:** Line citations are how the next reader re-verifies a claim cheaply. Systematic off-by-one erodes that, and the plan's citation quality is otherwise high enough that the drift is worth correcting rather than tolerating.
**Suggested action:** Widen the ranges to include the quoted text; for "returns rather than throwing," cite `engine-run-phase.ts:148` (*"return { sessionId };"*) or say explicitly that the claim rests on the absence of a `try`/`catch` in `runAndValidate` around line 224.
**Traces to preference:** Principle #12 (the maintainer is usually an agent) — an agent re-reading a cited range gets the wrong window and may conclude the claim is unsupported.

## NOT in scope (verified)

The section clears the skill's special-rule gate (the plan touches multiple
modules and has a transition state, and the section is substantive rather than
empty). Checking each deferral:

- **Repairing box-packageify doubled subtrees** — legitimately separate; the paired
  issue exists at `issues/bugs/2026-07-15-box-packageify-doubled-subtrees.md`.
  Rationale holds.
- **Raising `max-turns: 40`** — verified at `refresh-maps.procedure.card:137`:
  *"max-turns: 40"*. The reasoning ("tuning a knob without evidence is guessing")
  is sound. However it depends on Track 3 actually converting the correctness bug
  into a throughput knob, which Finding 1 puts in doubt.
- **Health-check surfacing of anomalies** — reasonable deferral, cross-referenced
  to Open questions as the skill requires.
- **Reworking validate's `uncommitted_work` pass-by-accident** — **rationale is
  factually wrong**; see Finding 5.
- **Migrating `console.debug` call sites in `state.ts`** — consistent with
  `code-style.md`: *"Existing call sites migrate opportunistically as you touch
  them, not in a sweep."* Verified at `state.ts:53`: *"console.debug(\"Map state unreadable, starting fresh:\", e);"*. Clean.

## Things I checked and found clean

Explicitly covered and found no problem with:

- **`warn` is a legal `severity`** — `src/schemas/procedure.ts:47` confirms the
  enum contains it, `engine-parse.ts:78` confirms it is already the default, and
  `engine-step.ts:212-213` confirms only `abort` gates. Track 4's schema premise
  is fully sound. This was the sharpest attack requested and the plan survives it.
- **The `fileExists` no-op claim** — the plan's most alarming assertion is **true**.
  `finalize.ts:142` guards on `fileExists(mapAbs)`; for an `update` task the map
  exists by construction (`precheck.ts:117` routes `!mapExists` to `create`), so
  the guard passes unconditionally and `finalize.ts:152` stamps every applied task
  at `head`. The plan's diagnosis is correct and the docstring at
  `finalize.ts:119-122` does over-promise. The *fix* is where the problems are, not
  the diagnosis.
- **Max-turns does not throw** — `src/core/agent/run.ts:121` and `:143` show a
  non-success SDK subtype becomes `success: false`, and
  `engine-run-phase.ts:143-145` absorbs it without rethrowing. Track 4's core
  safety claim holds for the specific case it names.
- **Failed steps commit** — `engine-step.ts:254-258` is outside any success
  branch; the plan's correction of the filed issue is right.
- **`ls-tree` cannot discriminate the two failures** — re-run empirically;
  confirmed identical exit 128 and identical message shape. The plan's rejection
  of stderr matching is well founded.
- **Doctest writability** — `makeTmpBox({ git: true })` (`doctest-helpers.ts:39, 56-62`)
  gives a real git repo with `write`/`read`/`commitAll`, and
  `test/helpers/fake-agent.ts` supports scripting a failing invocation via its
  `act` outcome (`FakeActOutcome.success?: boolean`). Every doctest the plan names
  is writable with existing helpers, with the exception of the Track 4
  agent-failure test, which is blocked by Finding 1 rather than by tooling.
- **Template completeness** — all mandatory sections are present (Header, Stated
  preferences, What already exists, Prior art, Tracks/scope, Subplans, Failure
  modes, Agent-flow edge cases, NOT in scope, Open design questions, Knowledge
  audits, Implementation order, Rollout shape). None is filled with a bare "N/A";
  the Subplans and Knowledge-audits skip-with-rationale entries both give a real
  *why*, which is what the skill asks for.
- **`code-style.md` mechanical rules in the proposed signatures** — checked
  `listChildrenAtCommit(opts: ListChildrenAtCommitOptions): Promise<Result<…>>`
  and the `MapAnomaly` / `MapBrief` shapes against max-2-positional-params, no
  default parameters, no `as`, explicit return types on exports, and file/function
  line caps. All clean. `precheck-listing.ts` at 161 lines has ample headroom under
  the 300-line cap for the `rev-parse` addition.
- **`Result<T, E>` is the right convention** — `src/lib/result.ts:31-33` is the
  single Result shape, and `code-style.md`'s *"Return a `Result<T, E>` … when
  callers genuinely branch on *why* it failed"* applies: `precheck.ts:133-144` does
  dispatch on the cause under Track 2. Principle #5 tracing is correct.
- **`.bbx-maps-state.json` needs no migration** — `state.ts:27-33` schema is
  untouched by every track. The plan's "Migration: None" is correct *for the state
  file*; the brief file is the gap (Finding 7).
- **The `procedure/runs/` dirty-path exemption** — `precheck.ts:99-101` and the
  filter at `:101` are as the plan describes; the "Two agents touching the same
  card" entry is accurate.
- **Numeric scoring** — the plan contains none, correctly following the skill's
  no-scoring rule.

Not covered: I did not exercise the plan against a real wedged box, did not run
the existing maps doctests, and did not review `engine-phase.ts`'s
`executePhaseShells` beyond its exit-code contract.
