---
title: "Procedure validation completion (D5)"
status: implemented
workstream: unknown
issues: []
---
# Procedure validation completion (D5)

> **Status: IMPLEMENTED (2026-06-27).** Tracks 1 (model-evaluated instruction
> validation) and 2 (`severity: review` auto-retry) — this plan's scope — shipped.
> Implementation: `engine-validate-model.ts` (`evaluateInstructions`),
> `engine-run-phase.ts` (`runAndValidate` + the run-phase split), wired through
> `engine-phase.ts`/`engine-step.ts`; the `validate.model` schema field in
> `schemas/procedure.ts`. Present-tense reference docs live in
> `docs/procedure-implementation.md` and the generated procedure guide. Two
> `knows_directly` knowledge audits (`procedure-instructions-gate`,
> `procedure-review-severity`) were run and pass. **Track 3 (resumable runs)** was
> always scoped as a separate follow-up plan and remains unbuilt — see the Tracks
> section. This document is kept as the frozen design record (incl. the Codex review
> findings folded in).

The procedure engine's `validate` phase has three documented gaps: model-evaluated
`instructions:` are a no-op (pass-by-default), `severity: review` auto-retry is
unimplemented (downgrades to `warn`), and a failed run can't be resumed from the
failing step. This plan closes the first two as one coupled change and scopes the
third as a separable follow-up. The goal is to make `instructions:` and `review`
actually gate — matching what the schema docs already promise once corrected — while
keeping the one path that gates today (`shells:` + `severity: abort`) behaving
exactly as it does now.

## Stated preferences this plan trades against

The applicable principle docs and the specific principles each finding traces to:

- **`beebox/CLAUDE.md`** —
  - `:` *"Services — Every external dependency is wrapped in a typed interface with real + fake implementations. Fakes have observable state for testing."* The review model is an external dependency; it must be fakeable. The existing `createAgent` factory seam (`ProcedureOptions.createAgent`) is that interface here.
  - *"Read before writing. Don't guess file formats... read the existing code, read the test patterns."*
  - *"don't add features beyond what the task requires"* (the "Improving These Instructions" / scope discipline throughout) — bounds the context we assemble for the model and the retry knobs we add.
  - *"Treat noisy command output as a bug"* (monorepo `CLAUDE.md`) — model calls and retries must stay quiet on the happy path.
  - *"Keep source and docs generic — never hardcode personal names."*
- **`beebox/code-style.md`** — no `any`; no default parameters; max 2 positional params (named-params objects); custom error classes, not `new Error()`; files ≤300 lines, functions ≤150; only export what's used.
- **`docs/testing.md`** — tests come first as a design tool; cover substantial codepaths, not coverage-for-its-own-sake.
- **Most recent shipped precedent: the retro integration** (`src/core/retro/`) and the project stance the briefing names — *"Arrange context, don't automate judgment"* (`memory/feedback_arrange_context_not_automate_judgment.md`): judgment stays in the model; the engine only assembles inputs. Do **not** try to make instruction validation deterministic.
- **Schema-doc-accuracy precedent**: `src/schemas/procedure.ts:81-85` and the procedure guide generator currently document these as *not implemented*. Whatever we implement, those docs flip from accurate to wrong unless updated in the same change.

## What already exists

- **`executeValidation`** — `src/core/procedure/engine-phase.ts:64-122`. Runs `shells`, then has the two stubs: `:92-104` (`// TODO: Invoke review model with instruction + git diff + why` … *"instruction checks pass by default"*) and `:107-111` (`// TODO: Re-invoke agent with failure context` … *"downgrade to warn and continue"*). **Rebuild** the stubs; **keep** the `shells` path (`:75-89`) byte-for-byte in behavior.
- **Agent invocation with structured output** — `src/core/agent.ts:122-136` `invokeStructured<T>(schema, opts)` already exists and returns a Zod-validated `data`. The instruction-validation verdict is exactly this shape. **Reuse**; do not build a new model client.
- **Fakeable agent factory, already threaded** — `ProcedureOptions.createAgent` (`engine-types.ts:28`) → `runSteps` (`engine.ts:113`) → `executeStep` (`engine-step.ts:46`) → `runRunPhase` (`engine-step.ts:231`). The seam reaches the run phase but **not** `executeValidation` today — that's the wiring gap to close. **Reuse** the seam; extend its reach.
- **The fake agent** — `test/helpers/fake-agent.ts:103-107`: `invokeStructured` deliberately throws *"extend the fake when a structured-output test arrives."* That arrival is now. **Extend** it.
- **Git diff helpers** — `src/cli/lib/git.ts:406` `getCommitDiff(boxRoot, hash)` (diff of a **single** commit vs its parent) and `:295` `getDiff`. **Caveat that drives Track 1's design:** `gitRef` is *not* a reliable "whole step diff." `ensureGitClean` returns `getHead(boxRoot)` when the tree is already clean (`engine-phase.ts:165-166`), so when an agent makes **multiple** commits, `gitRef` is only the *last* one and `getCommitDiff(gitRef)` shows only that commit. So we **do not** reuse `getCommitDiff(gitRef)` as-is; Track 1 captures a baseline ref before the run phase and diffs `baseline..finalRef` (see Track 1 Direction). The helpers are reused at the range level (`getDiff` / a range diff), not the single-commit level.
- **Run-card `review` field** — `RunStepValidate` (`schemas/procedure-run.ts:28-32`) already has an optional `review: z.string()`, plumbed through `StepUpdate.validate.review` (`engine-types.ts:64`) and `applyStepUpdate` (`engine-run-card.ts:166`) but never written. **Reuse** it to persist the model's verdict reasoning.
- **Cost-control knobs** — `AgentInvokeOptions.maxTurns` (`agent-types.ts:24`) and `maxBudgetUsd` (`:30`, *"Hard cost ceiling… SDK stops with `error_max_budget_usd`"*). The engine sets `maxTurns` (`engine-step.ts:241`) but never `maxBudgetUsd`. **Reuse** for retry safety.
- **Per-step run state for resume** — `RunStep.status` (`pending|running|completed|skipped|failed`) and `run.git-ref` per step (`schemas/procedure-run.ts:35-43`); `--step` filtering already exists (`engine.ts:98-100`). The state resume needs is largely already recorded. **Reuse**; the new code is the entry point that re-enters mid-run.
- **MODEL_MAP** — `engine-types.ts:11-15` maps `haiku|sonnet|opus` → full IDs. **Reuse** if the validate phase gains a model override.

## Prior art (external)

- **LLM-as-judge / structured verdicts** is an established pattern; the project already commits to it (retro integration, `invokeStructured`). No external library is in play — the Anthropic Agent SDK is wrapped behind `src/core/agent.ts`, and structured output via `outputSchema` already works here (`agent.ts:131-135`, with the documented `$schema` strip-workaround at `:127-130`). No new SDK behavior is required, so no SDK-limitation search is load-bearing. *Searched intent: "Anthropic SDK structured output validation gate" — the capability is already integrated and tested in-repo; nothing new to learn externally.*
- **Retry-with-failure-context for agent loops** is the common "reflexion"/self-correction shape; we are implementing a deliberately small bounded version, not adopting a framework. No external dependency.
- **Resume/checkpoint of a step pipeline**: the design mirrors the engine's own existing checkpoint model (git-clean-between-steps + per-step git-ref, `procedure-implementation.md:136-181`) — *"Rewinding to any commit gives a valid, consistent state."* The prior art is internal and already documented; no external pattern needs importing.

No external prior art changes the design. The risk surface is entirely internal wiring and behavior-compatibility.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track 1 — Model-evaluated instruction validation

**What.** When a `validate` phase has `instructions:`, assemble (instruction text +
the step's git diff + the step's `whys:`) and ask a review model for a structured
pass/fail verdict. A failing verdict feeds the same severity decision as a failing
`shells` check.

**Why this needs to change.** Today `instructions:` enforces nothing (`engine-phase.ts:92-104`,
pass-by-default). Anyone who writes an `instructions:` check believes they have a gate
and does not. The schema doc admits it (`procedure.ts:81-82`).

**Direction.**
- Add a verdict schema (new, co-located with the engine), e.g.
  ```ts
  // engine-validate-model.ts
  export const InstructionVerdict = z.object({
    passed: z.boolean(),
    reasoning: z.string(),
  });
  ```
- New function `evaluateInstructions(params): Promise<{ passed: boolean; review: string }>`
  that builds the prompt and calls `agent.invokeStructured(InstructionVerdict, …)`.
  Context assembled (bounded, per "don't add features beyond what's required"):
  the instruction(s), the **step diff**, and the `whys:`. **Not** the whole box
  state — the diff is the change under judgment; broader box state is a deferred
  knob (see NOT in scope).
- **Step diff = `baseline..finalRef`, not a single commit.** `executeStep` captures
  a baseline ref (`getHead(boxRoot)`) *before* the run phase and passes it down; the
  diff handed to the model is the range from baseline to the post-`ensureGitClean`
  `gitRef`. This is the load-bearing fix: `getCommitDiff(gitRef)` alone shows only
  the last commit, so a multi-commit agent step would be judged on the wrong bytes
  (see "What already exists"). The baseline is captured once in `executeStep` and
  reused for the retry loop (Track 2), so each retry attempt re-derives the range
  against the same pre-step baseline.
- Wire the `createAgent` factory through to validation. `executeValidation` gains
  params: `createAgent?`, `procedureName`, `gitRef`, (and `directive?` if we decide
  the directive is relevant context — lean: yes, it shaped the work being judged).
  Caller is `executeStep` (`engine-step.ts:99-103`), which already holds all of these.
- Verdict → status: a `passed: false` verdict is treated identically to a failing
  `shells` check — it sets `status` per the same severity branch. This unifies the two
  failure sources so the severity gate (Track 2) is written once.
- Model tier: default **sonnet** (judgment task). Optional override via a new
  `model?` field on the `validate` phase (reuses `MODEL_MAP`). Lean: add the field for
  parity with `agents:`, default sonnet.
- Persist the verdict reasoning into the run card's existing `validate.review` field.
- Output discipline: on pass, one quiet `fmt.ok` line (no model chatter); on fail,
  the reasoning. No raw model streaming to the procedure log.

**Vocabulary lock-ins.** Verdict field names `passed` / `reasoning`. Run-card field
stays `review` (already in schema). New optional schema field `validate.model`.

**First implementation chunk.** `engine-validate-model.ts` with `InstructionVerdict`
+ `evaluateInstructions`, plus extending `test/helpers/fake-agent.ts` to support
`invokeStructured` (scripted verdict). Also threads the baseline-ref capture into
`executeStep` and the range-diff into `executeValidation` (the load-bearing input).
No open questions inside this chunk: the schema, the context inputs (range diff), the
model seam, and the fake all have decided shapes.

### Track 2 — `severity: review` auto-retry

**What.** On a `validate` failure (shell or instruction) with `severity: review`,
re-invoke the run-phase agent with the failure context and re-validate, up to a
bounded retry count. If it still fails after retries, the step **fails** (gates).

**Why this needs to change.** Today `review` silently downgrades to `warn`
(`engine-phase.ts:107-111`) — it never gates, contradicting its stated intent
(`procedure.ts:85`, guide `:140`).

**Three structural facts this track must respect** (surfaced by the Codex review;
each was an under-design in an earlier draft):

1. **`runRunPhase` runs agents *then* `run.shells` in one pass** (`engine-step.ts:215-270`).
   Re-calling it wholesale would **repeat side-effecting run shells** on every retry.
2. **The agent object is constructed fresh per call inside `runRunPhase`**
   (`engine-step.ts:231-232`) and a multi-agent run phase overwrites the single
   `sessionId` (`:212`, `:249`). "Resume the same session" is therefore *not* free —
   it only works by reconstructing with `{ sessionId, resume: true }` (`agent.ts:70-78`)
   against a *known single* session.
3. **Terminal step-fail is computed in `recordStepResults`**, gated solely on
   `validateResult.status === "fail" && severity === "abort"` (`engine-step.ts:295-301`).
   A `review` terminal-fail needs an **explicit** status path there, not just a shared
   verdict→severity branch.

**Direction.**
- **Prerequisite chunk — decompose `runRunPhase`.** Before any retry loop, split it
  into `runRunAgents` (the re-runnable part) and `runRunShells` (run **once**, never
  on retry). Without this split, fact (1) makes retry unsafe. This is a small,
  behavior-preserving refactor that lands and is tested on its own (see Implementation
  order, Chunk C0).
- **Review-retry is valid only for a single-agent run phase.** Per fact (2), retry
  reconstructs the agent with `{ sessionId, resume: true }` and re-invokes
  `runRunAgents`. A run phase with **0 or >1** `agents:` under `severity: review` is a
  misauthored procedure: hard-fail with a clear message rather than guess which
  session to resume. (This also subsumes the old "no-agent edge.") A future track can
  lift the single-agent restriction with per-agent session storage — NOT in scope.
- **Location: `executeStep`, not `executeValidation`.** Restructure `executeStep`
  (`:82-103`) so the run-agents→validate portion becomes a bounded loop, with run
  shells run once before the loop and `ensureGitClean`/validate inside it:
  ```
  baseline = getHead(boxRoot)        # captured for Track 1's range diff
  runRunShells once                  # never retried (fact 1)
  attempt = 0
  loop:
    runRunAgents (attempt 0 = normal; attempt>0 = resume session + <validation-failure>)
    gitRef = ensureGitClean(...)
    validateResult = executeValidation({ ..., baseline, gitRef })
    if validateResult.status != "fail": break
    if severity != "review": break          # abort/warn keep today's behavior
    if not exactly-one-agent: break(terminal-fail, "review needs one agent")
    if attempt >= MAX_REVIEW_RETRIES: break  # exhausted
    attempt++
  reviewExhausted = (validateResult.status == "fail" && severity == "review")
  ```
- **Terminal status path (fact 3).** `recordStepResults` gains a parameter — e.g.
  `reviewExhausted` (and the no/multi-agent-review hard-fail) — so its status
  computation becomes `failed` for an exhausted/unretryable `review` as well as for
  `abort`. The `abort` and `warn` branches are left byte-for-byte unchanged.
- **Retry cap.** Constant `MAX_REVIEW_RETRIES = 1` (2 total attempts) as the default,
  overridable via an optional `validate.max-retries` field. Lean: ship the constant;
  add the field only if a concrete procedure needs it (NOT in scope by default).
- **Failure-context threading.** The retry re-invoke adds a `<validation-failure>`
  block (failed check output / verdict reasoning + the `whys:`) to `buildContextBlock`
  (`engine-phase.ts:213`) via a new optional param, on a **resumed** session so the
  agent keeps its prior context.
- **Cost safety (concrete, per Finding 6).** Each attempt keeps `maxTurns` (default
  20) *and* sets an explicit `maxBudgetUsd` ceiling (`agent-types.ts:26`, forwarded at
  `agent-run.ts:66`). Default value: a fixed constant `REVIEW_RETRY_BUDGET_USD` (lean
  ~$2 per attempt — settle the number during the chunk); total spend is bounded by
  that × `(MAX_REVIEW_RETRIES + 1)`. Not a new schema field.
- **Terminal semantics (behavior change).** After exhausting retries, a `review`
  failure sets step status `failed` and halts the procedure — same as `abort`. This is
  the feature: `review` becomes "gate, but try to self-heal first." Today's
  `review→warn→continue` goes away. **Docs must change with it.**

**Vocabulary lock-ins.** Context block tag `<validation-failure>`. Constants
`MAX_REVIEW_RETRIES`, `REVIEW_RETRY_BUDGET_USD`. Optional field `validate.max-retries`
(only if built). Function split `runRunAgents` / `runRunShells`.

**First implementation chunk.** The `runRunPhase` decomposition (Chunk C0) — a
behavior-preserving refactor with its own regression test — lands first, because the
retry loop is unsafe without it. No open questions inside it: the split boundary
(agents vs shells) is mechanical.

### Track 3 — Resumable runs (recommended: separate follow-up plan)

**What.** `bbx procedure resume [<run-dir>]` re-enters an existing failed/crashed run
at its first non-terminal step, reusing the existing run dir and run card, running to
the end.

**Why this needs to change.** A run that fails at step N must be restarted whole; all
of step 1..N-1's agent work re-runs. Costly and, for non-idempotent steps, wrong.

**Direction (sketch — to be fully designed in its own plan).**
- New CLI verb `bbx procedure resume`; default target = latest run with status
  `failed` or stuck `running`.
- Load the existing run card (`parseProcedureRun`), reload the **current** procedure
  definition from its `procedure:` path. Definition drift is a real hazard
  (`procedure.ts:74` *"Don't modify a procedure card while a run is active"*) — resume
  must detect step-id mismatch and refuse rather than mis-map.
- Resume point = first step whose status is `failed`, `pending`, or `running`
  (`running` = crashed mid-step). `completed`/`skipped` steps are not re-run; their
  side effects and git-refs persist.
- The resumed step re-runs fully (precheck → run → validate). Precheck re-runs derive
  fresh `pass-output`. Idempotency of the *resumed* step is the boxholder's contract,
  same as a fresh `--step` run today.
- Reuse `runSteps`/`executeStep` against the existing run card + dir instead of
  minting a new timestamped dir (`engine.ts:166-182`).

**Why separable.** Tracks 1-2 live entirely in the validate/step path
(`engine-phase.ts` + `engine-step.ts`); Track 3 lives in the run-lifecycle entry path
(`engine.ts` `startProcedure` + a new `resumeProcedure`). They share no code that
forces co-design. Track 3 is also the largest and has the most unsettled edges
(definition drift, crashed-`running` recovery, dir reuse). Bundling it delays the
higher-value, tightly-coupled validation gating.

**Recommendation.** Ship Tracks 1+2 as this plan; spin Track 3 as
`procedure-resume.md` (its own complete plan) as the immediate follow-up. This is the
clean cut-line the briefing asked me to find. **This is the key decision for the
boxholder** (see Open design questions).

## Subplans

- **`procedure-resume.md`** (Track 3) — recommended to become its own plan rather
  than a track here, for the separability reasons above. Not yet written; this plan
  links to it as the planned follow-up. If the boxholder prefers one bundle, Track 3's
  sketch above is promoted to a full track instead.

No other sub-question needs its own design step: Tracks 1 and 2 have decided shapes.

## Failure modes

**Critical gap (resolved in-plan):** *instruction verdict can't be obtained* — the
model errors, times out, or returns schema-invalid output. If unhandled this is
silent-and-wrong in the most dangerous direction: a check the author thinks gates
silently passes (today's behavior, but now with the *appearance* of enforcement).
Handling: `invokeStructured` already returns `data: null` + `error` on failure
(`agent-types.ts:70-72`). The engine must map a null verdict to a **non-pass that
respects severity** (an `abort`/`review` instruction whose model call failed must not
silently pass), and log the error. Decided: model-unavailable ⇒ treat as a failing
check (fail-closed), reasoning recorded as the error.

**Critical gap (resolved in-plan):** *the model judges the wrong diff.* An earlier
draft handed the model `getCommitDiff(boxRoot, gitRef)`; because `gitRef` is only the
last commit of a possibly-multi-commit agent step (`engine-phase.ts:165-166`), the
judge would silently see a partial diff and pass/fail on the wrong bytes — invisible,
no test, no handling. Resolved by capturing a pre-run baseline and judging
`baseline..finalRef` (Track 1 Direction, "What already exists"). This was the Codex
review's single most important finding.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Model returns schema-invalid / null verdict | New (Track 1) | New: fail-closed + log (above) | Clear (logged + recorded in `review`) |
| Model call exceeds budget/turns | New (Track 2) | `maxBudgetUsd` (`REVIEW_RETRY_BUDGET_USD`)/`maxTurns` → `success:false`, mapped to failing check | Clear |
| **Model judges the wrong bytes** — multi-commit agent step, `gitRef` = last commit only | New (Track 1) | New: `baseline..finalRef` range diff (Track 1 Direction) instead of `getCommitDiff(gitRef)` | Clear once fixed; **was the silent-wrong default** |
| Step diff empty (shell-only step, or genuinely no change) | New (Track 1) | Range diff is `""`; model judges on empty diff → likely fail; document that instruction checks need a run phase that produces a diff | Clear-ish (empty diff is a weak signal; flagged) |
| `review` retry never converges | New (Track 2) | `MAX_REVIEW_RETRIES` hard cap → terminal fail via `reviewExhausted` path in `recordStepResults` | Clear (logged "gave up after N") |
| `review` on a run phase with 0 or >1 `agents:` | New (Track 2) | Terminal hard fail with explanatory message (can't pick a session to resume) | Clear |
| Retry re-runs side-effecting run shells | New (Track 2, Chunk C0) | `runRunShells` split out and run **once** before the loop | Clear (was the footgun Finding 3 caught) |
| Retry agent makes things worse / drifts | New (Track 2) | Bounded attempts; each re-validated; terminal fail if still bad | Clear |
| Existing `shells:`+`abort` path regresses | Existing doctests (`procedure-engine.doctest.md:290-335`) + new guard tests | Keep code path; tests pin it | Clear |
| `warn` severity behavior changes | Existing doctest (`:230-288`) | Untouched branch; test pins it | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — *ADDRESSED.* Author uses `instructions:` expecting a
  gate: now it actually gates (Track 1). Author uses `severity: review` expecting
  retry: now it retries then gates (Track 2). The two long-standing "this looks like a
  gate but isn't" footguns are removed.
- **Stale ref** — *ADDRESSED (Track 1) / DEFERRED (Track 3).* Track 1's diff comes
  from the just-written `gitRef` in the same run — not stale. Track 3's reload of a
  possibly-changed definition is the real stale-ref case; handled by the drift-refusal
  in Track 3's design, formally deferred to the resume plan.
- **Two agents touching the same card** — *ADDRESSED.* Procedures run serially under
  the engine; review-retry is restricted to a single-agent run phase and resumes that
  one session, not a concurrent one. No new concurrency introduced.
- **Hand-edit drift** — *PARTIALLY ADDRESSED (honest scope).* A new field with a
  **wrong-typed value** (`validate.model: 7`) does become a clear `bbx validate` error
  once the field is added to `ProcedureValidate` (`procedure.ts:44-48`) and mapped in
  `loadProcedureDefinition` (`engine-parse.ts:75-78`). But Zod `.object()` **strips
  unknown keys**, so a **misspelled field** (`validate.modle: opus`, `max-reties: 3`)
  is silently dropped, not flagged — the author's intent is lost with no error. This is
  inherent to the schema's strip-unknowns posture (shared by every card type), not
  unique to this plan; we accept it rather than add strict-mode validation here (NOT in
  scope). Flagged so it isn't mistaken for fully handled. (Finding 5 from the Codex
  review.)
- **Fabricated free-form value** — *ADDRESSED by design stance.* The model judges the
  *git diff* (real, committed bytes), not the agent's self-report. The
  `<validation-failure>` retry context is engine-authored, not agent-authored. Honesty
  is structurally easy: the artifact under judgment is the diff.
- **Validation error UX** — *ADDRESSED.* Verdict reasoning is recorded in `review` and
  printed on failure; the `<validation-failure>` block reads as clean context for the
  retrying agent. Schema-validation messages for the new fields follow the existing
  card-validation path.
- **Partial migration / transition state** — *ADDRESSED.* No card-data shape change
  for Tracks 1-2 (run-card `review` field already exists; new fields are additive and
  optional). Existing procedures with `shells:`+`abort` are byte-for-byte unaffected.
  The only behavior transition is `review`'s new semantics — covered by the doc updates,
  not a data migration.

## NOT in scope

- **Track 3 (resume)** — recommended as a separate follow-up plan; rationale above.
  If the boxholder bundles it, it becomes a full track.
- **Broader box-state context for the model** — Track 1 hands the model the git diff +
  whys, not arbitrary box reads. Rationale: bounded context per scope discipline; an
  instruction needing more can be re-scoped later. Deferred, not forbidden.
- **`validate.max-retries` field** — ship the `MAX_REVIEW_RETRIES` constant first; add
  the per-step override only when a real procedure needs a different cap. Avoids a knob
  with no caller.
- **Parallel/streaming model validation** — validation is serial and quiet by design.
- **Multi-agent review-retry** — review-retry requires exactly one run agent (single
  resumable session). Per-agent session storage to retry a multi-agent run phase is a
  future track. A 0/>1-agent `review` phase terminal-fails with a clear message.
- **Strict-mode schema validation for misspelled fields** — Zod strips unknown keys, so
  a misspelled `validate.*` field is silently dropped (see Hand-edit drift). Adding
  strict/`.strict()` validation is a box-wide schema decision, not this plan's to make.
- **Retrying `abort` or `warn` severities** — only `review` retries; `abort` gates
  immediately and `warn` continues, both unchanged.
- **Changing `shells:`+`abort` semantics** — explicitly preserved; it's the one path
  that gates today and must keep gating identically.

## Open design questions

1. **Bundle or split Track 3?** *(The decision the boxholder asked me to surface.)*
   My lean: **split.** Ship instruction-validation + review-retry now (they share the
   verdict→severity path and the doc updates); make resume its own plan next. Resume is
   the largest piece, lives in a different code path, and has the most unsettled edges.
   Bundling delays the higher-value coupled pair.
2. **Default review model tier.** Lean **sonnet** (judgment task; haiku may under-judge,
   opus is overkill for a diff verdict). Overridable via `validate.model`.
3. **Retry: resume session vs cold-start.** *Settled by the Codex review.* Resume —
   reconstruct the run agent with `{ sessionId, resume: true }` — but only for a
   single-agent run phase (a 0/>1-agent `review` phase terminal-fails; resuming needs
   one known session, `engine-step.ts:212`/`:249`). Cold-start loses why the agent did
   what it did; the bounded cap covers the stuck-agent risk. Per-agent session storage
   to lift the single-agent restriction is a future track (NOT in scope).
4. **Fail-closed on model-unavailable for `warn` severity.** A `warn` instruction whose
   model call fails: warn (continue) or fail-closed-to-warn? Lean: a failed model call
   under `warn` still just warns (it's non-gating by definition); fail-closed matters
   only for `review`/`abort`. Minor; settle during Track 1.

## Knowledge audits

This plan changes two agent-facing conventions (`instructions:` and `severity: review`
go from "documented as not-implemented" to "implemented and gating"). Per the section's
default, each gets at least one audit, and the existing audits that assert the *old*
non-behavior must be corrected.

- **Update existing**: `src/dev/knowledge-audits.yaml` `create-procedure` (`:283`) and
  any entry whose `watch_for`/expected answer encodes "only `shells`+`abort` gates" or
  "`instructions` not evaluated." These will become *wrong* once the feature lands —
  audit the agent guide text they read (`docs/generated/procedures.md`).
- **New `knows_directly`**: "Does `severity: review` retry the agent on validation
  failure?" (expected: yes, bounded, then gates) and "Do `instructions:` validation
  checks gate?" (expected: yes, model-judged against the diff).
- **Run, not just write**: execute
  `pnpm knowledge-audit run --box ~/src/boxes/test1 --filter procedures` (absolute box
  path per `memory/project_knowledge_audit_resets_tree.md`) and record the status
  comments before the plan completes.

No purely-infrastructural concept here is exempt — both gaps are author-facing.

## Implementation order

1. **Chunk A (Track 1 core).** `engine-validate-model.ts` (`InstructionVerdict` +
   `evaluateInstructions`); extend `fake-agent.ts` `invokeStructured`. Unit-level
   doctest of `evaluateInstructions` with a scripted fake verdict. No engine wiring yet.
2. **Chunk B (Track 1 wiring).** Capture the pre-run **baseline ref** in `executeStep`;
   thread `createAgent`/`baseline`+`gitRef` (range diff)/`procedureName` into
   `executeValidation`; replace the `:92-104` stub; map verdict→severity; persist
   `review`. Doctests: instruction pass, instruction fail under each severity,
   model-unavailable fail-closed, **multi-commit step → range diff (not last-commit)**.
3. **Chunk C0 (Track 2 prerequisite — refactor).** Split `runRunPhase` into
   `runRunAgents` + `runRunShells`, behavior-preserving. Regression test: an existing
   agent+shell run-phase doctest still produces identical commits/output. No retry yet.
4. **Chunk C (Track 2).** Restructure `executeStep`: run shells once (`runRunShells`),
   then the bounded run-agents→validate retry loop; `<validation-failure>` context
   block; resumed single-agent session; `REVIEW_RETRY_BUDGET_USD`; `reviewExhausted`
   terminal-fail path in `recordStepResults`. Doctests: review retries-then-passes,
   retries-then-terminal-fails, 0/>1-agent review terminal-fails, run shells run **once
   across retries**, `abort`/`warn` unchanged. Depends on C0 and B.
5. **Chunk D (docs + audits).** Update `procedure.ts:81-85`, `procedure-implementation.md`
   (also still XML-example stale — `:39-67` — fix opportunistically), the guide
   generator `generate-docs-procedure-guide.ts:74-142`, and any glossary text. Update +
   add knowledge-audit entries and **run** them. Depends on B+C (docs describe shipped
   behavior).
6. **(Follow-up plan)** Track 3 resume — `procedure-resume.md`.

## Rollout shape

- **Test posture (tests-first).** Named doctests per substantial codepath, encoding the
  done-when:
  - `evaluateInstructions`: verdict pass / fail / null-verdict-fail-closed (Chunk A).
  - Instruction validation end-to-end via `startProcedure` + fake structured agent:
    pass continues; fail under `warn`/`review`/`abort` behaves per severity (Chunk B).
  - `runRunPhase` decomposition: an agent+shell run-phase produces identical
    commits/output after the `runRunAgents`/`runRunShells` split (Chunk C0).
  - Review retry: retries-then-passes; exhausts-then-terminal-fails; 0/>1-agent review
    terminal-fails; run shells run once across retries; **regression pins** that
    `shells`+`abort` (`procedure-engine.doctest.md:290`) and `warn` (`:230`) are
    unchanged (Chunk C).
  - These live in `test/core/procedure/` alongside the existing engine doctests.
  - Baseline confirmed clean after merging `main`: full `pnpm test` is 2409/2409
    green (`procedure-engine.doctest.md` 12/12). An earlier 66-failure cluster came
    from the tap mock-loader not resolving `.js`→`.tsx` for the `guide` schema; fixed
    upstream by `cd06ed81` ("add tsx loader so tap resolves .js→.ts imports"), pulled
    in via the merge — unrelated to this plan.
- **Knowledge audits.** Updated + new entries land and are **run** in Chunk D (not
  deferred).
- **Migration.** No data-shape migration: run-card `review` already exists; new schema
  fields (`validate.model`, optionally `max-retries`) are additive and optional. Old
  cards load unchanged. The only "migration" is conceptual — `review`'s new gating
  semantics — handled by the doc/audit updates, not by touching any box data.
- **Ships as one unit** (Tracks 1+2, Chunks A-D). Does not merge to main without an
  explicit boxholder signal.
```
