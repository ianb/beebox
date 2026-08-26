---
title: "Box model/engine policy"
status: implemented
workstream: model-engine-policy
issues:
  - ../../../issues/features/2026-07-17-chat-model-pin-default.md
  - ../../../issues/features/2026-08-03-default-model-and-non-default-indicator.md
  - ../../../issues/features/2026-08-08-reactor-agent-model-not-pinnable.md
  - ../../../issues/features/2026-08-23-choose-the-engine-for-a-new-chat.md
  - ../../../issues/features/2026-08-25-small-model-slot.md
  - ../../../issues/bugs/2026-08-25-haiku-nickname-reaches-codex-verbatim.md
  - ../../../issues/code-quality/2026-07-30-structured-output-passes-load-full-box-context.md
---

# Box model/engine policy

A box can say which native harness it runs (`agentEngine` in `config/box.json`).
It cannot say which model it thinks with. This plan gives a box one **model
policy** — a pinned model that chat, the reactor, and every other unpinned agent
run read — plus the per-chat override, the pin affordance, and the off-default
indicator that make the policy visible where the boxholder already looks.

## The question this plan answers

**"Which engine, which model, and how much context does *this* agent invocation
get?"** Nothing answers it today. Each surface answers locally and differently:
chat persists native model ids per session; procedures use portable tiers
through `resolveProcedureModel(engine, tier)` (`src/shared/agent-models.ts:56`);
the reactor passes nothing; the chat reviewer and retro observer pass the
provider-shaped nickname `"haiku"`; all read the engine from
`loadAgentEngine(boxRoot)`. The tier resolver was built for procedures alone by
`issues/closed/bugs/2026-08-23-procedure-model-pins-are-claude-only.md` (commit
`8a7dced6`), which deliberately left the other callers where they were.

The goal is **one policy with no unfilled corner cases** — every invocation path
gets engine + model + context from the same answer, rather than a patch per
caller.

**All eight tracks have shipped.** A–D: the `agentModel` field, the resolution
ladder, the reactor reading it, per-chat follow-vs-explicit, the pin affordance,
the off-default indicator, and the migration off `.callback-box/chat-model.json`.
E–H: enabled engines in box config, the chat-start picker that chooses engine and
model together, the small-model slot (which closed the live
`"haiku"`-reaches-Codex defect), and the context opt-out for the four structured
passes. The reference doc is `docs/model-policy.md`.

## Job to be done

Three situations, all the boxholder's, all on a box that already works:

- *When I bump one chat to a stronger model for a hard question and then move on
  to something else, I want the chat bar to tell me at a glance that this chat is
  off my usual model, so I can drop it back instead of paying flagship prices for
  "what time is it in Tokyo".*
- *When I decide my box should think with Sonnet from now on, I want to say that
  once — in the place where I already switch models — so every new chat and every
  overnight wakeup follows it, instead of me re-picking per chat and the reactor
  quietly running on whatever the SDK defaults to this week.*
- *When I am mid-answer in a long chat and I change the box default, I do not
  want the answer I am reading to be interrupted or re-rolled. I want the change
  to take hold the next time that chat starts cold.*

The third is why "pin" is a different action from "select": pinning is a
statement about the box, not an instruction to this conversation.

## Stated preferences this plan trades against

- `docs/engineering-principles.md:12` **1. Types are structure** — the
  three-state per-chat model (explicit / follow / none) must be a type, not a
  `string | null` whose `null` means two things.
- `docs/engineering-principles.md:37` **3. Validate at boundaries and during
  parsing** — a pinned model id crossing the tRPC/config boundary is validated
  against the engine registry, once.
- `docs/engineering-principles.md:49` **4. Resilient AND never silent** — a
  pinned model that does not belong to the box's current engine must degrade
  visibly, not vanish.
- `docs/engineering-principles.md:95` **8. One way to do each thing** — one
  resolver answers "what model does this run use", read by chat and by
  `createAgent`. Not two ladders.
- `docs/engineering-principles.md:151` **13. A control shows the state the system
  is in, never the one it intends** — the chat's model control must show the
  model the *live subprocess* is using, not the default that will apply after the
  next cold start.
- `CLAUDE.md` — "don't add features beyond what the task requires"; the
  validation contract; owner-gated box configuration.
- `code-style.md` — no default parameters, max 2 positional params, no `any`.
- Recent precedent: `shared/agent-models.ts` (portable procedure tiers) is the
  densest statement of how this codebase already models "engine-relative model
  choice". This plan reuses that vocabulary rather than inventing a second one.

## What already exists

**The premise of the oldest issue is stale.** `issues/features/2026-07-17-chat-model-pin-default.md`
says the per-chat model is in-memory only and the box pointer is box-global. Per-chat
persistence shipped since:

- `src/core/chat/session/state.ts:66`: *"export function chatModelFileForSession(sessionId: string): string {"* — each web chat already persists its own override under `.callback-box/chat-models/<id>.json`.
- `src/webapp/routes/chat.ts:102`: *"modelFile: sessionId === null ? DEFAULT_MODEL_FILE : chatModelFileForSession(sessionId),"* — the box-wide file is only the seed for a session with no id yet.
- The `sessionId === null` branch is **not** dead, and the box-wide file is **not** vestigial. A modern web client coins its id, but `"new"` is still a live shape: `src/webapp/routes/chat-send-target.ts:19-22`: *"`\"new\"` is the legacy shape: a client that did not coin an id (an older build, the iOS app, a Codex box) asks the harness to name the chat."* Reservation refuses non-Claude boxes outright — `src/core/chat/session/reserve.ts:189`: *"if (engine !== \"claude\") return { kind: \"unsupported\" };"* — so on a **Codex box every chat takes that path**, and `.callback-box/chat-model.json` is its live per-box model source.
- Worse for the plan's purposes, a fresh session then **promotes** the inherited value into its own file: `src/core/chat/session/index.ts:247`: *"if (this.modelFile !== null && this.currentModel !== null) saveCurrentModel(this.boxRoot, { modelFile: this.modelFile, model: this.currentModel });"* — so today a Codex box's chats are born *explicitly* pinned to the box value and would never follow a later change. Track C has to stop that promotion for a chat that made no choice.

So the "core new storage" the issue asks for is already built. What is missing is
the box-level pointer, the follow semantics, and the surfaces. Reuse, do not
rebuild:

| Thing | Where | Reuse / rebuild |
|---|---|---|
| Per-chat model persistence | `src/core/chat/session/state.ts:66` | Reuse unchanged; only the meaning of *absent* changes. |
| Box config store, cache, owner-gated write, git commit | `src/core/box/config.ts:16`, `src/webapp/box-config-write.ts:86`, `src/webapp/trpc/routers/admin.ts:223` | Reuse — the model policy is a `box.json` field beside `agentEngine`. |
| Engine-relative model tiers | `src/shared/agent-models.ts:40` (`PROCEDURE_MODELS`), `:56` (`resolveProcedureModel`) | Reuse — gives cross-engine degradation *and* the smarter/dumber ranking. |
| Engine-scoped model registry + validation | `src/shared/chat-models.ts` (`isChatModelAllowed`, `chatModelForEngine`) | Reuse for the pin's boundary validation. |
| The spawn boundary where a chat's model is fixed | `src/core/chat/session/index.ts:180`: *"const compatibleModel = chatModelForEngine(preview.engine ?? \"claude\", this.currentModel);"* | Reuse — this is exactly the cold-start point where default resolution belongs. |
| Model plumbing into agent runs | `src/core/agent/types.ts:24`: *"model?: string;"*, `src/core/agent/index.ts:109`: *"model: opts.model,"* | Reuse — the reactor's gap is that nothing *fills* it. |
| Box-config engine selection UI | `src/frontend/src/components/admin/AgentEngineSection.tsx` | Reuse the section; the model policy joins it. |
| Model sub-panel | `src/frontend/src/components/chat/SessionChip-model-panel.tsx:29` | Extend with a pin control and a state marker. |
| Model id table + retirement mapping | `src/shared/model-ids.ts` | Reuse unchanged. |
| Existing model doctest | `test/core/chat-models.doctest.md` | Extend — the resolver's tests belong here. |

Nothing here needs a new utility module. The one net-new file is the resolver
(below), and it exists to keep principle 8 (one ladder) honest.

## Prior art (external)

- **The Agent SDK can change a live session's model.** `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2435`: *"setModel(model?: string): Promise<void>;"*, with a `'set_model'` control subtype at `:4117` (SDK 0.3.241). This contradicts the comment at `src/webapp/trpc/routers/chat-control-procedures.ts:152`: *"a live `set_model` control request isn't honored"*, which appears to predate the SDK feature. Anthropic's docs confirm the semantics: the current turn finishes on the old model, history is preserved, and only the next message changes model — with the caveat that prompt caches are model-scoped, so the switch re-processes the accumulated context at full input price. Relevant to the restart question in Track C, and recorded here so nobody re-derives it. https://code.claude.com/docs/en/model-config
- **Programmatic model switching is a live upstream request.** anthropics/claude-code#17772 asks for exactly this in autonomous agents; the SDK method above is the answer. No workaround needed. https://github.com/anthropics/claude-code/issues/17772
- **No prior art found** for the specific two-level shape this plan builds (a box-scoped default that per-session overrides *fall through to*, with the resolution pinned at subprocess spawn). Claude Code's own `/model` has a one-level user/project setting with no per-conversation inheritance, so there is nothing to copy. Recording the empty search rather than implying one exists.
- **Codex side unchecked.** The Codex harness's own model-switching semantics were not searched, because this plan never switches a live Codex session's model — it resolves at spawn (`codex-run.ts:75` takes `model` per run). If Track C adopts live `setModel`, that search becomes a prerequisite for the Codex half.

## Tracks / scope

Ordered by implementation dependency: the policy has to exist before anything
can read it, and it has to be read before it can be shown.

### Track A — the policy field and its resolver

**What.** Add `agentModel?: string` to `config/box.json`, beside `agentEngine`.
Add one resolver that answers "what model does a run on this box use", used by
every reader.

**Why this needs to change.** Today there is no answer. `src/core/box/config.ts:113` (`loadAgentEngine`) tells a box which harness it runs; nothing tells it which model. The reactor path proves the cost: `src/core/reactor/batch-jobs.ts:53` creates its agent and `:60` invokes it with `boxRoot`, `systemPrompt`, `prompt`, `maxTurns`, `maxBudgetUsd` — and no `model`, so `src/core/agent/run.ts` leaves it at the SDK default. A boxholder can answer "which model does my chat use" and cannot answer it about the agent that does most of the box's autonomous work.

**Direction.**

```ts
// src/core/box/config.ts
export interface BoxConfig {
  agentEngine?: AgentEngine;
  /** The box's pinned model. A concrete id from one engine's registry; other
   *  engines resolve it through its tier. Missing means no policy. */
  agentModel?: string;
  // …
}
export async function loadBoxModel(boxRoot: string): Promise<string | null>;
```

```ts
// src/shared/agent-models.ts — new, beside PROCEDURE_MODELS
/** Tier of a concrete model id, for cross-engine translation and ranking. */
export function modelTier(model: string): ProcedureModelTier | null;
export const TIER_RANK: Record<ProcedureModelTier, number>; // efficient 0 … strongest 3
```

```ts
// src/core/model-policy.ts — new; the single ladder
export type ChatModelChoice =
  | { kind: "explicit"; model: string }
  | { kind: "follow" };

export function resolveBoxModelForEngine(
  engine: AgentEngine,
  pinned: string | null,
): string | null;

export function resolveEffectiveModel(
  { engine, pinned }: { engine: AgentEngine; pinned: string | null },
  choice: ChatModelChoice,
): { model: string | null; source: "explicit" | "default" | "none" };
```

The ladder, in one place:

0. **Normalize first.** Every id entering the ladder — the per-chat choice and
   the box pin alike — passes through `normalizeModelId` (`src/shared/model-ids.ts:44`)
   *before* validation or tier lookup. This is load-bearing: normalization today
   happens only at the Claude spawn boundary (`src/core/agent/run.ts:78`), well
   after `isChatModelAllowed` would have rejected a retired id and dropped it to
   `null`. A pin of `claude-opus-4-8` must resolve, not vanish.
1. `choice.kind === "explicit"` and `isChatModelAllowed(engine, choice.model)` → that model, `source: "explicit"`.
2. Otherwise the box pin: if `isChatModelAllowed(engine, pinned)` → `pinned`; else `modelTier(pinned)` → `resolveProcedureModel(engine, tier)` → `source: "default"`.
3. Otherwise `null`, `source: "none"` (the harness's own default).

Storing a **concrete id** rather than a tier is deliberate: within an engine the
round-trip is lossless, so the picker shows back exactly what the boxholder
picked (principle 13). The tier table is the *degradation* path, used only when
the box's engine no longer matches the pinned model's family — where `codex`'s
`strong` and `strongest` both resolving to Sol (`src/shared/agent-models.ts:50-51`)
is an acceptable, documented flattening rather than a silent one.

An explicit per-chat model that belongs to the *other* engine already degrades
today (`chatModelForEngine` at `src/core/chat/session/index.ts:180`); step 1
keeps that, and such a chat then falls to the box pin instead of to nothing.

**Vocabulary lock-ins.**

- Config field name: **`agentModel`** (parallel to `agentEngine`).
- The two per-chat states are **explicit** and **follow**. Not "pinned" — *pin*
  is reserved for the box-level action, and using it for both is how the two
  levels get confused.
- The box-level noun in UI copy is **"box default"**; the action is **"Pin as
  box default"**.

**First implementation chunk.** `agentModel` on `BoxConfig` + `boxConfigSchema`,
`modelTier`/`TIER_RANK` in `agent-models.ts`, `src/core/model-policy.ts`, and the
resolver's cases in `test/core/chat-models.doctest.md`. No reader yet, no UI.

### Track B — the reactor and every other unpinned agent run

**What.** The reactor's agent runs pass the box policy's model. **Named call
sites opt in; there is no blanket default inside `createAgent`.**

**Why this needs to change.** See Track A. The plumbing exists and is simply
never filled: `src/core/reactor/batch-jobs.ts:59-65` invokes with `boxRoot`,
`systemPrompt`, `prompt`, `maxTurns`, `maxBudgetUsd` and no `model`.

**Direction.** `batch-jobs.ts` and `chat-jobs.ts` resolve
`resolveBoxModelForEngine(engine, await loadBoxModel(boxRoot))` once per reactor
run and pass it as `model` when it is non-null. Nothing else changes.

**Why not a blanket rule in `createAgent`.** An earlier draft put the fallback in
`createAgent` so every unpinned run inherited the policy. That is the wrong
seam, for two concrete reasons:

- **It silently re-tiers procedure steps.** A step that omits `model:`
  (`src/core/procedure/engine-run-execute.ts:100-102`) means "the harness
  default" today. Under a blanket rule it would mean "whatever the box last
  pinned", changing a box's authored procedures with no edit to the procedure.
  A release note is not a substitute for a per-surface decision.
- **It would move test-harness runs off their baseline.** The scenario validator
  (`src/scenario/runner.ts:111`) and the knowledge-audit runner
  (`src/dev/lib/test-runner.ts`) also go through `createAgent`; making their
  model depend on a box's config makes runs non-comparable across boxes.

Triage, the chat reviewer, the retro observer, and procedure steps keep today's
behavior. Each is a one-line change if it is later wanted — the resolver stays
the single ladder (principle 8); what is per-surface is *whether* to consult it.

**Snapshot semantics.** `createAgent` resolves its engine delegate once and
caches it (`src/core/agent/index.ts:162-166`: *"resolving ??= loadAgentEngine(boxRoot).then((engine) => {"*), so an Agent instance already snapshots box config at first invoke. The reactor resolves its model at the same altitude — once per run, before the agent is created — so a resumed per-thread chat job keeps one model for the whole run.

**Announced behavior change.** A box that pins a model changes what runs on its
nightly wakeup and inside its procedures. `issues/features/2026-08-08-reactor-agent-model-not-pinnable.md`
names this as the reason the issue was `needs: design`. Because the policy field
is *new*, no existing box is affected until its owner pins something — the change
is opt-in by construction, which is the mitigation. The Rollout section carries
the note that must ship with it.

**First implementation chunk.** The `createAgent` change plus a doctest that a
fake agent receives the pinned model when the caller omits one, and the caller's
model when it does not.

### Track C — per-chat follow-vs-explicit

**What.** A chat with no persisted model *follows* the box default instead of
falling to the harness default. Resolution happens at subprocess spawn and is
held for that subprocess's life.

**Why this needs to change.** Absence currently means "harness default"
(`src/core/chat/session/index.ts:112`: *"this.currentModel = this.modelFile === null ? null : loadCurrentModel(this.boxRoot, this.modelFile);"*), which leaves no state for "follow". Without it, pinning a default would do nothing for the chats that never chose.

**Direction.**

- Split the field. `ChatSession` keeps `private explicitModel: string | null`
  (the persisted choice; `null` = follow) and `private resolvedModel: string | null`
  (what the live subprocess is running). Only the second is handed to the run at
  `src/core/chat/session/index.ts:195`: *"model: compatibleModel ?? undefined,"*.
- Resolve at `startRun`, replacing the `chatModelForEngine` line at `index.ts:180`
  with `resolveEffectiveModel`. This is the cold-start boundary the issue asks
  for: a warm session's `resolvedModel` is never recomputed, so nothing swaps a
  model mid-flight.
- `setModel(null)` keeps deleting the per-session file; it now means "follow the
  box default" rather than "use the harness default".
- **A chat that made no choice never gets a file.** Today a fresh session
  promotes its inherited model into its own file at `src/core/chat/session/index.ts:247`, which is what would make a `"new"`-shaped chat born explicitly pinned. Promotion now happens only when `explicitModel !== null` — a follower stays a follower across its whole life.
- **Retire `DEFAULT_MODEL_FILE`, carefully.** It is a live path for `"new"`
  sends — every chat on a Codex box (What already exists). Retiring it is
  therefore a behavior-preserving *substitution*, not a dead-branch cleanup: the
  fresh-session path stops reading the file and resolves the box policy instead,
  and the migration (Rollout) copies the file's value into `agentModel` first, so
  a Codex box's chats keep starting on the same model. After the substitution
  those chats *follow* rather than freeze, which is the intended change and the
  one to state in the release note. `src/webapp/routes/chat.ts:102`'s seed and
  `src/core/chat/session/state.ts:63` go away; `src/field-test/run-seed.ts:79`
  writes `agentModel` in `box.json` instead.
- **Selecting still restarts; pinning never does.** `setModel` keeps its current
  behavior (`chat-control-procedures.ts:165-176`), including the deferred restart
  for a busy session — an explicit select is an instruction to *this*
  conversation and must take effect now (principle 13). A new owner-gated
  `setDefaultModel` writes `box.json` and touches no session.
- Status grows the fields the UI needs to be honest:
  `{ model, source: "explicit" | "default" | "none", boxDefault, pendingModel }`,
  where `pendingModel` is non-null only when a live session's `resolvedModel`
  differs from what a cold start would now pick.

**Vocabulary lock-ins.** `source` values are `explicit` / `default` / `none`, on
the wire and in the UI's logic.

**First implementation chunk.** The `explicitModel`/`resolvedModel` split, the
`startRun` resolution, the `setDefaultModel` procedure, the status shape, and the
migration. UI unchanged in this chunk — it keeps working because `status.model`
keeps its meaning.

### Track D — the pin affordance and the off-default indicator

**What.** The model sub-panel gains a pin control per row and a marker for the
box default; the chip button gains a smarter/dumber mark.

**Why this needs to change.** Two filed asks, one surface. `SessionChip-model-panel.tsx:29-31` renders one action per row (select) and one state (`✓`), which cannot express two levels.

**Direction.**

- Rows become: a leading state slot (`✓` = this chat's choice) and a trailing pin
  button (`aria-label="Pin <label> as the box default"`), with the pinned row
  marked `Default`. Owner-only — the pin writes box config through
  `ownerProcedure` (`admin.ts:223`), so a non-owner must not see a control that
  can only 403. `trpc.admin.boxConfig` is itself owner-gated; the panel takes
  `canPin` from the chat page's existing owner signal rather than probing.
- **The panel refetches status when it opens.** The chat's model state is read
  once per `sessionId` today (`InteractiveChat-hooks.ts:129-139`), so a default
  pinned in another tab — or from the admin page — would otherwise never reach an
  already-open chat, and the panel would show a stale `Default · …` row. Opening
  the sub-panel is the natural refetch point: it is the only moment the box
  default is displayed, and it costs one query per open (principle 13).
- The first row is **`Default · <resolved label>`** and is `✓` when the chat
  follows. Selecting it clears the chat's explicit model (today's `null` path).
  When no default is pinned it reads `Default` alone, exactly as now.
- Indicator on the chip button: nothing when the chat follows, or when its
  explicit model *is* the resolved default, or when no default is pinned;
  otherwise compare `TIER_RANK` of the effective model against the resolved
  default — above → an up mark, below → a down mark, equal-tier-different-family
  → nothing. The accessible name says it in words ("Sonnet 5 — below the box
  default, Opus 5"); the mark alone never carries the meaning.
- The admin **Agent Engine** section becomes **Agent engine and model**: the
  engine radio plus a model select whose options are
  `chatModelOptions(config.agentEngine)`, with a first option for "no default"
  and an unrecognized stored value shown as itself. Same mutation
  (`updateBoxConfigFields`), one more field — **plus the `commitWarning` the
  section currently drops** (`admin.ts:249` returns it; `AgentEngineSection.tsx:64-74`
  renders only Saving / Saved / error), so a save whose git commit failed stops
  being invisible. This is the surface for a boxholder
  who is not in a chat, and the place engine and model are visibly one policy.

**Vocabulary lock-ins.** UI copy uses "box default" everywhere; the admin section
says "New chats and unpinned agent work use this model."

**First implementation chunk.** The panel's two-action row plus the
`setDefaultModel` wiring. The indicator is the second chunk; the admin section
the third.

### Track E — enabled engines

**What.** `engines: { claude: boolean; codex: boolean }` in `config/box.json`:
which engines this box may offer at all. Set in Settings beside the default-engine
radio.

**Why this needs to change.** A box may have no Codex subscription. Nothing
records that, so a picker offering both engines would let someone start a chat
that fails at its first message. The one thing that does exist —
`engine-availability-store.ts` — is a different fact: machine-level, *quota
exhausted until `retryAt`*, advisory and self-expiring. It answers "not right
now", never "not on this box". Detection was considered and rejected as the
gate: there is no Codex login probe (only `checkClaudeAuth`), it would cost
latency every time the picker opens, and the Claude probe already returns
inconclusive often enough to need a retry (`auth-preflight.ts:41-49`).

**Direction.** Absent `engines` means *only the box's `agentEngine` is enabled* —
conservative, and it keeps every existing box exactly as it behaves now. The
box's default engine may never be disabled: Settings refuses it, because a box
whose default engine is off cannot run. Enablement gates what the picker
*offers*; the run-path auth preflight still catches an engine that is enabled but
not logged in, with its actionable message. The transient quota store composes on
top: an enabled engine that is out of quota shows as such rather than disappearing.

**First implementation chunk.** The config field + `loadEnabledEngines`, the
Settings checkboxes with the can't-disable-the-default rule, and doctests for the
absent-field default and the refusal.

### Track F — the chat-start picker: engine and model together

**What.** Before a chat's first message, the model panel lists **every enabled
engine's models under its own heading**, box-default engine first, using each
engine's own model names. Picking a model picks the engine with it. After the
first message the chat's engine is fixed and only its own models are offered.

**Why this needs to change.** Two gaps meet here.
`issues/features/2026-08-23-choose-the-engine-for-a-new-chat.md`: a new chat
silently takes the box engine and nothing offers a choice. And the model choice
itself is unavailable before the first message — Track D shipped a panel that
opens pre-session with its rows disabled, which is the wrong half of the
boxholder's decision ("choose the model at the very beginning of a chat").

**Direction.**

- **The panel's shape.** A `Default · <resolved label>` row on top (follow the
  box policy, ✓ when following), then one section per enabled engine. A disabled
  engine keeps its heading and says *not enabled for this box → Settings*, so the
  absence is explained rather than silent. After the first turn, the chat's own
  engine section is the only one with models; the other keeps its heading and
  reads *fixed when this chat started*. **A grayed heading, not a grayed list**:
  three unusable model rows are noise, and the heading already carries the fact.
- **Engine is fixed at birth, deliberately** — the boxholder's rule, and the
  reason `2026-08-23` gives: transcripts live in different stores and models are
  engine-scoped, so a mid-chat conversion would silently change two things at
  once. The panel states it rather than leaving the control mysteriously absent.
- **Carrying the choice to a chat that does not exist yet.** A choice made before
  the first message has nowhere to persist — there is no session id and so no
  model file. It rides the same way seed features do. `reserveSession` already
  carries `contextDir` and `seedFeatures` and already records an engine
  (`registry.ts:250-253` → `recordSessionStart({ engine })` → `history.ts:240`),
  so it takes `engine` and `model` too.
- **Coin only for Claude.** `reserve.ts:189` refuses a coined id on a non-Claude
  box, and that is not an obstacle: a Codex chat takes the `"new"` path, which is
  what every Codex chat does today. So the client coins an id when the chosen
  engine is Claude and sends `"new"` with the choice otherwise. This was the
  reason an earlier draft cut this track; it was wrong.
- **Pinning stays inside the box's default engine.** The pin writes `agentModel`,
  which the resolver translates across engines by tier — so pinning Luna on a
  Claude box would quietly mean "Haiku for every Claude chat". Rather than
  explain that, the pin is offered only in the default engine's section; changing
  which engine the box defaults to is a Settings decision.

**Vocabulary lock-ins.** Model rows use each engine's own names (Haiku 4.5,
Sonnet 5, Opus 5, Fable 5; Sol, Terra, Luna) — never a tier name. Tiers are the
translation layer, not a thing the boxholder picks in chat.

**First implementation chunk.** `engine` + `model` through `reserveSession` →
`registry.reserve` → the history record and the chat's model file, with the
client coining only for Claude. UI second.

### Track G — the small-model slot

**What.** One declared slot for the cheap passes — chat review, retro
observation, triage, the procedure judge — resolved engine-aware like everything
else.

**Why this needs to change.** It is a live defect, not a preference:
`reviewer.ts:72` and `observer.ts:27` hold `const DEFAULT_..._MODEL = "haiku"`, a
provider-shaped nickname, and `codex-agent.ts:45` forwards `invoke.model`
verbatim — so a Codex box asks the Codex SDK for `haiku`
(`issues/bugs/2026-08-25-haiku-nickname-reaches-codex-verbatim.md`). This is the
same class the procedure fix closed for procedures alone. `triage/index.ts:147`
passes nothing at all, so it runs on whatever the SDK defaults to.

**Direction.** A box-level `smallModel` beside `agentModel`, defaulting to the
`efficient` tier resolved for the box's engine, and the four call sites ask the
resolver for it rather than naming a string. One knob, static, no routing — which
is what `2026-08-25-small-model-slot.md` argues for. The per-engine-vs-one-value
question it leaves open is answered by the tier translation already in place: one
box-level value, resolved per engine.

**First implementation chunk.** The slot in the resolver + the four call sites,
with a doctest asserting a Codex box never receives a Claude nickname.

### Track H — context for the structured passes

**What.** The four small passes stop loading the full box context.

**Why this needs to change.**
`issues/code-quality/2026-07-30-structured-output-passes-load-full-box-context.md`:
each of them loads the box CLAUDE.md and the generated agent guide to answer a
narrow structured question. They pay for context they cannot use, on the tier
least able to use it.

**Direction.** The same slot Track G introduces carries a context setting, so
"which model and how much context" is one answer per invocation kind rather than
two mechanisms. The SDK's `settingSources` is the lever; the measurement of what
each pass actually needs comes first, because trimming context on a judgment pass
is exactly where a silent quality regression hides.

**First implementation chunk.** Measure: `pnpm agent-context reactor --box <box>`
before changing anything. It reported **~9,659 always-loaded words** on the test
box, 9,082 of them the box CLAUDE.md — which is what the trim was then made
against. The retro observer is the one site where box vocabulary could plausibly
have helped; it is trimmed with the others and the code says to look there first
if observation quality drops.

## Could this be simpler?

**The simplest version that could plausibly work:** keep `.callback-box/chat-model.json`
as the box default, add one tRPC mutation that writes it, add a pin icon to the
model panel, and have `ChatSession` fall back to that file when the per-session
file is absent. No config field, no resolver module, no tier translation, no
reactor, no indicator. Perhaps eighty lines.

What the fuller plan buys, specifically:

- **The reactor.** The simple version leaves `2026-08-08` unfixed, because
  `createAgent` has no business reading a chat-named dotfile. Putting the policy
  in `box.json` is what makes one field legible to both readers (principle 8).
- **Owner-gating and auditability.** `.callback-box/chat-model.json` is written by
  a `publicProcedure` today and is not committed. `box.json` goes through
  `updateBoxConfigFields`, which is owner-gated and git-commits the change
  (`box-config-write.ts:72-78`). A box-wide policy that any viewer can change,
  leaving no record, is the wrong shape.
- **Cross-engine degradation.** Without `modelTier`, a box that switches
  `agentEngine` silently loses its policy — `chatModelForEngine` returns `null`
  and everything falls to the harness default with no signal. That is precisely
  "resilient by going silent" (principle 4).
- **The indicator.** It needs a ranking, and the ranking is the tier table. Once
  the tiers are in, the indicator is small; without them it is a hardcoded order
  in a component, which `2026-08-03` explicitly asks not to do.

What the plan does **not** buy and should not grow into: a per-run model
override UI, a cost dashboard, or per-agent-kind policies (reactor-model separate
from chat-model). The `2026-08-08` issue raises the split explicitly; see NOT in
scope.

## Subplans

None. The one candidate was per-chat engine choice
(`issues/features/2026-08-23-choose-the-engine-for-a-new-chat.md`), and it is not
a subplan either — it is deferred entirely (NOT in scope), because it is a
separate mechanism rather than a sub-question of this one.

## Failure modes

> **Critical gap: none outstanding.** The two candidates are handled below —
> a pinned model that the current engine cannot run (Track A step 2), and a live
> session whose resolved model no longer matches the default (`pendingModel` in
> Track C).

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `agentModel` in `box.json` is a hand-edited string no engine knows | New — resolver doctest | Yes — the resolver rejects it (below); it never reaches a spawn | Clear: the resolver `console.warn`s once per config load, `boxConfig` returns the raw string, and the admin select renders it as an unrecognized value rather than silently showing "no default" |
| `agentModel` belongs to the other engine (box switched harness) | New — resolver doctest | Yes — tier translation (Track A step 2) | Clear: status reports `source: "default"` with the *translated* model, and the panel marks the translated row |
| Pin succeeds in `box.json` but the git commit fails | Existing — `box-config-write.ts` returns `commitError` | Server-side yes (`admin.ts:242` logs and returns `commitWarning`); **client-side no** — `AgentEngineSection.tsx:64-74` renders Saving / Saved / error and drops `commitWarning` entirely | **Silent today.** D3 must render `commitWarning`; without that fix "saved but not committed" is invisible in the surface this plan reuses |
| A non-owner clicks pin | New — a tRPC doctest asserting `ownerProcedure` rejects | Yes — `ownerProcedure` | Clear: 403; and the control is not rendered without `canPin` |
| The default changes while a chat is warm; the chat keeps the old model | New — session doctest | Yes, by design — `resolvedModel` is fixed at spawn | Clear **only with `pendingModel`**: without it the panel would claim the new default while the subprocess runs the old one, which is principle 13's exact failure |
| Two tabs pin different models at once | No — accepted | Yes — `withFileLock` + `withCardLock` in `mutateConfig` (`box-config-write.ts:63-64`) serialize the writes | Clear at the store; **stale in the other tab** — `InteractiveChat-hooks.ts:129-139` reads status only when `sessionId` changes, and `AgentEngineSection.tsx:25` invalidates only its own cache. Handled by D1's refetch-on-open (below), not by hoping |
| Migration runs on a box whose `.callback-box/chat-model.json` holds a retired id | New — migration doctest | Yes — `normalizeModelId` at read (`model-ids.ts:44`) | Clear: the migrated `box.json` carries the current id |
| Migration runs twice | New — migration doctest | Yes — idempotent: the file is gone after the first run, and an existing `agentModel` is never overwritten | Silent, and correctly so — a no-op needs no report |
| A procedure card that omitted `model:` now inherits the box policy and behaves differently | Partly — existing procedure doctests pin tiers | Yes — explicit tiers still win (Track B) | **Clear only via the release note.** This is the announced change; nothing in code can distinguish "omitted on purpose" from "omitted by default" |
| A reactor run is in flight when the pin changes | New — reactor doctest | Yes, by design — the model is resolved once per run (Track B), so a run never changes model midway | Silent, and correctly so — matching chat's spawn-time rule |
| Codex chat pinned to a Claude model, and vice versa | Existing (`chat-models.doctest.md`) + new | Yes — step 1 filters, then falls to the box pin | Clear: the panel shows the fallen-through choice, not a phantom `✓` |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — *ADDRESSED, with one contract.* The analogue is
  an agent hand-editing `box.json` to `agentModel: "sonnet"` (a tier alias, not
  an id). Validation lives in **one** place, the resolver — not in the config
  loader, which deliberately does no schema validation at all
  (`src/core/box/config.ts:155`: *"const config: BoxConfig = JSON.parse(raw);"*),
  and not as an enum in `boxConfigSchema` (`src/webapp/trpc/routers/admin.ts:37`),
  which is a `parse` — a strict enum there would make one bad character throw the
  whole admin page (`admin.ts:186-192` already turns an unreadable config into a
  `PRECONDITION_FAILED`). So: `agentModel` is `z.string().optional()` in the
  admin schema, the raw value reaches the UI to be shown as unrecognized, and the
  resolver is the boundary that rejects it, loudly and once (principle 3, and
  principle 4 — degrade visibly rather than throw the page away).
- **Stale ref** — *ADDRESSED.* A pinned id that has since been retired resolves
  through `normalizeModelId` (`model-ids.ts:44`), which already carries
  `claude-opus-4-8` forward. The plan adds no second retirement table.
- **Two agents touching the same card** — *ADDRESSED.* `box.json` writes go
  through `mutateConfig`'s card lock plus file lock (`box-config-write.ts:63-64`),
  which is the existing serialization for exactly this.
- **Hand-edit drift** — *ADDRESSED* for `box.json` (schema parse). *GAP,
  accepted*: a hand-edited `.callback-box/chat-models/<id>.json` with a garbage
  model already degrades to `null` via `loadCurrentModel`'s type check
  (`state.ts:79`), and after this plan that chat follows the box default instead
  of the harness default — a better outcome, still silent. Not worth a warning
  path for a file no human is expected to open.
- **Fabricated free-form value** — *ADDRESSED by construction.* Every value in
  this plan is drawn from a closed registry (`MODEL_ID`, `AGENT_ENGINES`). There
  is no free-form field for an agent to invent.
- **Validation error UX** — *ADDRESSED.* The pin mutation's rejection reuses
  `setModel`'s existing message shape (`chat-control-procedures.ts:159`:
  *"Model ${input.model ?? \"default\"} is unavailable for ${engine} chats"*),
  which reads correctly in an agent's context and in a toast.
- **Partial migration / transition state** — *ADDRESSED.* During the window
  where `.callback-box/chat-model.json` still exists and `box.json` has no
  `agentModel`, the resolver reports `source: "none"` and the box behaves exactly
  as it does today. There is no state in which the two disagree, because the
  legacy file stops being read the moment Track C lands, and the migration only
  ever *adds* a config field. Boxes that never had the file need no migration.

## NOT in scope

- **A separate reactor model.** `2026-08-08` asks "one setting or two". One.
  Two settings double the config surface to serve a use case nobody has stated
  ("chat on the big model, batch work on the cheap one"). If it is wanted later,
  `agentModel` becomes the fallback and a `reactorModel` overrides it — an
  additive change, not a rework.
- **Per-agent-kind policy** (triage vs retro vs procedure). Same reason; the
  callers that care already pass explicit models.
- **Mid-chat engine conversion** — see below. (An earlier draft deferred
  per-chat engine choice *entirely*, reading `reserve.ts:189`'s refusal of
  coined ids on a non-Claude box as "this changes how a chat is named". That was
  wrong: a Codex chat simply does not coin, which is what every Codex chat does
  today. Track F builds it.)
- **Mid-chat engine conversion.** `2026-08-23` rules it out for its own reasons
  this plan does not relitigate: transcripts live in different stores and models
  are engine-scoped.
- **Adopting the SDK's live `setModel`** in place of restarting on select. It is
  a real simplification (Prior art) but it is a change to how *today's* feature
  works, with its own cache-cost and Codex-parity questions. Filed as an open
  question, not built here.
- **A cost or usage indicator.** The `2026-08-03` job story is about noticing the
  model, not about seeing the bill.
- **Global (cross-box) preference.** `2026-08-03` floats "per box, or a global
  preference". Per box: the box is the unit of configuration everywhere else in
  this system, and a global preference has no home to live in.
- **Retiring `chatModelOptions`' `"Default (Opus)"` label.** The label names the
  harness default and stays accurate when no policy is pinned. Track D changes
  what the *row* says, not the registry.

## Open design questions

- **Should pinning restart running-but-idle followers?** The issue says
  changing the default must not restart active sessions, and this plan follows
  that. But a chat that is warm and idle would pick up the new default at
  effectively zero cost, and `pendingModel` exists only because it does not.
  **Lean: keep the issue's semantics.** The restart is cheap in tokens but not
  free, and "pin does not touch conversations" is the simpler rule to state. If
  `pendingModel` proves annoying in use, revisit.
- **Should `select` use the SDK's live `setModel` instead of restarting?**
  See Prior art. **Lean: not in this plan.** It changes existing behavior, needs
  a Codex-side equivalent, and the restart path already defers around a busy turn.
- **Does the admin section need a "no policy" option distinct from a model?**
  Yes, almost certainly — a boxholder must be able to unpin. **Lean:** the select's
  first option is "No default (use the harness default)", writing `agentModel:
  undefined`. Settled enough to build; recorded here because `updateBoxConfigFields`
  currently has no "clear this field" idiom and one has to be chosen
  (`config.agentModel = undefined` vs `delete config.agentModel`).
- **Does the small slot want its own enablement?** A box with Codex enabled but
  Claude as its default runs its small passes on Codex's cheap tier. **Lean:
  yes, that is right** — the small model follows the invocation's engine, not a
  second engine choice. Recorded because it is the first place someone will ask
  for a cross-engine exception ("summarize on Haiku even though the box is
  Codex"), and the answer should be no until there is a reason.
- **Where does a `"new"`-shaped chat's follow-state live before it has an id?**
  A Codex-box chat has no session id until the harness names it, so there is no
  per-session file to be absent. **Lean:** absence is still the encoding —
  a session with no id has no explicit model by construction, so it follows. The
  question is only whether anything must be written at the moment the id arrives;
  under "promotion only for an explicit choice" (Track C) the answer is no. Worth
  one doctest rather than more design.

## Knowledge audits

**None, and the reason changed during the work.** The draft planned two
`knows_directly` entries, both premised on the blanket `createAgent` rule the
cross-model review cut (Track B). With the policy read at two named call sites:

1. *"Explicit beats policy"* has nothing to teach — a procedure step that omits
   `model:` still means the harness default, exactly as before, so there is no
   new rule an agent could get wrong while editing a procedure card.
2. *"Pin is not select"* is a distinction between two **UI controls**. A box
   agent operates neither, and nothing it loads mentions them.

An audit tests what a box agent absorbed from its own context — box CLAUDE.md,
the generated guide, schema instructions. Nothing this plan adds enters that
context, so an audit here would test guidance that does not exist and fail for
the wrong reason. The human-facing reference is `docs/model-policy.md`.

## Implementation order

1. **A1** — `agentModel` in `BoxConfig` + `boxConfigSchema`; `modelTier`,
   `TIER_RANK`; `src/core/model-policy.ts`; resolver doctests. No readers.
2. **B1** — `createAgent` fills `model` from the policy when the caller omits it;
   fake-agent doctest. *Depends on A1.*
3. **C1** — `explicitModel`/`resolvedModel` split in `ChatSession`; resolution at
   `startRun`; status shape (`source`, `boxDefault`, `pendingModel`);
   `setDefaultModel` mutation. *Depends on A1.*
4. **C2** — retire `DEFAULT_MODEL_FILE`; migrate `.callback-box/chat-model.json`
   into `box.json`; point `field-test/run-seed.ts` at the config field.
   *Depends on C1.*
5. **D1** — model panel: two-action rows, `Default · <label>` first row, pin
   control gated on owner. *Depends on C1.*
6. **D2** — off-default indicator on the chip button. *Depends on D1.*
7. **D3** — admin section becomes engine + model. *Depends on A1; independent of D1.*
8. **Docs** — `docs/model-policy.md` (done).

Remaining, in dependency order:

9. **E1** — `engines` in box config + `loadEnabledEngines` + Settings checkboxes.
10. **G1** — the small-model slot and its four call sites. *Independent of E/F;
    closes a live defect, so it lands early.*
11. **F1** — `engine` + `model` through `reserveSession` → history + model file;
    client coins only for Claude. *Depends on E1.*
12. **F2** — the picker: per-engine sections, default engine first, disabled and
    fixed states, pin confined to the default engine. *Depends on F1.*
13. **H1** — measure the four passes' assembled context, then trim against the
    numbers. *Depends on G1.*

## Rollout shape

**Test posture.** Each substantial codepath gets its doctest named here, as part
of the design:

- `test/core/chat-models.doctest.md` (extend) — the resolver's full ladder:
  explicit-wins, follow-falls-to-policy, cross-engine tier translation, unknown
  id → `none`, and `TIER_RANK` ordering. This is the plan's done-when for Track A.
- `test/core/chat-session-model.doctest.md` (new) — a session with no per-session
  file resolves the box pin at `startRun`; a warm session's resolved model does
  not change when the pin changes; `pendingModel` reports the difference;
  `setModel(null)` returns the chat to following; and a `"new"`-shaped session
  (no coined id — the Codex-box path) does **not** write a per-session file when
  its id arrives, so it keeps following.
- `test/core/reactor-model-policy.doctest.md` (new) — a reactor run passes the
  policy model, resolves it once per run, and leaves a caller-supplied model
  alone (via `test/helpers/fake-agent.ts`). Its companion assertion is the
  negative one: an agent created outside the reactor still gets no model, so the
  narrowed seam stays narrow.
- `test/webapp/trpc-model-policy.doctest.md` (new) — `setDefaultModel` rejects a
  model outside the engine's registry, rejects a non-owner, and does not restart
  a running session.
- Migration doctest (in C2's file) — legacy file folded, idempotent, retired id
  normalized.
- Frontend: the indicator's tier comparison is pure and gets a doctest; the panel
  itself is covered by the existing chat-chip tests plus a manual pass. No new
  browser test — the logic worth testing is not in the component.

**Knowledge audits.** None — see the Knowledge audits section for why the
draft's two entries were dropped rather than deferred.

**Migration.** One scripted, atomic step in C2, run per box: if
`.callback-box/chat-model.json` exists and `box.json` has no `agentModel`, copy
the (normalized) value into `box.json` through `updateBoxConfigFields` and delete
the file; if `agentModel` already exists, delete the file without overwriting.
Idempotent, no midway state (see cb-migration). Boxes without the file are
untouched.

**The announced change.** Track B changes what runs on a box's wakeups once a
model is pinned. The plan ships with a line in the box-facing changelog and in
the admin section's help text: *"New chats and unpinned agent work — wakeups,
procedures without an explicit model — use this model."* That sentence is the
announcement `2026-08-08` asks for, and it is why the policy field starts unset
rather than defaulting to today's implicit behavior.

**Docs.** `docs/model-policy.md` is the reference this shipped with — the two
levels, what reads them, resolution order, and when a change takes effect —
linked from the CLAUDE.md guides table, with `agentModel` and
`chat-models/<sessionId>.json` named in `docs/box-layout.md`. The plan itself
moves to `docs/implemented-plans/` via `/finish`.
