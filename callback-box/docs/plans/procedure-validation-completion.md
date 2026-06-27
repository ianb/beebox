# Procedure validation completion (D5)

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

- **`callback-box/CLAUDE.md`** —
  - `:` *"Services — Every external dependency is wrapped in a typed interface with real + fake implementations. Fakes have observable state for testing."* The review model is an external dependency; it must be fakeable. The existing `createAgent` factory seam (`ProcedureOptions.createAgent`) is that interface here.
  - *"Read before writing. Don't guess file formats... read the existing code, read the test patterns."*
  - *"don't add features beyond what the task requires"* (the "Improving These Instructions" / scope discipline throughout) — bounds the context we assemble for the model and the retry knobs we add.
  - *"Treat noisy command output as a bug"* (monorepo `CLAUDE.md`) — model calls and retries must stay quiet on the happy path.
  - *"Keep source and docs generic — never hardcode personal names."*
- **`callback-box/CODE-STYLE.md`** — no `any`; no default parameters; max 2 positional params (named-params objects); custom error classes, not `new Error()`; files ≤300 lines, functions ≤150; only export what's used.
- **`docs/testing.md`** — tests come first as a design tool; cover substantial codepaths, not coverage-for-its-own-sake.
- **Most recent shipped precedent: the retro integration** (`src/core/retro/`) and the project stance the briefing names — *"Arrange context, don't automate judgment"* (`memory/feedback_arrange_context_not_automate_judgment.md`): judgment stays in the model; the engine only assembles inputs. Do **not** try to make instruction validation deterministic.
- **Schema-doc-accuracy precedent**: `src/schemas/procedure.ts:81-85` and the procedure guide generator currently document these as *not implemented*. Whatever we implement, those docs flip from accurate to wrong unless updated in the same change.

## What already exists

- **`executeValidation`** — `src/core/procedure/engine-phase.ts:64-122`. Runs `shells`, then has the two stubs: `:92-104` (`// TODO: Invoke review model with instruction + git diff + why` … *"instruction checks pass by default"*) and `:107-111` (`// TODO: Re-invoke agent with failure context` … *"downgrade to warn and continue"*). **Rebuild** the stubs; **keep** the `shells` path (`:75-89`) byte-for-byte in behavior.
- **Agent invocation with structured output** — `src/core/agent.ts:122-136` `invokeStructured<T>(schema, opts)` already exists and returns a Zod-validated `data`. The instruction-validation verdict is exactly this shape. **Reuse**; do not build a new model client.
- **Fakeable agent factory, already threaded** — `ProcedureOptions.createAgent` (`engine-types.ts:28`) → `runSteps` (`engine.ts:113`) → `executeStep` (`engine-step.ts:46`) → `runRunPhase` (`engine-step.ts:231`). The seam reaches the run phase but **not** `executeValidation` today — that's the wiring gap to close. **Reuse** the seam; extend its reach.
- **The fake agent** — `test/helpers/fake-agent.ts:103-107`: `invokeStructured` deliberately throws *"extend the fake when a structured-output test arrives."* That arrival is now. **Extend** it.
- **Git diff helpers** — `src/cli/lib/git.ts:406` `getCommitDiff(boxRoot, hash)` (diff of a single commit vs its parent, with initial-commit fallback) and `:295` `getDiff`. The step's committed work is already captured as `gitRef` (`engine-step.ts:91-96`, `recordStepResults` stores it). **Reuse** `getCommitDiff(boxRoot, gitRef)` as the diff handed to the model.
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
  the instruction(s), `getCommitDiff(boxRoot, gitRef)`, and the `whys:`. **Not** the
  whole box state — the diff is the change under judgment; broader box state is a
  deferred knob (see NOT in scope).
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
`invokeStructured` (scripted verdict). No open questions inside this chunk: the
schema, the context inputs, the model seam, and the fake all have decided shapes.

### Track 2 — `severity: review` auto-retry

**What.** On a `validate` failure (shell or instruction) with `severity: review`,
re-invoke the run-phase agent with the failure context and re-validate, up to a
bounded retry count. If it still fails after retries, the step **fails** (gates).

**Why this needs to change.** Today `review` silently downgrades to `warn`
(`engine-phase.ts:107-111`) — it never gates, contradicting its stated intent
(`procedure.ts:85`, guide `:140`).

**Direction.**
- **Location: `executeStep`, not `executeValidation`.** Retry means re-running the
  *run phase* (the agent), which lives in `runRunPhase` (`engine-step.ts:204-273`),
  one level above validation. Restructure `executeStep` (`:82-103`) so run→validate
  becomes a bounded loop:
  ```
  attempt = 0
  loop:
    runRunPhase (attempt 0 = normal; attempt>0 = with <validation-failure> context)
    ensureGitClean → gitRef
    validateResult = executeValidation(...)
    if validateResult.status != "fail": break
    if severity != "review": break          # abort/warn keep today's behavior
    if attempt >= MAX_REVIEW_RETRIES: break  # exhausted → terminal fail
    attempt++
  ```
- **Retry cap.** Constant `MAX_REVIEW_RETRIES = 1` (2 total attempts) as the default,
  overridable via an optional `validate.max-retries` field. Lean: ship the constant;
  add the field only if a concrete procedure needs it (NOT in scope by default).
- **Failure-context threading.** Retry re-invokes the same agent prompt plus a new
  `<validation-failure>` block (failed check output / verdict reasoning + the `whys:`),
  added to `buildContextBlock` (`engine-phase.ts:213`) via a new optional param. The
  agent resumes the same session (`createAgent` already supports resume,
  `agent.ts:70-78`) so it has its prior context — lean: **resume**, don't cold-start.
- **Cost safety.** Each attempt keeps its `maxTurns` (default 20). Set a
  `maxBudgetUsd` ceiling on retry invocations so a runaway loop is SDK-capped, not
  just turn-capped. Total attempts are hard-bounded by `MAX_REVIEW_RETRIES`.
- **Terminal semantics (behavior change).** After exhausting retries, a `review`
  failure sets step status `failed` and halts the procedure — same as `abort`. This is
  the feature: `review` becomes "gate, but try to self-heal first." Today's
  `review→warn→continue` goes away. **Docs must change with it.**
- **No-agent edge.** `severity: review` on a run phase with no `agents:` has nothing
  to re-invoke. Decision: treat as a hard fail with a clear message (can't retry what
  isn't an agent) rather than silently warn — surfaces a misauthored procedure.

**Vocabulary lock-ins.** Context block tag `<validation-failure>`. Constant
`MAX_REVIEW_RETRIES`. Optional field `validate.max-retries` (only if built).

**First implementation chunk.** Restructure `executeStep` run→validate into the
bounded loop with `MAX_REVIEW_RETRIES`, the `<validation-failure>` context block, and
the agent-resume retry — gated so non-`review` severities and zero-failure runs are
behaviorally identical to today. Depends on Track 1 (shared verdict→severity path).

### Track 3 — Resumable runs (recommended: separate follow-up plan)

**What.** `cb procedure resume [<run-dir>]` re-enters an existing failed/crashed run
at its first non-terminal step, reusing the existing run dir and run card, running to
the end.

**Why this needs to change.** A run that fails at step N must be restarted whole; all
of step 1..N-1's agent work re-runs. Costly and, for non-idempotent steps, wrong.

**Direction (sketch — to be fully designed in its own plan).**
- New CLI verb `cb procedure resume`; default target = latest run with status
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

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Model returns schema-invalid / null verdict | New (Track 1) | New: fail-closed + log (above) | Clear (logged + recorded in `review`) |
| Model call exceeds budget/turns | New (Track 2) | `maxBudgetUsd`/`maxTurns` → `success:false`, mapped to failing check | Clear |
| `getCommitDiff(gitRef)` empty (shell-only step committed nothing meaningful, or bad ref) | New (Track 1) | `getCommitDiff` already falls back to `""` (`git.ts:421-428`); model judges on empty diff → likely fail; document that instruction checks need an agent step producing a diff | Clear-ish (empty diff is a weak signal; flagged) |
| `review` retry never converges | New (Track 2) | `MAX_REVIEW_RETRIES` hard cap → terminal fail | Clear (logged "gave up after N") |
| `review` on a run phase with no `agents:` | New (Track 2) | Hard fail with explanatory message | Clear |
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
  the engine; the retry resumes the *same* agent session, not a concurrent one. No new
  concurrency introduced.
- **Hand-edit drift** — *ADDRESSED.* `validate.model` / `max-retries` are optional and
  Zod-validated on load (`cb validate`); a bad value is a clear card-validation error,
  not a silent runtime surprise.
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
3. **Retry: resume session vs cold-start.** Lean **resume** — the agent keeps its prior
   context and the `<validation-failure>` block is a focused nudge. Cold-start loses why
   it did what it did. (Risk: a stuck agent stays stuck; the bounded cap covers that.)
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
2. **Chunk B (Track 1 wiring).** Thread `createAgent`/`gitRef`/`procedureName` into
   `executeValidation`; replace the `:92-104` stub; map verdict→severity; persist
   `review`. Doctests: instruction pass, instruction fail under each severity,
   model-unavailable fail-closed.
3. **Chunk C (Track 2).** Restructure `executeStep` run→validate into the bounded retry
   loop; `<validation-failure>` context block; `maxBudgetUsd`; terminal-fail semantics;
   no-agent edge. Doctests: review retries-then-passes, retries-then-terminal-fails,
   no-agent review fails, `abort`/`warn` unchanged. Depends on B.
4. **Chunk D (docs + audits).** Update `procedure.ts:81-85`, `procedure-implementation.md`
   (also still XML-example stale — `:39-67` — fix opportunistically), the guide
   generator `generate-docs-procedure-guide.ts:74-142`, and any glossary text. Update +
   add knowledge-audit entries and **run** them. Depends on B+C (docs describe shipped
   behavior).
5. **(Follow-up plan)** Track 3 resume — `procedure-resume.md`.

## Rollout shape

- **Test posture (tests-first).** Named doctests per substantial codepath, encoding the
  done-when:
  - `evaluateInstructions`: verdict pass / fail / null-verdict-fail-closed (Chunk A).
  - Instruction validation end-to-end via `startProcedure` + fake structured agent:
    pass continues; fail under `warn`/`review`/`abort` behaves per severity (Chunk B).
  - Review retry: retries-then-passes; exhausts-then-terminal-fails; no-agent review
    fails; **regression pins** that `shells`+`abort` (`procedure-engine.doctest.md:290`)
    and `warn` (`:230`) are unchanged (Chunk C).
  - These live in `test/core/procedure/` alongside the existing engine doctests.
  - Baseline confirmed before starting: `procedure-engine.doctest.md` 12/12 pass.
    (Repo-wide `pnpm test` has 66 pre-existing failures from a missing
    `src/schemas/guide.ts` import in `box-defaults.ts` — unrelated to this plan; the
    procedure path doesn't import it. Flag separately to the boxholder.)
- **Knowledge audits.** Updated + new entries land and are **run** in Chunk D (not
  deferred).
- **Migration.** No data-shape migration: run-card `review` already exists; new schema
  fields (`validate.model`, optionally `max-retries`) are additive and optional. Old
  cards load unchanged. The only "migration" is conceptual — `review`'s new gating
  semantics — handled by the doc/audit updates, not by touching any box data.
- **Ships as one unit** (Tracks 1+2, Chunks A-D). Does not merge to main without an
  explicit boxholder signal.
```
