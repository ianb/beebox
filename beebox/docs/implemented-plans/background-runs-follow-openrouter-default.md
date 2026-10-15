---
title: "Background runs follow an OpenRouter box default"
status: implemented
workstream: background-provider
issues:
  - ../../../issues/closed/bugs/2026-10-15-background-runs-ignore-box-openrouter-default.md
---
# Background runs follow an OpenRouter box default

A box whose default model is an owner-added OpenRouter model still runs most
background agent work on first-party Claude. This plan makes tiered procedure
steps, untiered steps, and the small structured passes follow the box's
OpenRouter choice, so such a box needs no Claude login for background work.

**Issues addressed:** `2026-10-15-background-runs-ignore-box-openrouter-default`.
Searched the queue for `openrouter`, `smallModel`, `small model`, `tier`,
`background`: related but not resolved here are
`2026-10-06-thread-runs-skip-live-provider-check` (a running thread does not
re-check its provider) and `2026-10-14-show-privacy-implications-of-this-box-setup`
(this plan adds egress that page should list; the page itself is not built here).

## Design

No design section: this restores what the admin already promises
("New chats and unpinned agent work — wakeups, procedures without an explicit
model — use this model", `src/frontend/src/components/admin/AgentEngineSection.tsx:117`)
and adds one model selector beside an existing one. No new card, surface, or
proactive behavior.

## Smallest fix and budget

Smallest fix: in `resolveProcedureModel`, give `openrouter` a column that maps
every tier to the box default. That fixes tiered steps only; the small passes
(reviews, titles, triage, retro) and untiered steps still run on Claude, which
is most of the volume the boxholder reported.

Chosen design (boxholder decision, below): three tracks.

- Track 1 — resolution: small slot accepts an OpenRouter model; tiers on an
  OpenRouter-default box resolve to the small model or the default; untiered
  runs take the box default. ~120 source lines, ~120 test lines.
- Track 2 — admin: removal refusal while an added model is the small model,
  and a line naming what still needs a Claude login. ~40 source lines,
  ~30 test lines. (A small-model selector was cut after plan review: the
  decision reuses an existing setting and did not ask for a control.)
- Track 3 — docs: `docs/model-policy.md`, `docs/security-report.md` §3.
  ~40 doc lines.

Total under 400 changed lines. Not a BIG CHANGE.

## Stated preferences this plan trades against

- **Boxholder decision, 2026-09-19** (`docs/implemented-plans/openrouter-chat-models.md:79-81`):
  *"Tiered procedure steps (`model: strong`) stay on subscription Claude,
  because an added model has no tier."* This plan reverses it. Boxholder,
  2026-10-15: *"while I can use a openrouter default service for the
  foreground, the background tasks seem to suppress that ability."*
- **Boxholder decision, 2026-10-15** (asked in session, option chosen
  "Small slot + default"): the existing small-model setting may name an
  OpenRouter model. Efficient and balanced tiers and the cheap passes use the
  small model; strong and strongest use the box default. An unset small model
  on an OpenRouter-default box falls back to the box default. No new setting.
- **Minimize invented concepts** (boxholder memory): reuse `smallModel` rather
  than add a "background model" setting.
- **Fail closed, never fall back to first-party** (`docs/model-policy.md`,
  "Nothing falls back to first-party"): a missing key or removed model still
  refuses the run through `providerEnvAdditions`; this plan adds no fallback.
- **Operational simplicity beats per-call cost** (boxholder memory): the cheap
  passes run on every chat turn. On an OpenRouter box they now bill per token
  instead of riding the Claude subscription. Accepted with the decision above.

## What already exists

- `src/core/model-policy.ts:137` `loadEffectiveBoxModel` — the reactor's
  model (`src/core/reactor/engine/batch-jobs.ts:55`). Reuse.
- `src/core/model-policy.ts:155` `resolveSmallModelForEngine` — already
  provider-aware via `boxDefault`; comment at `:160`: *"an OpenRouter model is
  never a small-pass pin (`readConfiguredModel` refuses it)"*. Change.
- `src/core/box/config.ts:265-268` — the refusal: *"An added OpenRouter model
  may be the box default, never the small-pass model"*. Change.
- `src/shared/agent-models.ts:122` `resolveProcedureModel` — pure, sync; the
  `openrouter` column is deliberately missing (`:52-54`). Keep it pure and
  sync; put the OpenRouter rule one level up in `model-policy.ts`, where box
  config is in hand.
- Call sites that resolve tiers with `providerOf(loadEffectiveBoxModel)`:
  `src/core/procedure/engine/run-execute.ts:60,102`,
  `src/core/procedure/engine-validate-model.ts:149`. Switch to the new helper.
- Call sites that pass no model: `run-execute.ts:114-135` (step with no
  `model:`), `src/core/triage/auto/research.ts:27`,
  `src/core/migration-repair.ts:126`. Pass the box default.
- Small-pass call sites: `src/core/chat/review/reviewer.ts:233,250`,
  `src/core/retro/observer.ts:67`, `src/core/triage/run/core.ts:158`. Unchanged
  — they read `loadEffectiveSmallModel`.
- Spawn gate: `src/core/agent/invoke/run.ts:278` checks provider setup for a
  third-party model instead of the Claude login; `:244` injects the env. Both
  already handle any added OpenRouter id. Reuse.
- Admin config write: `src/webapp/trpc/routers/admin/router.ts:121-139`,
  `src/webapp/box-config-write.ts:94-133` (`agentModel` only). Extend with
  `smallModel`.
- Removal guard: `src/webapp/trpc/routers/admin/box-config-openrouter.ts:62`
  refuses removing the default. Extend to the small model.

## Prior art (external)

No design decision depends on an external premise beyond what
`openrouter-chat-models.md` verified on 2026-09-19 (tool use, structured
output, resume through OpenRouter's Anthropic endpoint for
`deepseek/deepseek-v3.2` and two others). The live check in *Rollout shape*
re-confirms structured output for the small passes on a DeepSeek model.

## Ontology

No new nouns. Existing names used throughout:

- **box default** — `agentModel`, read through `loadEffectiveBoxModel` (`model-policy.ts:137`).
- **small model** — `smallModel`, read through `loadEffectiveSmallModel` (`model-policy.ts:175`).
- **tier** — `ProcedureModelTier` (`shared/agent-models.ts:23`), named by a step's `model:`.
- **added model** — an `openrouterModels` entry (`box/config.ts`, `loadAddedModels`).
- **provider** — `ModelProvider`, from `providerOf` (`shared/agent-models.ts:56`).

## Tracks / scope

### Track 1 — resolution

**What.** On the claude engine, when the box default is an added OpenRouter
model, map tiers and small passes to OpenRouter models. Give untiered runs the
box default.

**Why.** Today each of these runs needs a Claude login on a box the owner set
up for OpenRouter (map in the issue; verified at the citations above).

**Direction.**

- `readConfiguredModel` (`box/config.ts`): accept an added OpenRouter model for
  `smallModel` as well as `agentModel` (drop the field condition).
- `resolveSmallModelForEngine({ engine, pinned, added, boxDefault })`: a pinned
  value resolves through `resolveBoxModelForEngine(engine, { pinned, added })`.
  Unpinned with an OpenRouter `boxDefault` returns `boxDefault`. Otherwise
  unchanged (efficient tier on the default's provider).
- New pure `resolveTierModel({ engine, tier, boxDefault, small })` in
  `model-policy.ts`: if `engine === "claude"` and `boxDefault` is OpenRouter,
  `efficient`/`balanced` → `small`, `strong`/`strongest` → `boxDefault`.
  Otherwise `resolveProcedureModel({ engine, model: tier, provider: providerOf(boxDefault ?? "") })`
  (today's behavior). `tier` accepts `ProcedureModelName`; export a
  `procedureTier(name)` from `agent-models.ts` over `LEGACY_TIER`.
- New `loadTierResolver(boxRoot): Promise<(name: ProcedureModelName) => string>`
  — one config read, used by the three tier call sites.
- Untiered: `run-execute.ts` step with no `model:`, triage research, migration
  repair pass `loadEffectiveBoxModel(boxRoot)` when non-null. Null (unpinned
  box) keeps today's harness default.

**Vocabulary lock-ins.** `resolveTierModel`, `loadTierResolver`, `procedureTier`.

**First implementation chunk.** The `box/config.ts` and `model-policy.ts`
changes plus a doctest of the resolution table. No open questions.

### Track 2 — admin

**What.** Under Default model in Admin → Agent engine and model, when the
default is an OpenRouter model, a hint: background work follows the
OpenRouter models above; scan import's photo reading still uses Claude unless
the operator sets `BBX_SCAN_VISION=gemini`; a chat or small model set to a
Claude model needs a Claude login.

**Why.** The issue asks the box to say what still needs a Claude login.
`smallModel` stays a `_config/box.json` field (the box agent can set it on
request), documented in `docs/model-policy.md`.

**Direction.** Removal of an added model refuses when it is `smallModel`,
with the same error class as the default guard. The hint is static text keyed
on `providerOf(agentModel) === "openrouter"`.

**First implementation chunk.** The removal guard with a test.

### Track 3 — docs

`docs/model-policy.md` (settings table, readers table, "OpenRouter models"
bullet that says tiers stay first-party, the "procedure step that omits
`model:`" sentence). `docs/security-report.md` §3 row for third-party models:
the scope column stops excluding tiered steps and small passes. Supersession
note on `docs/implemented-plans/openrouter-chat-models.md:79`.

## Could this be simpler?

Simplest version: every tier and pass → the box default (no small-slot
change, no admin selector). It fails the boxholder's chosen option: no way to
put the per-turn passes on a cheaper model than the chat model. The small-slot
version reuses an existing setting, so it adds no concept. The small-model
selector was cut (plan review); `docs/model-policy.md` teaches the field.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Small model is an added model the owner later removes | new: removal guard test | removal refused while in use (Track 2) | clear |
| Hand-edited `smallModel` names an id not in the added list | existing loader warning path | `readConfiguredModel` warns and ignores | clear (warning) |
| OpenRouter key missing/ungranted for a background run | existing (`provider-env` tests) | `providerEnvAdditions` refuses; run fails with fix | clear |
| DeepSeek fails structured output for a small pass | live check (Rollout) | `validateStructuredResult` returns failure; review skips that turn | clear in logs |
| Codex box with an OpenRouter `smallModel` pin | new doctest row | `resolveBoxModelForEngine` → `isChatModelAllowed` false, no tier → null; falls to efficient tier | silent but correct |
| Claude-pinned box: untiered steps change from harness default to the pin | doctest row | intended; matches admin helper text | visible in run banner `model=` |
| SDK's Claude-priced `maxBudgetUsd` trips early on an OpenRouter run (`openrouter-chat-models.md:579-584`: 5–20× overstatement) | live check | none yet | clear (run fails with budget error) |
| Owner hand-edits the default out of `openrouterModels`: loader drops `agentModel`, background tiers resolve first-party | no | loader warning only | silent-ish |
| Small model or default edited between a review attempt and its resumed retry: retry resumes on another provider | no | none (same window exists for GLM today) | silent |

No critical gap. Accepted risks: the hand-edit row is unreachable through
admin, which refuses removing the default. The retry row needs a config edit
inside one step's retry window; the same window exists for GLM today. The
budget row is measured in the live check; if a cap trips, the cap policy goes
to the boxholder.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field — ADDRESSED: procedure authors still write tiers; resolution owns the mapping.
- Stale ref — ADDRESSED: a removed small model is refused at removal.
- Two agents — not applicable: resolution is read-only per run.
- Hand-edit drift — ADDRESSED by the loader warning.
- Fabricated value — not applicable.
- Validation error UX — ADDRESSED: admin write rejects unknown ids with `Unknown model id`.
- Transition state — none: no stored data changes shape.

## NOT in scope

- Scan vision on OpenRouter: it sends images and is selected by an operator
  env var; named in the admin hint only.
- A per-added-model tier table: the boxholder chose two slots, not a mapping.
- Re-checking provider setup inside a running thread
  (`2026-10-06-thread-runs-skip-live-provider-check`).
- The privacy-implications page (`2026-10-14-show-privacy-implications-of-this-box-setup`).
- GLM boxes: GLM already has a tier column; unchanged.

## Open design questions

None. The tier mapping was settled by the boxholder on 2026-10-15.

## Knowledge audits

Skip: no agent-facing vocabulary changes. Procedure authors keep writing tiers.

## What will hold this after it ships

A doctest of `resolveTierModel` and `resolveSmallModelForEngine` (pure
functions; table of engine × default × small → model). A fake-agent test of
the procedure call sites (tiered strong, tiered efficient, untiered) asserting
the model each `invoke` receives. A unit test of the removal guard. The existing `provider-env` and `run.ts` preflight tests cover
the spawn gate.

## Implementation order

1. Track 1 resolution + doctest. Commit.
2. Track 1 call sites (procedure, judge, triage research, migration repair). Commit.
3. Track 2 server + guard test; then the admin selector and hint. Commit.
4. Track 3 docs + security report. Commit.
5. Live check on the worktree test box with an isolated-store `openrouter`
   key: one procedure with a tiered step and one chat-review pass on a
   DeepSeek default, with a distinct small model so both slots are seen.
   Record the SDK's reported cost against each pass's `maxBudgetUsd`. Record outcome here.

## Rollout shape

Tests first: the resolution doctest is written before the resolver change.
Done when: the doctest passes; change-selected tests, typecheck, and lint
pass; the live check shows the run banner naming the DeepSeek model for a
tiered step and a review pass, and the run succeeds without a Claude login in
play. No migration: `smallModel` keeps its shape; the loader only accepts more
values.

## Live check results (2026-10-15)

Worktree test box, `agentModel: deepseek/deepseek-v3.2`, `openrouter` key in a
scratch secret store. A two-step probe procedure (`model: efficient`, and no
model):

- Before: `efficient → claude-haiku-4-5-20251001`; no model → `claude-opus-5-5`.
- After: both steps `deepseek/deepseek-v3.2`; both succeeded.

Chat title and full review passes through `createSdkChatReviewer`, with a
synthetic 39,022-character transcript (the renderer's ceiling is 40,000):
both resolved to `deepseek/deepseek-v3.2` and succeeded under the $0.25
`maxBudgetUsd` cap (title 9.8 s, review 48.2 s). The SDK's cost figure was not
captured directly; the cap did not trip. Wakeup jobs already followed the
default before this change (`reactor/engine/batch-jobs.ts:55`).

