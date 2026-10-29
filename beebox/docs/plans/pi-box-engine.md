---
title: "pi as a third box engine, on OpenRouter models"
status: active
workstream: pi-engine
issues:
  - ../../../issues/features/2026-10-18-pi-third-engine.md
---
# pi as a third box engine, on OpenRouter models

Add pi (earendil-works/pi, MIT, npm `@earendil-works/pi-coding-agent`) as a
third native engine beside Claude Code and Codex. pi runs only models the
owner added in admin, through OpenRouter, with the box's granted `openrouter`
key. The reason is an open stack: an MIT harness on open-weight models, with
no Anthropic or OpenAI harness in the loop (boxholder, 2026-10-29: *"The
reason for pi is mostly to support a more fully open stack"*).

**Issues addressed:** resolves
[pi third engine](../../../issues/features/2026-10-18-pi-third-engine.md).
Related, not resolved:
[provider-endpoint-config](../../../issues/features/2026-07-18-provider-endpoint-config.md)
(this is another answer to "choose your model provider", at the harness
level);
[chat-backend-port-hygiene](../../../issues/code-quality/2026-07-18-chat-backend-port-hygiene.md)
(Track 3 widens `NativeChatBackendMessage`, which is item 1's direction);
[small-model-picker-in-admin](../../../issues/features/2026-10-15-small-model-picker-in-admin.md)
(pi uses the same two slots);
[public-provider-list-drifts](../../../issues/docs-and-chores/2026-10-17-public-provider-list-drifts-from-code.md)
(Track 7 adds pi to `technologies.md`, but the drift check stays open);
[identify to OpenRouter as Bee Box](../../../issues/features/2026-10-29-identify-to-openrouter-as-bee-box.md)
(filed for later at the boxholder's request; the probe found the mechanism).
Searched the queue for `pi`, `engine`, `openrouter`, `harness`: no other
match.

## Design

### Situations

- When Priya wants her box to run without a closed-vendor harness, I want to
  pick "pi" as the engine and a model she added, so I can keep the box's work
  on an open stack she can inspect.
- When Priya opens a chat on a pi box, I want it to behave like any other
  chat (stream, stop, attach a photo when the model takes images, come back later), so I can forget which
  engine is under it.
- When Priya looks at what the box spent, I want pi's runs to show a dollar
  figure per run, so I can see what each open model costs.
- When Tomas uses the shared box and does not care about engines, I want
  nothing to change, so I can keep using the box. Boxes stay on Claude until
  someone picks pi.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Pick pi | show | Admin → Agent engine and model: a third option, enabled only when the box has a key and at least one added model | waits to be found |
| Chat on pi | quiet | The existing chat; the model chip names the added model | background |
| Cost | show | The existing per-run cost line (tokens in the usage report) | waits to be found |
| Does not care | quiet | nothing | none |

### Spirit

- **Serves:** "You should be able to see the gears" — pi's transcript is a
  documented JSONL file in the box (`.beebox/pi/sessions/`), and its cost is
  per message, not computed from the wrong price list.
- **Risks:** "It should feel possible" — a third engine adds a choice that
  most people never need. Guard: the option is disabled with a reason until a
  key and an added model exist, and nothing changes for boxes that do not
  pick it.

### Trust

Choosing pi is an owner act in admin, the same rung as choosing Codex. No
model runs without the owner adding it (`openrouter-chat.ts:2-9`, the spend
gate). pi takes no action of its own beyond what the box agent already does.

### When it goes wrong or does nothing

- No key, or no added model: the engine option is disabled and says which is
  missing.
- A removed or unknown model: the turn refuses with the existing
  `OpenRouterSetupError` text, which names Admin → OpenRouter models.
- Out of credit or rate-limited: the turn fails with OpenRouter's message.
- A photo sent to a model that takes no images: the send refuses with
  "<model> does not accept images", before any model call.
- A model that cannot call tools well: the turn fails or wanders. Admin
  already warns about this at add time; pi does not change it.

### Walkthrough

1. Priya has a key granted and added `deepseek/deepseek-chat-v3.1` and
   `qwen/qwen3-coder` in admin.
2. She selects "pi" under Agent engine. Admin writes `agentEngine: "pi"` and,
   because pi has no default of its own, requires a Default model from the
   added list in the same save.
3. She opens a new chat. The husk records `engine: "pi"`. The chat starts a
   pi session in-process with the box's AGENTS.md, skills and rule skills.
4. She sends a message. Text streams. A bash call appears as activity. The
   turn ends; the cost line shows pi's USD figure.
5. Later the nightly chat review reads the transcript through the pi session
   store and writes its usual result.

## Smallest fix and budget

**Smallest fix:** batch only. A pi `Agent` behind `createAgent`
(`core/agent/invoke/core.ts:175`), for scheduled and triage runs, with no chat.
About 700 lines. Rejected: the Codex plan rejected the same cut for the same
reason (`codex-box-engine.md`, *"Could this be simpler?"*: *"It would leave
web chat and chat work handled by `bbx wakeup` dependent on Claude Code,
which does not satisfy the job"*). An open stack that still needs Claude Code
for chat is not an open stack.

**Chosen design: about 2,900 changed lines. BIG CHANGE.** Approved by the
boxholder, 2026-10-29.

| Track | Subject | Source | Tests |
|---|---|---|---|
| 1 | Vocabulary: `pi` in `AGENT_ENGINES`, every hand-written literal list | 150 | 80 |
| 2 | Model policy and readiness for an engine with no models of its own | 220 | 180 |
| 3 | pi runtime: session factory, key, model, context, tools, shell env, offline | 400 | 180 |
| 4 | Batch `Agent`: invoke, outcomes, structured result tool, limits, usage import, shared validation | 350 | 220 |
| 5 | Native session store: one engine-keyed seam for history, existence, mtime; delete switch | 300 | 150 |
| 6 | Chat backend | 350 | 200 |
| 7 | Admin and docs | 250 | 50 |

Docs: about 150 lines (`technologies.md`, a new `docs/pi-engine.md`, the
admin guide). No generated output.

What drives the size: about 40 non-test files branch on the engine (survey,
2026-10-29), about 25 of them as `=== "codex" ? codex : claude`, where pi
would silently take the Claude path. Track 5 turns 14 of those sites into one
lookup, which costs more than adding a third ternary at each but makes the
next engine cheap and makes the compiler find every site. The Codex adapter
alone is 1,761 lines (`codex-agent.ts`, `codex-run/`, `codex-chat.ts`,
`codex-sdk-session/`, `codex-transcript/`, `codex-usage.ts`,
`ensure-codex-plugin.ts`); pi's adapter is smaller because it is an
in-process TypeScript SDK with no JSON-RPC wrapper and no plugin install.

## Stated preferences this plan trades against

- **Spend gate.** `core/provider-env/openrouter-chat.ts:5-9`: *"A chat or
  agent turn is a different order of spend, so here the key alone runs
  nothing: the model must also be in the box's `openrouterModels`, which only
  the admin page writes."* Kept unchanged. It is why pi has no tier table:
  any built-in pi default would spend without the owner's act.
- **Unpinned default.** `core/model-policy.ts:32-38`: *"Sol and Opus should
  be the defaults"* (boxholder, 2026-09-14), and a box should name its default
  rather than defer to the harness. pi cannot follow the first half without
  breaking the spend gate. It follows the second: a pi box must pin a default
  from its added list (Track 2).
- **Codex precedent** (`codex-box-engine.md`, Track 1): *"Resumed chats use
  their stored engine regardless of later config changes."* Kept.
- **Codex precedent, Track 3**: keep each harness's transcript native and read
  it through supported APIs. pi's `SessionManager` and documented JSONL format
  are the supported API.
- **Minimize invented concepts** (developer memory). Track 5 adds one
  interface, `NativeSessionStore`. It replaces about 14 ternaries rather than
  adding a fourth concept beside them. A plain third ternary at each site is
  the alternative; it is cheaper now and wrong by default for the next
  engine, as the survey shows for pi today.
- **beebox/AGENTS.md, no features beyond the task.** Same-turn validator
  feedback (Track 4) is in scope because the validator must run for pi by some
  route, and the steer route costs the same as the Codex post-turn route.

## What already exists

- **Engine selection and pinning.** `AGENT_ENGINES` (`shared/agent-models.ts:5`),
  `loadAgentEngine` (`core/box/config.ts:203-208`), the husk `engine` field
  (`schemas/chat.ts:34`, `z.enum(AGENT_ENGINES)`), and the generic resolvers
  `resolveChatEngine` / `resolveStartEngine` (`core/chat/session/engine.ts:61,86`).
  Reuse.
- **Batch agent port.** `Agent` (`core/agent/types.ts:154`), dispatched by
  `createAgent` (`invoke/core.ts:163-197`). Reuse; add a branch.
- **Chat backend port.** `ChatBackend` / `ChatBackendRun`
  (`services/claude-chat-types.ts:102,121`), dispatched at
  `claude-chat/core.ts:431-445`. Non-Claude backends emit
  `NativeChatBackendMessage` (`claude-chat-types.ts:16-19`), consumed generically
  at `core/chat/session/messages.ts:315`. Reuse; widen the `provider` literal.
- **Structured result validation.** `validateStructuredResult`
  (`core/agent/json.ts:80`). Reuse.
- **System prompt carry across resumes.** `createCarrier`
  (`core/agent/model-carry.ts`). Reuse.
- **Include expansion.** `expandInstructionIncludes`, used by the Codex chat
  (`services/claude-chat/codex-chat.ts:14`). Reuse for pi's appended system
  prompt.
- **Generated surfaces.** `AGENTS.md` mirrors, `.agents/skills/*` symlinks and
  rule skills (`core/agent-context-mirrors.ts:159-175`). pi discovers
  `.agents/skills` natively (research, §1). Reuse; no change.
- **OpenRouter key, added list, catalog.** `OPENROUTER_SECRET_NAME`
  (`core/openrouter.ts`), `loadAddedModels` (`core/box/config.ts:310`),
  `openRouterChatAdditions` gate (`provider-env/openrouter-chat.ts:71-90`),
  `lookupOpenRouterModel` (`core/openrouter-catalog.ts:85`, which returns
  context length, tool support and prices). Reuse the gate's checks; pi needs
  the key value, not the Claude env vars.
- **Usage import.** `syncUsage` (`core/usage.ts:310-358`) reads Claude JSONL
  and the Codex ledger. Codex needs a ledger because its history omits usage
  (`core/codex-usage.ts:1`); pi's session file records it, so pi is read in
  place, as Claude is.
- **Script environment.** `buildScriptEnv` (`core/script-env/core.ts:229`)
  builds the filtered environment box agents and scripts run with. Reuse
  for pi's bash tool.
- **Tier slots for OpenRouter defaults.** `resolveTierModel`
  (`core/model-policy.ts:187-200`) maps `efficient`/`balanced` to the small
  slot and `strong`/`strongest` to the default when a claude box's default is
  an OpenRouter model. pi uses the same mapping always.

## Prior art (external)

All adopted items are pi itself (an npm dependency, MIT); no
ACKNOWLEDGEMENTS entry beyond the dependency, unless the finish skill's rule
for "an external project as the source of the idea" applies to the issue's
naming of pi. Track 7 adds the line to be safe.

Probed on 2026-10-29 against pi 1.4.0 (released 2026-10-21) with real
OpenRouter models (DeepSeek v3.1, Kimi k2, Qwen3 coder, MiniMax m3.1 flash),
synthetic box, about $0.03. Probe scripts are throwaway, kept in the session
scratchpad.

- **SDK surface held from 1.3.0.** `createAgentSession`, `SessionManager.create(cwd, dir, {id})`,
  `open`, `findById`, `steer`, `followUp`, `abort`. One correction to the
  research: `appendSystemPrompt` is an option of `DefaultResourceLoader`
  (`resource-loader.d.ts:88`), passed as `resourceLoader`. Adopted.
- **`tools` allowlist filters custom tools.** With `tools: ["read","bash","ls"]`,
  a custom `submit_result` was silently inactive. The allowlist must name the
  custom tool. Adopted as a rule in Track 3.
- **Structured result by tool.** `defineTool` with a TypeBox schema; pi
  validates arguments before `execute` (`agent-loop.js:498`); `terminate: true`
  ends the run with no further model call. Worked on all four models. When a
  model answered in prose, one host follow-up prompt produced the tool call
  on all four. Adopted.
- **Resume.** Reopen by id; custom tools must be passed again to
  `createAgentSession`. Worked on all four. Adopted.
- **Cost.** `message_end.message.usage.cost.total` matched OpenRouter's
  billed `total_cost` exactly for DeepSeek, Qwen and Particle. Kimi k2 cache
  hits were undercounted by half, because pi's catalog prices Kimi's cache
  read at 0. Cost is an estimate from the catalog price, not the bill.
  Adopted with that label (Track 4).
- **Model catalog.** pi ships 401 OpenRouter ids; live OpenRouter had 456 and
  64 text models were missing. `ModelRuntime.refresh()` fetches from `pi.dev`
  and OpenRouter. A hand-built model has zero cost unless set, and wrong
  `reasoning` metadata fails some models (`400 Reasoning is mandatory`).
  Direction in Track 3.
- **Credentials.** `ModelRuntime.create({authPath, modelsPath})` plus
  `setRuntimeApiKey("openrouter", key)` works and writes nothing to disk.
  Adopted.
- **Network beyond the model.** SDK sessions made no other calls in the
  probe. From source: model catalog refresh (`pi.dev`) only on
  `refresh()`; ripgrep/fd downloads from GitHub on first `grep`/`find` use
  with no local binary; version check and install telemetry only in
  interactive mode. `PI_OFFLINE` (any value; `model-runtime.js:97`) disables
  refresh and downloads. Adopted: Track 3 sets it.
- **Attribution headers.** pi sends `HTTP-Referer: https://pi.dev` and
  `X-OpenRouter-Title: pi`; a `providers.openrouter.headers` entry in
  `agentDir/models.json` overrides them (probed). Not adopted here; recorded
  on the filed attribution issue.
- **No top-level output schema** in 1.4.0. The watch trigger "pi adds a
  top-level output schema" has not fired; the result tool stays.
- **Stability.** No semver policy. Six releases from 1.0.0 to 1.4.0 in 21
  days. The pinned version and the `sdk-update` schedule own upgrades.

## Ontology

- **Engine** (`AgentEngine`, `shared/agent-models.ts:6`): the native harness
  that runs a turn. Adds `"pi"`. Not a model provider.
- **Added model** (`AddedModel`, `shared/chat-models.ts:17`): an OpenRouter id
  the owner added. On pi, the only models that exist.
- **pi session id**: set by the adapter at creation
  (`SessionManager.create(…, {id})`) as a fresh UUID, and reported through
  the same session-id callback Codex uses (`codex-agent.ts:56`). It is the
  husk's session id. Not a Claude coined id: `reserve.ts:215` stays
  `unsupported` for pi in the first version (see NOT in scope).
- **pi state dir** (new): `<box>/.beebox/pi/`, gitignored with the rest of
  `.beebox/`. Holds `sessions/` (pi's JSONL files) and pi's `agentDir`
  (`auth.json` stays empty; key is injected at runtime). Backed up with the
  box because `.beebox/` is not in the backup excludes
  (`core/box-backup/run/inventory.ts:72`).
- **Native session store** (new, `NativeSessionStore`): per-engine read
  operations on a native session: `exists`, `updatedAt`, `readHistory`.
  One implementation per engine. Not a
  transcript owned by beebox (the 2026-08-26 decision on port hygiene item 3
  stands).
- **Result tool** (new): `submit_result`, a pi custom tool built from the Zod
  schema of an `invokeStructured` call. Internal to the pi adapter.

## Tracks / scope

### Track 1 — Vocabulary

**What:** add `"pi"` to `AGENT_ENGINES` and fix every hand-written list.

**Why this needs to change:** the survey found 20 literal lists that will not
fail to compile (`config.ts:207`, `history.ts:81`, `chat-models.ts:40`,
`engine-availability-store.ts:32,42`, `admin/router.ts:38,45,113,122`,
`box-config-write.ts:95,99`, `reservation-receipts.ts:6`,
`chat-composer-binding.ts:10`, `auth-preflight.ts:200`, `readiness.ts:62,82`,
`plugin-paths.ts:5`, `claude-chat-types.ts:18`, `AgentEngineSection.tsx:37-50,100`,
`admin-overview-summaries.ts:42`, `SessionChip-model-panel.tsx:147`,
`diagnostic-session.ts:23`, `knowledge-audit.ts:41`).

**Direction:** replace each literal list with `AGENT_ENGINES` or
`z.enum(AGENT_ENGINES)`. Every `=== "codex" ? … : claude` site that this
track does not move to Track 5 becomes an exhaustive `switch` with
`assertNever`, so the compiler names the next engine's sites. Until Track 4
lands, the pi arms throw `EngineNotImplemented`; config refuses
`agentEngine: "pi"` until Track 6 lands (a guard removed in Track 6's last
chunk).

**Vocabulary lock-ins:** `"pi"` as the engine literal; label "pi".

**First implementation chunk:** the enum change, literal lists, and
`assertNever` switches at the ⚠ sites outside Track 5, with `pi` arms that
throw. Typecheck and change-selected tests pass. No behaviour change.

### Track 2 — Model policy and readiness

**What:** pi runs only added models. Make the policy, picker, readiness and
the admin switch say so.

**Why this needs to change:** `resolveProcedureModel` asserts each engine has
a default tier table (`agent-models.ts:136`, `invariant(fallback !== undefined…)`).
pi cannot have one without spending unasked.

**Direction:**
- `chatModelOptions("pi", added)` returns the added list only, with no
  "Default" row unless a default is pinned. `OPTIONS.pi = []`.
- pi has no tier table, and `resolveProcedureModel` must never be reached
  for pi. Three resolvers reach it today, and each gets a pi rule:
  - `resolveBoxModelForEngine` (`model-policy.ts:65`) translates an
    unrunnable pin by tier. For pi: an added OpenRouter pin runs; any other
    pin returns `null` (no translation).
  - `resolveSmallModelForEngine` (`model-policy.ts:165`) falls back to the
    efficient tier. For pi: a pinned small model runs only if it is in the
    added list, else the box default; with no default, `null` and the run
    refuses. A stale first-party `smallModel` left from a claude box is the
    case to test.
  - `resolveTierModel` (`model-policy.ts:194`): the OpenRouter slot branch
    applies to pi always.
  `resolveProcedureModel` gets an `invariant(engine !== "pi")` so a missed
  path fails loudly. The return types that are `string` today
  (`resolveSmallModelForEngine`, `resolveTierModel`) become `string | null`
  for pi through a pi-specific wrapper, so callers handle "no model" with
  the existing `OpenRouterSetupError` refusal; doctests go through the
  background-work entry points (`loadTierResolver`, `loadEffectiveSmallModel`).
- `boxDefaultModel("pi", { pinned: null })` returns `null`. Readiness for pi
  reports `needs-default-model` when no pinned default is in the added list,
  and `needs-key` when the `openrouter` secret is not granted. Every pi run
  goes through the same refusal (`OpenRouterSetupError`) as today's
  OpenRouter-on-claude spawn.
- The explicit admin write (`updateBoxConfig`, `admin/router.ts:130`)
  refuses `agentEngine: "pi"` without an `agentModel` from the added list.
  Removing the last added model is already refused while it is the default
  (`openrouter-chat-models.md`, `removeOpenrouterModel`).
- Automatic recovery (`reconcileDefaultEngine`,
  `webapp/trpc/agent-default-switch.ts:22`) moves an unready default to
  Claude, then Codex, then OpenRouter-on-claude. It never switches a box
  away from pi, and never switches a box to pi. A pi box with a revoked key
  stays on pi and shows `needs-key` (boxholder, 2026-10-29: *"if someone
  wants pi then they want pi"*).
- An explicit chat pick of an added model the owner has since removed is
  kept and refused at spawn, as on claude (`model-policy.ts:110`).
- A chat pinned to a non-OpenRouter model on a box now running pi falls
  through to the box default, as Codex does today
  (`model-policy.ts:103-113`).

**First implementation chunk:** the policy functions and their doctests,
with readiness states. No UI.

### Track 3 — pi runtime

**What:** one module, `core/agent/pi-run/session.ts`, that makes a pi
`AgentSession` for a box, model and session id.

**Direction:**
- Dependency: `@earendil-works/pi-coding-agent`, exact version pin.
- `PI_OFFLINE=1` set in the beebox process before pi loads, so no catalog
  refresh and no ripgrep/fd download from GitHub can happen. `grep` and
  `find` are never offered, so a missing binary cannot trigger a fetch path
  even if the env var is lost. The agent has `rg` through bash.
- Tools follow the invocation (`AgentInvokeOptions.tools`, `types.ts:44`):
  omitted means `read, bash, edit, write, ls`; `[]` means no built-in tool
  (a structured prompt-only pass gets only `submit_result`); a list is
  intersected with those five. Custom tool names are always added to the
  allowlist, because pi's allowlist filters custom tools too. `dryRun`
  returns before any model call, as on the other engines.
- Shell environment. pi runs in the box server's process, so its bash tool
  would inherit the server's environment by default. The factory passes
  pi's bash `spawnHook` an environment built by `buildScriptEnv`
  (`core/script-env/core.ts:229`) plus the invocation's `env` additions,
  per session, without changing `process.env`. Production already runs
  each box server as its own OS user (`implemented-plans/per-box-units.md`),
  so in-process pi keeps the per-box user boundary; the environment is the
  remaining boundary. A doctest sets a sentinel server secret and checks the
  bash tool cannot see it, and that two sessions get their own box
  variables.
- Key: `resolveSecret(boxRoot, OPENROUTER_SECRET_NAME)` after the added-list
  check, then `ModelRuntime.create({ authPath, modelsPath })` under
  `<box>/.beebox/pi/agent/` and `setRuntimeApiKey("openrouter", key)`. Never
  written.
- Model: `runtime.getModel("openrouter", id)` from pi's bundled catalog,
  which covered 392 of the 456 live ids in the probe. When pi lacks the id,
  the run builds a pi `Model` from `lookupOpenRouterModel`. That needs
  `CatalogModel` (`openrouter-catalog.ts:36`) to keep three
  things it discards today: `supportedParameters` (for `reasoning`), input
  modalities, and the full id with its variant suffix (lookup strips it). Field mapping: `contextWindow` from
  `context_length`, `cost` from the three prices (a null price is 0 and the
  cost line says "price unknown"), `reasoning` true when
  `supported_parameters` has `reasoning`, `input` includes images when the
  listing's input modalities do. A listing that cannot supply a usable model
  (id not found, or no `context_length`) refuses the run with
  `OpenRouterSetupError` naming the model and the missing field. A doctest
  covers a reasoning model missing from pi's catalog, a model with unknown
  prices, and one with no context length. Admin warns at add time
  on a pi box when pi's catalog lacks the id.
- Context: `DefaultResourceLoader` with `appendSystemPrompt: [systemPrompt,
  expandedIncludes, NESTED_AGENTS_LINE]`. `expandedIncludes` is
  `expandInstructionIncludes` output, as Codex uses. `NESTED_AGENTS_LINE`:
  "Directories below the box root may contain their own AGENTS.md. Before
  you read or change files in a directory, read the AGENTS.md files on the
  path from the box root to it and follow them." `loadBoxContext: false`
  sets `noContextFiles` and an empty skills override.
- Sessions: `SessionManager.create(cwd, <box>/.beebox/pi/sessions, { id })`
  and `findById` for resume.

**First implementation chunk:** the factory with a test against pi's `faux`
provider (no spend) that checks the root AGENTS.md nonce, a rule skill, the
nested line, and the absent `grep`/`find` tools.

### Track 4 — Batch agent

**What:** `createPiAgent` implementing `Agent`.

**Direction:**
- `invoke`: prompt and collect assistant text. `agent_settled` is the
  boundary where pi stops, not the outcome. The adapter records the outcome
  separately: `completed`, `interrupted` (signal → `abort()`),
  `limit` (`maxTurns` or `maxBudgetUsd`), or `failed` (provider error on the
  last assistant message, or a thrown `prompt()`). It maps to `AgentResult`
  as `codex-run/result.ts:20` does for Codex.
- `maxTurns`: count `turn_end` events and abort past the limit, as Codex
  counts tool items. `maxBudgetUsd`: sum `message_end` cost and abort past
  the limit. The figure is an estimate from listed prices (it undercounted
  one model's cache reads in the probe), so the ceiling is approximate;
  `types.ts:54` calls it hard. Neither shipped engine meets that for
  OpenRouter today: Codex cannot enforce it at all, and Claude prices
  OpenRouter turns at Claude rates. A budgeted run on a model with any
  unknown price refuses before starting. The `maxBudgetUsd` doc comment
  gains one sentence naming the pi approximation.
- `invokeStructured`: register `submit_result` built from the Zod schema
  (Zod → JSON Schema → TypeBox `Type.Unsafe`), with `terminate: true`. If
  the outcome is `completed` with no call, send one follow-up prompt asking
  for the call. Never after `interrupted`, `limit` or `failed`. If the
  follow-up also ends with no call, return `success: false` with "model did
  not return a structured result". The arguments go through
  `validateStructuredResult`.
- Validation lives in one module shared by Tracks 4 and 6,
  `core/agent/pi-run/validate.ts`. On `tool_execution_end` for `edit` or
  `write` (the same scope as the Claude plugin's PostToolUse matcher,
  `plugins/beebox-claude/hooks/hooks.json:6`, `"Write|Edit|MultiEdit"`;
  files changed through bash are caught by the box's pre-commit validation
  on all engines), it runs the box validator on the path and sends a finding with
  `session.steer(…)`, so the model sees it before its next step. At settle,
  any finding still standing fails the run, as on Codex
  (`codex-chat.ts:164,209`). The steer is the only addition over Codex's
  post-turn check, and it is one call.
- Usage: pi's own session file records usage per assistant message
  (research, §3, "Token / cost"). `syncUsage` (`core/usage.ts:310`) reads
  pi session files the way it reads Claude JSONL, through a pi usage reader
  (`readPiSessionUsage`, beside the pi store; not part of the shared store
  interface), into the existing token columns. No separate ledger. The usage
  database has no cost column (`usage.ts:70-80`); dollar figures stay in
  the per-run result and the chat cost line, labelled "estimated".
- Failures: an OpenRouter 402 or 429 fails the run with OpenRouter's
  message. No entry in the engine availability store, which assumes one
  machine-wide account per engine (`engine-availability-store.ts:4`).

**First implementation chunk:** `invoke` and `invokeStructured` with the
faux provider in doctests; `createAgent` dispatch for pi.

### Track 5 — Native session store

**What:** one interface for the engine-specific reads in categories B and C
of the survey, with Claude, Codex and pi implementations.

**Why this needs to change:** 14 sites pick the Codex reader or fall through
to Claude JSONL: `load-history.ts:178`, `deliver-user-message.ts:77`,
`log-tail.ts:28`, `transcript-sync.ts:73`, `trpc/routers/history.ts:166`,
`history.ts:343`, `husk.ts:171`, `list/core.ts:202,376`,
`review/discovery.ts:254,270,302`, `review/run/core.ts:132`,
`review/run/title.ts:104`, `review/run/metadata.ts:76`,
`availability.ts:98`. Two sites take the Codex path for any non-Claude
engine (`delete/apply/core.ts:160`, `cli/commands/session/command.ts:86`).
Backup collects only Claude and Codex (`box-backup/run/inventory.ts:55-70`).

**Direction:** the interface covers the common reads only, and keeps
today's history contract: a required slice and an `{ entries, total }`
result, with the bounded and coalesced reads in `load-history.ts:45,115`
and the paged review reads in `review/discovery.ts:186` unchanged.
```ts
interface NativeSessionStore {
  exists(boxRoot: string, id: string): Promise<boolean>;
  updatedAt(boxRoot: string, id: string): Promise<Date | null>;
  readHistory(boxRoot: string, id: string, slice: SessionLogSlice): Promise<SessionHistoryResult | null>;
}
const SESSION_STORES: Record<AgentEngine, NativeSessionStore>
```
`SessionLogSlice` and `SessionHistoryResult` are the existing types of
`load-history.ts:28,45`. Deletion stays in its orchestration
(`delete/apply/core.ts`), including Codex's native `thread/delete` and its
partial-failure recovery; its `claude`/else branch becomes an exhaustive
`switch` with a pi arm that removes the session file. The CLI site
(`cli/commands/session/command.ts:86`) gets the same switch.
The pi store does not use `SessionManager.open`, which loads the whole
file. It reads pi's documented JSONL (`docs/session-format.md`, version 3)
with the same bounded-slice approach `parseSessionLog` uses for Claude JSONL
(`cli/lib/session.ts:251-266`), reading fresh on
each call, and maps user and assistant text and compaction entries to
`SessionEntry`; an entry with an unknown version fails the read visibly, dropping tool
results and thinking as the Codex adapter does. pi sessions live in
`.beebox/`, so backup needs no change; a doctest asserts that.

**First implementation chunk:** the interface and the Claude and Codex
stores, with the 14 read sites moved, no pi yet. Existing tests pass
unchanged. This chunk is a refactor with no behaviour change and lands
before the pi store.

### Track 6 — Chat backend

**What:** `createPiChatBackend` implementing `ChatBackend`.

**Direction:** `start` opens or creates the session (Track 3) and returns a
`ChatBackendRun`. `messages` maps pi events to `ChatMessage` inside
`NativeChatBackendMessage { provider: "pi" }`:
- `message_update` text deltas as stream events;
- each finished assistant message (`message_end`) as a finalized
  `type: "assistant"` message whose `uuid` is the pi session entry id, the
  same id the pi store returns from history. The host accumulates these for
  feature processing (`messages.ts:359`, `run/core.ts:260`), and
  transcript sync waits for their ids (`transcript-sync.ts:125`);
- `tool_execution_start/end` as activity;
- the outcome (Track 4's states) as the terminal `result`, with pi's cost
  in `total_cost_usd`.
`adaptBackendMessage` strips `total_cost_usd` from every result on a
third-party model (`messages.ts:314-317`), which would remove pi's figure.
Its condition changes to "Claude-engine result on a third-party model":
native results keep their cost. A doctest covers both: a pi cost survives,
a claude-on-OpenRouter cost is still removed.
`send` while running calls `followUp` (queue semantics, as Claude has
today); `send` when idle calls `prompt`. Images go in `images`. `interrupt`
calls `abort()`. `prewarm` and `load` are no-ops, as for Codex.
`start.ts:144` passes landmark box context through for pi as Codex does
through its own include expansion. Validation uses Track 4's shared module;
a chat test proves an invalid edit fails the turn visibly.

**First implementation chunk:** start, stream text, finalized assistant
messages with stable ids, interrupt, resume, with a test through the
existing chat session tests' fake backend seam that checks feature
processing and an immediate history read.

### Track 7 — Admin and docs

**What:** the engine option, readiness copy, cost label, docs.

**Direction:** `AgentEngineSection` lists pi, disabled with the missing
piece named (key or added model). The OpenRouter models section shows on pi
boxes. `CodexSection`-style account UI is not needed: the key is managed in
the existing secrets UI. Docs: `docs/pi-engine.md` (what runs, where state
lives, what is offline, cost is estimated), a row in
`development/technologies.md` "AI services used", and the admin guide.
ACKNOWLEDGEMENTS gets pi.

**First implementation chunk:** the admin section and its component test.

## Could this be simpler?

1. **Batch only** (700 lines): rejected above; chat would still need Claude
   Code.
2. **A third ternary at every site instead of Track 5** (saves about 200
   lines): the survey shows the existing ternaries were written for two
   engines and silently routed pi to Claude. A third ternary repeats the
   pattern that caused it. Track 5 makes the compiler list the sites.
3. **pi through RPC mode in a subprocess** instead of in-process: isolates a
   pi crash from the server, but adds the JSON-RPC wrapper the Codex adapter
   needed. The SDK is TypeScript in the same process, which the research
   gives as pi's main fit. Kept in-process; a crash in a tool is a child
   process already.
4. **Use pi's own catalog only** (no fallback from beebox's catalog): an
   added model missing from pi's catalog would run at zero cost, or fail on
   reasoning metadata. The fallback is about 40 lines.
5. **Drop same-turn validation** and validate post-turn as Codex does: same
   cost to build, worse for the model. Kept.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `agentEngine: "pi"` before Track 6 ships | new config doctest | refused with allowed values | clear |
| pi box with no pinned default | new policy doctest | readiness `needs-default-model`; run refused | clear |
| Key not granted | existing `openRouterChatAdditions` doctest, extended | `OpenRouterSetupError` | clear |
| Model removed from admin mid-chat | existing doctest, extended to pi | refused with the admin location | clear |
| Model missing from pi's catalog | new doctest with a fake catalog | built from OpenRouter listing; admin warns at add | clear (warning) |
| Reasoning-mandatory model built with wrong metadata | probe only | OpenRouter 400 surfaces as a failed turn | clear, not classified |
| Model answers in prose instead of `submit_result` | new faux doctest | one follow-up, then `success: false` | clear |
| `tools` allowlist omits `submit_result` | new doctest | the factory always adds custom tool names | clear |
| Validator finding during a run | new faux doctest | steered back; fails at settle if still standing | clear |
| Cost undercount (Kimi cache) | probe | shown as "estimated"; key-usage line is the bill | clear (labelled) |
| pi cost stripped as a third-party result | new doctest | strip only Claude-engine results | clear |
| Server secret visible to pi's bash tool | new sentinel doctest | `spawnHook` with `buildScriptEnv` | clear |
| `tools: []` pass gets file tools | new doctest | tools derived from the invocation | clear |
| Stale first-party `smallModel` on a pi box | new doctest via `loadTierResolver` | `null` → setup refusal; `resolveProcedureModel` invariant | clear |
| Structured follow-up after abort or limit | new doctest | follow-up only after `completed` | clear |
| Invalid edit in a pi chat | new chat test | shared validator fails the turn | clear |
| Finalized assistant message missing | new chat test | feature processing and history read checked | clear |
| Automatic recovery switches a pi box to Claude | new doctest | reconcile skips pi | clear |
| `PI_OFFLINE` lost, `grep` tool used | new doctest checks allowlist | `grep`/`find` not offered | clear |
| pi session file missing for a husk | new store doctest | `exists` false → unavailable, like Codex | clear |
| pi JSONL version bump on upgrade | none | pi migrates on load (`CURRENT_SESSION_VERSION`); pinned version | clear on failure |
| OpenRouter 402/429 | new doctest | run fails with OpenRouter's message | clear |
| Server restart mid-turn | same as other engines | turn lost; session resumes at last saved entry | clear |
| pi throws inside the server process | new chat test with a throwing faux model | run rejects; chat shows the error | clear |

No critical gap.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** Same validator, steered back in
  the same run (Track 4).
- **Stale ref — UNCHANGED.** Same box CLI and validators.
- **Two agents touching one card — UNCHANGED.** Engine choice adds no writer.
- **Hand-edit drift — ADDRESSED.** `agentEngine: "pi"` with no pinned default
  reads as `needs-default-model`, not a crash.
- **Fabricated free-form value — DEFERRED.** Model quality differs; no new
  truthfulness mechanism.
- **Validation error UX — ADDRESSED.** The finding reaches the model as a
  steer message in the box validator's own words.
- **Partial transition — ADDRESSED.** Existing chats keep their engine;
  switching back to claude leaves pi chats readable through the pi store.

## NOT in scope

- Bee Box attribution headers to OpenRouter. Filed; the boxholder asked for
  later.
- Caller-coined session ids for pi chats (`reserve.ts:215`). pi supports
  them, but the coined-id path is Claude-only today; adding pi is a separate
  change to chat-everywhere.
- Steer (message during a running step) in the chat UI. `send` maps to
  `followUp`, matching current Claude behaviour.
- Other pi providers (direct Anthropic, OpenAI, Groq, local). OpenRouter only.
- pi's Claude or ChatGPT subscription logins. Rejected in research.
- RPC-mode isolation.
- A small-model picker in admin (its own issue).
- Dollar figures in the usage database and report. The table has no cost
  column (`core/usage.ts:70-80`); a schema change is its own decision.
- Engine availability tracking for pi. The store assumes one machine-wide
  account per engine; an OpenRouter key is granted per box.
- Engine-specific diagnostics (`bbx session --raw`, `bbx feedback`) for pi.
  `bbx session` reads history through Track 5; raw JSONL views stay Claude.

## Open design questions

- Whether the pi engine should eventually ship a small default model list on
  OpenRouter. Lean: no; the spend gate is the owner's act.

## Knowledge audits

No new agent-facing concept: the box agent sees the same AGENTS.md, skills
and rules. The nested-AGENTS.md line is new guidance for pi only. One
`knows_directly` entry checks that a pi agent reads a nested AGENTS.md
before editing in its directory, run on this worktree's test box clone with
an added cheap model (paid, authorized 2026-10-29).

## What will hold this after it ships

- Doctests on the policy, the store interface and the factory, using pi's
  `faux` provider: no spend, run in the normal suite.
- The existing chat session tests through the fake backend seam, extended to
  pi.
- One live smoke script (not in the suite) that runs a turn, a structured
  call and a resume on a cheap OpenRouter model; rerun on each pi upgrade by
  the `sdk-update` schedule.

## Implementation order

1. Track 1 (vocabulary, guarded off).
2. Track 5 first chunk (store interface, Claude and Codex, no behaviour change).
3. Track 2 (policy and readiness).
4. Track 3 (runtime factory).
5. Track 4 (batch agent; usage; validation).
6. Track 5 pi store.
7. Track 6 (chat backend); remove the config guard.
8. Track 7 (admin, docs, ACKNOWLEDGEMENTS).
9. Live smoke on the worktree test box, knowledge audit, cross-model review.

## Rollout shape

- Existing boxes stay on their engine. pi is opt-in in admin.
- Done when: the Track 1–7 doctests pass, the existing chat and agent suites
  pass with the Track 5 refactor, the live smoke passes on two OpenRouter
  models, and the knowledge audit has run.
- No data migration. pi state is new and lives in `.beebox/pi/`.
- Rollback: set `agentEngine` back. pi chats remain readable.
