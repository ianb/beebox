---
title: "OpenRouter chat models, added by the owner in admin"
status: draft
workstream: openrouter-chat-models
issues:
  - ../../../issues/features/2026-09-19-openrouter-chat-models-added-in-admin.md
---
# OpenRouter chat models, added by the owner in admin

When the boxholder wants a chat or the box's agent work to run on a model
OpenRouter carries (DeepSeek, Kimi, Qwen), they add that model in admin, and
from then on it appears in the chat picker and can be the box default. Adding
it is the only way it can run. Holding an `openrouter` key enables nothing for
chat, because these models bill per use and the box must never start spending
without that act.

**Issues addressed:** resolves
[2026-09-19-openrouter-chat-models-added-in-admin](../../../issues/features/2026-09-19-openrouter-chat-models-added-in-admin.md).
Partially addresses
[2026-07-18-provider-endpoint-config](../../../issues/features/2026-07-18-provider-endpoint-config.md)
(its OpenRouter slice). That issue stays open: API-billed Anthropic and
self-hosted vLLM are not built here. Searched the queue for `openrouter`,
`provider`, `model`: the other OpenRouter items are transcription and TTS
routing (`2026-09-06-openrouter-diarizing-stt-backend`, closed
`2026-09-06-gemini-tts-over-openrouter`), which are not related.

## Smallest fix and budget

Smallest possible fix: one hard-coded `MODEL_ID.deepseek`, routed like GLM,
listed unconditionally in the picker, gated by key presence. Rejected. It
violates the boxholder's one condition: a key that exists would make the model
selectable, and a pick would spend. It also puts a per-box choice in source.

Chosen design, six tracks, about **1,500 changed lines** (source plus tests;
plan doc and generated output not counted). Not a BIG CHANGE.

| Track | Subject | Est. lines |
|---|---|---|
| 1 | Spike: the headless loop through OpenRouter (paid test, authorized) | ~80 (throwaway script + recorded findings) |
| 2 | Vocabulary: the `openrouter` provider, the box's added list, model policy takes the list | ~350 |
| 3 | One provider-env seam for GLM and OpenRouter; spawn-time gate | ~350 |
| 4 | OpenRouter catalog and key-usage client (server) | ~200 |
| 5 | Admin section, tRPC, picker | ~450 |
| 6 | Docs and the stated exception | ~70 |

What the fuller design buys over the smallest fix: the gate itself (the
list), add-time validation against OpenRouter's catalog (so a typo fails in
admin, not in a chat turn), and the price and spend lines the boxholder chose
for spend visibility (2026-09-19).

## Stated preferences this plan trades against

- **`core/openrouter.ts:4-8`** — *"The product shape is one secret and no
  configuration: grant a box an `openrouter` key and the services that can run
  through OpenRouter simply do. There is no base-URL setting, and no
  per-service provider field."* This plan is a deliberate exception for chat
  and agent models. The reason is the order of spend: the optional services
  cost cents (`core/secrets/guide-registry.ts:58`, *"usage is pay-as-you-go
  and these services cost cents"*), and a chat turn on an agent loop does not.
  Track 6 writes the exception into that doc comment so the rule and its one
  exception are read together.
- **The same file, `openRouterProvider` (`core/openrouter.ts:57-63`)** pins
  every request to one host with `data_collection: "deny"`. Claude Code sends
  the request, not us, so the chat path cannot send a `provider` block. Host
  choice and data policy for chat fall to the boxholder's OpenRouter account
  settings. The admin copy says so; this plan does not add a request-rewriting
  proxy to recover the pin (see NOT in scope).
- **`core/script-env-allowlist.ts:29-32`** — ambient `ANTHROPIC_API_KEY` is
  stripped so nothing silently bills. This plan sets `ANTHROPIC_AUTH_TOKEN`
  and blanks `ANTHROPIC_API_KEY` per run through `buildScriptEnv` additions,
  the GLM precedent (`docs/plans/box-glm-provider.md`, "Stated preferences").
  The allowlist does not widen.
- **Boxholder, 2026-07-18 (endpoint-config issue):** *"no routing, no
  fallback logic."* A missing key, a removed model, or an OpenRouter error
  fails the turn. Nothing falls back to a subscription model.
- **Boxholder decisions for this plan, 2026-09-19:**
  - Spend: show each added model's per-token price and the key's total usage
    from OpenRouter. No per-model accounting.
  - Scope: an added model may be a chat's pick and the box default. Tiered
    procedure steps (`model: strong`) stay on subscription Claude, because
    an added model has no tier.
  - Removal: a chat whose explicit pick was removed refuses its next turn; it
    does not follow the box default.
  - A paid test of a few cents per model is authorized.
- **Memory: consolidate over duplication.** GLM's env injection is repeated at
  five spawn sites (listed under What already exists). A second provider
  makes the duplication worse, so Track 3 merges both into one seam instead of
  adding a parallel `if openrouter` at each site.

## What already exists

- **GLM rides the claude engine the same way.** Reuse the shape:
  - key resolution at `server` access: `core/glm-key.ts:104-112`,
    `resolveGlmKeyOrThrow`;
  - env additions: `core/glm-key.ts:46-52`, `glmEnvAdditions`;
  - picker courtesy flag: `core/glm-key.ts:80-83`, `glmKeyUsable`, surfaced
    as `glmAvailable` in `webapp/trpc/routers/chat-control-procedures.ts:135`
    and filtered in `frontend/src/components/chat/SessionChip-model-panel.tsx:96`.
- **The five provider-env sites** (rebuild as one seam in Track 3):
  - `core/chat/session/start-run.ts:134` (`glmChatAdditions`, chat start),
  - `core/chat/session/registry-warm.ts:61` (prewarm),
  - `core/chat/session/thread.ts:195` (thread start),
  - `core/agent/run.ts:211-236` (`setupRunEnv`, batch runs, with the
    prompt-logger interaction),
  - `core/agent/run.ts:270-274` and `core/agent/auth-preflight.ts:207-218`
    (preflight branches).
- **The OpenRouter key:** `core/openrouter.ts:95-117`, `getOpenRouterKey`,
  store name `openrouter`, `server` access, collapses refusals to null. Chat
  needs the refusal, not null (the `glm-key.ts:10-15` reasoning). Track 3 adds
  a throwing sibling; the collapsing one stays for the optional services.
- **The secret guide entry for `openrouter` exists**
  (`core/secrets/guide-registry.ts:52-63`). Its text says the key serves "every
  service listed below". Track 6 adds a uses entry for chat models.
- **Tier fallthrough already gives the chosen scope.** `resolveProcedureModel`
  falls back to the engine's own column when the provider has none
  (`shared/agent-models.ts:111-117`: *"an engine that cannot run the requested
  provider falls back to that same default"*). With no `openrouter` column, a
  tiered step on an OpenRouter-defaulted box resolves to first-party Claude,
  as decided. No table change; a doctest pins it.
- **Model validation is pure and static.** `isChatModelAllowed`
  (`shared/chat-models.ts:47-49`) checks the constant list. It is called at
  `core/model-policy.ts:59,98`, `webapp/routes/chat-send-target.ts:53`,
  `webapp/trpc/routers/chat-control-procedures.ts:239,278,367`, and through
  `chatModelForEngine` at `core/chat/session/state.ts:85`. Config admission is
  `readConfiguredModel` (`core/box/config.ts:206-220`, rejects any id where
  `modelTier(...) === null`) and the admin input refine
  (`webapp/trpc/routers/admin.ts`, `agentModel: z.string().refine((m) =>
  modelTier(normalizeModelId(m)) !== null`).
- **Admin surface:** `frontend/src/components/admin/AgentEngineSection.tsx`
  (engine radio, enabled engines, default-model select built from
  `chatModelOptions`, lines 30-42).
- **Engine-unavailability classification runs on every claude-engine result**
  with `provider: "claude"` (`core/agent/run.ts:317-320`). A third-party
  provider's quota error could be recorded as Claude's. GLM carries this risk
  today (the GLM plan's NOT in scope). Track 3 closes it for both providers
  with a guard (see Failure modes).
- Searched `beebox/src` for `openrouter.ai/api"` (the Anthropic-skin base) and
  for `/`-containing model ids: nothing. All chat-path OpenRouter work is new.

## Prior art (external)

Researched 2026-09-19. The public model list was fetched live; the docs pages
were read.

- **The Anthropic-compatible endpoint:** `ANTHROPIC_BASE_URL=https://openrouter.ai/api`,
  `ANTHROPIC_AUTH_TOKEN=<key>`, and `ANTHROPIC_API_KEY=""` explicitly —
  <https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration>.
  The page routes Claude Code's roles with `ANTHROPIC_DEFAULT_{FABLE,OPUS,SONNET,HAIKU}_MODEL`
  and `CLAUDE_CODE_SUBAGENT_MODEL`.
- **Same page:** *"Claude Code with OpenRouter is only guaranteed to work with
  the Anthropic first-party provider."* This is why the spike runs before any
  suggested model ships.
- **No published signal predicts "survives an agent loop".**
  `GET /api/v1/models` lists `supported_parameters` per model: 378 of 447
  include `tools`, 362 include `structured_outputs`. That is necessary, not
  sufficient. It is also the best case across hosts:
  `/api/v1/models/{id}/endpoints` shows each host's parameters differ.
- **The closest quality signal is the `:exacto` suffix**
  (<https://openrouter.ai/docs/guides/routing/model-variants/exacto>). It
  routes to hosts ranked by measured tool-calling success. The model list is
  curated (Kimi K2, DeepSeek V3.1 Terminus, GLM 4.6, gpt-oss-120b, Qwen3
  Coder) and not exposed as a field in the API. Unverified: whether the
  Anthropic skin accepts a suffixed id. The spike checks it.
- **Cost:** the Anthropic-messages response carries a `usage.cost` field
  (API reference, not raw-verified). A per-generation stats endpoint exists
  (`GET /api/v1/generation?id=`). Unverified by fetch: the key-usage endpoint
  `GET /api/v1/key`. The spike confirms its response shape before Track 4
  depends on it.
- **Claude Agent SDK's `total_cost_usd`** is computed client-side from Claude
  prices. For GLM it was measured as wrong (`box-glm-provider.md`, spike
  results). It will be wrong for OpenRouter the same way. Accepted; this is
  the reason for the key-usage line.

## Tracks / scope

### Track 1 — Spike: the headless loop through OpenRouter

**What:** a throwaway script (not committed) runs the SDK `query()` against
OpenRouter with the boxholder's key. It mirrors `run.ts` options: harness
plugin, `outputFormat: json_schema`, `maxTurns`, a multi-turn tool task, and a
resume. It tests three candidate ids, a few cents each.

**Why:** OpenRouter's own docs disclaim non-Anthropic models. The suggested
list must come from evidence.

**Direction:** record in this plan's Track 1 results (appended below the
implementation order):
- (a) tools fire and results parse;
- (b) structured output validates;
- (c) resume works;
- (d) the model id reaches OpenRouter verbatim, with and without `:exacto`;
- (e) the env set actually needed, and whether any request escapes to
  `claude-*` ids when the role variables are set;
- (f) verbatim error text for a bad id, a bad key, and no credit (when it can
  be produced without spending);
- (g) the `GET /api/v1/key` response shape;
- (h) what `total_cost_usd` reports.

Candidates: `deepseek/deepseek-v3.2`, `moonshotai/kimi-k2-0905`,
`qwen/qwen3-coder`.

**Blocked on:** this worktree's box (`test1`) has no `openrouter` grant today
(`bbx secrets status .`, 2026-09-19). The boxholder grants it, or runs the
spike script themselves. The agent does not touch the store.

**First chunk:** the script plus recorded findings.

### Track 2 — Vocabulary and model policy

**What:** OpenRouter models become a provider the policy understands, and the
box's added list becomes an input to every "is this model allowed" answer.

**Why:** `isChatModelAllowed` is static today, so a box-configured id is
rejected everywhere (config admission, `setModel`, send target, the resolver).

**Direction:**
- `ModelProvider` gains `"openrouter"`. `providerOf(model)` returns it for any
  id containing `/`. OpenRouter ids are `author/slug[:variant]`. No
  first-party, Codex, or GLM id contains `/` (`shared/model-ids.ts:15-28`).
  The id is sent to OpenRouter verbatim; there is no prefix to strip.
- Box config: `openrouterModels?: { id: string; label: string }[]` in
  `_config/box.json`. `loadAddedModels(boxRoot)` in `core/box/config.ts`
  validates each entry: the id matches `^[a-z0-9._-]+/[a-z0-9._-]+(:[a-z0-9._-]+)?$`,
  the label is non-empty and at most 60 characters. It drops a bad entry with
  a warning, the `readConfiguredModel` precedent.
- `shared/chat-models.ts`: `export interface AddedModel { id: string; label: string }`.
  `chatModelOptions(engine, added)` and `isChatModelAllowed(engine, model, added)`
  take the list as a **required** argument. Codex ignores it. On claude, added
  rows follow the static rows. Required, not defaulted: a defaulted `[]` would
  let a missed call site reject added models silently.
- `model-policy.ts`: `resolveBoxModelForEngine`, `boxDefaultModel`, and
  `resolveEffectiveModel` take `added`. `resolveEffectiveModel` keeps an
  explicit OpenRouter pick even when it is no longer in `added`, and returns
  it as `source: "explicit"`. The spawn seam (Track 3) then refuses it with
  "removed in admin". This implements the removal decision. Every other
  unallowed explicit pick keeps today's fallthrough.
- `readConfiguredModel("agentModel")` admits an id in the added list.
  `smallModel` does not: cheap structured passes stay tiered.
- `loadEffectiveBoxModel`, `resolveSessionModel`
  (`core/chat/session/model.ts`), and the reactor/procedure call sites load
  `added` once per resolution, next to the `loadBoxModel` read they already
  do.

**Vocabulary lock-ins:** provider name `openrouter`; box config key
`openrouterModels`; entry fields `id`, `label`.

**First chunk:** provider, config loader, required-arg threading, and
doctests: `providerOf` on each family; a tiered step on an OpenRouter-default
box resolves to first-party; a removed explicit pick survives resolution;
an unknown id is refused by `setModel`.

### Track 3 — One provider-env seam and the spawn gate

**What:** one function decides, for a resolved model, what env the claude
engine run needs, or refuses. GLM and OpenRouter both go through it.

**Why:** the five sites listed under What already exists each carry a GLM
branch. Adding OpenRouter at each one doubles that code. The gate (list
membership plus key) must also hold at every spawn, not only at the picker.

**Direction:**
- New `core/provider-env.ts`:
  `providerEnvAdditions({ boxRoot, model, purpose }): Promise<Record<string, string> | null>`.
  - It returns null for first-party models.
  - For GLM, it returns `glmEnvAdditions(key)`.
  - For OpenRouter, it first checks that the id is in `loadAddedModels(boxRoot)`,
    then resolves the key and returns `openRouterChatEnv(key, model)`.
  - Every refusal throws a subclass of `ProviderSetupError`
    (`core/provider-setup-error.ts`), which has a `provider` field and a
    message naming the fix. `GlmKeyError` and `OpenRouterSetupError` both
    extend it.
- The refusal messages:
  - Removed or unknown model: "This chat uses the OpenRouter model
    `<id>`, which is not added for this box. Add it in Admin → Agent engine
    and model, or pick another model."
  - Missing key: "…needs an OpenRouter key granted to this box. Set it up in
    Admin → Secrets." For GLM, the existing text stays.
- `openRouterChatEnv({ key, model })` is pure, in `core/openrouter-chat.ts`.
  It returns:
  - `ANTHROPIC_BASE_URL=https://openrouter.ai/api` and `ANTHROPIC_AUTH_TOKEN=key`;
  - `ANTHROPIC_API_KEY=""`;
  - each role variable set to `model`, so no background call goes out as a
    `claude-*` id billed through OpenRouter;
  - `API_TIMEOUT_MS`, reusing GLM's rationale.
  Track 1 confirms the exact role variable set.
- `openRouterChatAdditions` in `core/openrouter-chat.ts` checks list
  membership, then resolves the key, and throws `OpenRouterSetupError` for
  either. `getOpenRouterKey` keeps collapsing to null for the optional
  services.
- The five sites call `providerEnvAdditions`. The preflight branches in
  `run.ts` and `auth-preflight.ts` become "non-first-party provider → call the
  seam (its throw is the preflight); first-party → `checkClaudeAuth`".
- Prompt logger: `run.ts:208-216` disables it for GLM. That becomes "for
  any non-first-party provider", with the same message.
- Engine-unavailability guard: `run.ts` calls `applyEngineUnavailability`
  with `provider: "claude"` only when the run's provider is first-party. A
  third-party quota error is returned as an ordinary failure and cannot park
  the Claude engine.

**Vocabulary lock-ins:** `providerEnvAdditions`, `ProviderSetupError`.

**First chunk:** the seam, GLM moved onto it with its existing doctest still
passing, and `run.ts`. The chat sites, thread, prewarm, and preflight follow
in a second chunk. Doctests cover: the OpenRouter env shape; the refusal for a
removed id, even with a key present; the refusal for a missing key; a
first-party model gets null; the unavailability guard skips third-party runs.

### Track 4 — OpenRouter catalog and key usage

**What:** a small server client for two OpenRouter reads: the public model
list (no key), and the key's usage (with the key).

**Why:** add-time validation and the price line need the catalog. The spend
line needs key usage.

**Direction:**
- New `core/openrouter-catalog.ts`:
  - `lookupOpenRouterModel(id)` fetches `GET https://openrouter.ai/api/v1/models`
    and caches it in memory for one hour.
  - It strips any `:variant` suffix before the lookup.
  - It returns `{ found: false }` or `{ found: true; name; contextLength;
    supportsTools; supportsStructuredOutputs; pricing: { promptPerMTok;
    completionPerMTok; cacheReadPerMTok | null } }`. Prices are converted
    from per-token strings to dollars per million tokens.
  - A fetch failure is a typed error. The admin add path shows it and refuses
    to add. It never adds unvalidated.
- `readOpenRouterKeyUsage(key)` calls `GET /api/v1/key` and returns
  `{ usageUsd, limitUsd | null }`, in the shape Track 1 records. A failure
  returns an error value; the admin line reads "Usage unavailable" with the
  reason.
- Tests use an injected `fetch`. The fixture is the recorded real response
  from Track 1, trimmed to a few entries. It is not a hand-written guess.

**First chunk:** both functions and the doctest.

### Track 5 — Admin, tRPC, picker

**What:** the owner adds and removes models in admin. Chat pickers and the
default-model select show the added models.

**Direction:**
- tRPC (owner-gated, `admin` router):
  - `openrouterModels` query: the added list with a live catalog lookup per
    entry, key status (`granted` or `missing`, a non-spending
    `observe: false` resolve), and key usage.
  - `addOpenrouterModel({ id, label })`: validates the id against the catalog.
    It refuses an id that is not found, or that does not list `tools`, with a
    message naming which check failed. It saves through
    `updateBoxConfigFields`, which commits the change.
  - `removeOpenrouterModel({ id })`: refuses while the id is the box's
    `agentModel`, with the message "Change the default model first".
  - `updateBoxConfig.agentModel` accepts an added id.
- `chat.status` gains `addedModels: AddedModel[]`. It is empty when the
  OpenRouter key is not usable, the `glmAvailable` precedent
  (`chat-control-procedures.ts:135`). The picker filter is a courtesy; Track 3
  is the gate.
- Frontend:
  - New `components/admin/OpenRouterModelsSection.tsx`, rendered by
    `AdminPage` after `AgentEngineSection`, only when the claude engine is
    enabled.
  - Contents: key status (with a link to Secrets when missing); one line of
    key usage ("This OpenRouter key has spent $X in total, across all uses",
    plus its limit or "no spending limit"); the added models (label, id,
    price per million tokens in and out, context length, Remove); an add form
    (model id, label) with one-click suggestions from Track 1's passing
    models.
  - Copy, fixed here: "Each model is billed per use to your OpenRouter
    account, at the prices shown. There is no flat rate. Consider setting a
    spending limit on the key at openrouter.ai. Models other than Claude may
    fail agent turns that need tools." And: "OpenRouter picks the host for
    each request according to your account's privacy settings."
  - The default-model select and the chat pickers (`SessionChip`,
    `SessionChip-model-panel`, `use-chat-model`) call
    `chatModelOptions(engine, added)`.
- Use the bbx-frontend guidance for the admin component. Components own their
  landmarks.

**First chunk:** tRPC plus the admin section, verified in the browser on this
worktree's box with the catalog faked. The picker follows.

### Track 6 — Docs and the stated exception

**What and direction:**
- The `core/openrouter.ts` header gains a paragraph: chat and agent models are
  the one OpenRouter use that needs an owner act in admin, because they bill
  per turn at agent-loop volume; see `core/provider-env.ts`.
- `docs/model-policy.md` gains an OpenRouter section covering: what adding a
  model does; that tiered steps stay first-party; that it is billed per use;
  the host/data-policy note; and removal behavior.
- A uses entry for the `openrouter` secret: "chat and agent models added in
  admin".

**First chunk:** all of it, one commit.

## Could this be simpler?

- **The simplest version** is Tracks 2, 3, and 5 without the catalog. The
  admin types an id and label, and it is saved unchecked. It works, but:
  - A typo or a model without tool support is found only when a chat turn
    fails. That is later and in a worse place, since the failure lands in a
    conversation, not in the form that caused it
    (`beebox/docs/engineering-principles.md`, validate at the boundary).
  - The boxholder chose price and key-usage visibility (2026-09-19), and both
    need the catalog client anyway. Validation reuses the same fetch.
- **Cut from the start:** per-model spend accounting (the boxholder chose
  key-level usage), a tier per added model, a curated capability registry,
  and a CLI command.
- **The Track 3 consolidation** is not required for OpenRouter to work. It
  exists because the alternative is ten provider branches across five files
  instead of five calls to one seam.

## Subplans

none — the spike is a track with recorded deliverables.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| OpenRouter model picked, key missing or revoked | new doctest (seam refusal) | `ProviderSetupError` before spawn; picker hides rows | clear |
| Admin removes a model a chat explicitly picked | new doctest (resolution keeps pick; seam refuses) | refusal names "not added for this box" | clear |
| Admin removes the model that is the box default | new doctest (remove refused) | `removeOpenrouterModel` refuses | clear |
| Hand-edited `box.json` has a malformed entry | new doctest (loader drops + warns) | entry ignored; a chat that picked it refuses | clear (warning + refusal) |
| Typo'd or tool-less id at add time | new doctest (catalog fake) | add refused, names the failed check | clear |
| Catalog fetch fails at add time | new doctest | add refused with the fetch error | clear |
| Model passes validation but fails the agent loop (bad tool calls) | spike only | turn fails with OpenRouter/CLI error | clear, not classified — accepted; admin copy warns |
| Out of OpenRouter credit mid-run | spike records the string | ordinary failure; the new guard stops it parking Claude | clear |
| Scheduled message fires into a chat whose model was removed | doctest (`chat-schedule-fire`) | turn refused; schedule dropped, no fresh-chat retry (boxholder, 2026-09-19) | logged warning |
| Claude Code sends a background call as a `claude-*` id | spike (e) | role variables pinned to the model | would be silent spend — the spike must confirm, see gap below |
| `total_cost_usd` mispriced | doctest (dropped on third-party results) | omitted; key-usage line is the real figure | clear — no figure rather than a wrong one |
| Prompt logging on an OpenRouter run | doctest via the generalized branch | logger disabled with a message | clear |
| Key-usage endpoint shape differs from docs | spike (g) | "Usage unavailable: <reason>" | clear |

> **Critical gap (conditional):** background calls escaping as `claude-*` ids.
> If the CLI makes a request under a model id the role variables do not
> cover, it bills through OpenRouter at Anthropic prices, and nothing reports
> it. Track 1 (e) must show that no such request occurs. If one does, fix the
> env set before Track 3 ships. If it cannot be closed, report it to the
> boxholder as a blocker.

## Agent-flow / user-flow edge cases

- **Wrong field** — an agent writes `openrouterModels` into box config by
  hand: ADDRESSED. `box.json` is committed box config. The boxholder trusts
  enabled agents equally (`box-glm-provider.md`, 2026-09-15). Config writes
  are visible in git history. The admin surface is the intended path. A
  write-refusing gate for agents is NOT in scope.
- **Stale ref** — a chat's pick was removed: ADDRESSED (Track 2 resolution,
  Track 3 refusal).
- **Two agents touching the same card:** unaffected. There is no new shared
  card state; config writes go through `updateBoxConfigFields`.
- **Hand-edit drift** — a typo in a hand-edited id: ADDRESSED. The loader
  validates shape only. A well-formed but nonexistent id is kept, and a turn
  on it fails with OpenRouter's "not a valid model" error, which the spike
  records. Accepted: the admin path validates against the catalog.
- **Fabricated free-form value:** the label is display-only and never sent.
- **Validation error UX:** ADDRESSED. Each refusal names the admin location.
- **Partial migration:** no migration. Boxes without `openrouterModels`
  behave exactly as today.

## NOT in scope

- **Re-routing embeddings or transcription** — settled in `core/openrouter.ts`.
- **Per-model spend accounting** — the boxholder chose key-level usage.
- **A proxy that injects OpenRouter's `provider` block into chat requests**
  (host pinning, `data_collection: "deny"`). It would restore the optional
  services' posture, at the cost of a long-lived rewriting proxy on the chat
  path. Deferred; the account setting covers it.
- **Tiers for added models, or an `openrouter` column in `PROCEDURE_MODELS`**
  — decided 2026-09-19.
- **Classifying OpenRouter quota errors as engine unavailability.** Same
  reason as GLM: the store is keyed by engine, not provider.
- **A `bbx` CLI surface** — the boxholder uses the web UI.
- **Vision/image input** through OpenRouter models. It is not tested by the
  spike, and scan-vision stays first-party.

## Open design questions

- **Which models to suggest, and whether with `:exacto`.** Decided by Track 1
  results. It does not block Tracks 2–4.

## Knowledge audits

Skip, with this rationale: no agent-facing concept is added. Agents see a
resolved model id and treat it as opaque. Box config is owner surface.

## What will hold this after it ships

- The risky decisions are pure functions reached by doctests:
  - `providerOf`, and resolution with a required `added` list;
  - the removed-pick rule;
  - the `providerEnvAdditions` refusal logic;
  - `openRouterChatEnv`'s shape;
  - the unavailability guard;
  - catalog parsing.
- Files: `test/core/openrouter-chat-models.doctest.md` (vocabulary, policy,
  and the spawn seam), `test/core/openrouter-catalog.doctest.md`, and
  `test/webapp/trpc-admin-openrouter.doctest.md` (the admin procedures).
  `glm-key.doctest.md` is unchanged.
  Existing `chat-models.doctest.md`, `chat-session-model.doctest.md`, and
  `reactor-model-policy.doctest.md` gain cases for `added`.
- The catalog fixture is a recorded real response, not a hand-written guess.
  No new test tier.
- A real end-to-end turn needs a paid key. The spike is that check, run once.
  It is not a doctest.

## Implementation order

1. Track 1 spike (blocked on the `openrouter` grant for `test1`). Findings
   recorded here.
2. Track 2 (vocabulary and policy threading). Independent of the spike's
   results.
3. Track 3 first chunk (the seam; GLM moved; `run.ts`), then the second chunk
   (chat, prewarm, thread, preflight). The role-variable set waits on spike
   (e).
4. Track 4 (catalog and key usage). The key-usage shape waits on spike (g).
5. Track 5 (tRPC and admin section, then picker).
6. Track 6 (docs).

Chunks commit in the worktree. The plan ships as one piece when every chunk is
done and the boxholder asks.

## Rollout shape

Done when:
- the new and extended doctests pass;
- `pnpm --dir beebox typecheck` is clean;
- change-selected lint is clean;
- the admin section is verified in the browser on this worktree's box (add
  with a faked catalog, remove, default refusal, picker rows);
- spike findings are recorded, including a clear answer to the
  critical-gap row;
- cross-model review has run on the branch.

No data migration. Each box opts in, box by box, by an owner act in admin.

## Track 1 results (2026-09-19)

The spike ran against the boxholder's key (from `beebox/.env`, authorized
2026-09-19). A local logging proxy sat in `ANTHROPIC_BASE_URL`'s slot and
recorded every request's `model`. The task was one agent turn: Bash `ls`,
Read a file, then structured output (`json_schema`), followed by a resume turn
with no tools. It used the harness plugin and `bypassPermissions`, as
`run.ts` does. Total spend was about $0.15.

| Model | Tools | Structured output | Resume | Prompt caching |
|---|---|---|---|---|
| `deepseek/deepseek-v3.2` | pass | pass | pass | none reported |
| `moonshotai/kimi-k2-0905` | pass | pass | pass | yes (18k cache-read) |
| `moonshotai/kimi-k2-0905:exacto` | pass | pass | pass | yes (35k cache-read) |
| `qwen/qwen3-coder` | pass | pass | pass | partial (1.9k on resume) |

- **(a–c)** Tools, structured output, and resume work on all four ids.
  DeepSeek V3.2 emits thinking blocks, and they round-trip.
- **(d)** The id reaches OpenRouter verbatim in `model`, including the
  `:exacto` suffix.
- **(e)** No request left under a `claude-*` id, with or without the role
  variables set. Every `/v1/messages` call carried the chosen id, including
  the tool-less first call. The run did not exercise subagents or a
  haiku-role call, so the role variables stay set as a guard. Env set used:
  - `ANTHROPIC_BASE_URL=https://openrouter.ai/api`;
  - `ANTHROPIC_AUTH_TOKEN`;
  - `ANTHROPIC_API_KEY=""`;
  - `ANTHROPIC_DEFAULT_{FABLE,OPUS,SONNET,HAIKU}_MODEL`,
    `ANTHROPIC_SMALL_FAST_MODEL`, and `CLAUDE_CODE_SUBAGENT_MODEL`, all set
    to the model;
  - `API_TIMEOUT_MS`.
  The CLI also calls `GET /api/hello`, which returns 404 and is harmless.
  **Critical-gap row: closed by observation.**
- **(f)** Bad id: HTTP 400, surfaced by the CLI as `API Error: 400
  deepseek/not-a-model is not a valid model ID`. It costs nothing. Not
  produced: bad-key and no-credit strings (producing them means changing the
  key or spending it down).
- **(g)** `GET /api/v1/key` with the key returns `data.usage` (lifetime
  dollars), `data.usage_daily`, `usage_weekly`, `usage_monthly`, `data.limit`
  (null when unset), `limit_remaining`, and `limit_reset`. Usage lagged by
  at least a minute after the runs. The admin line says the figure is
  delayed.
- **(h)** `total_cost_usd` overstates badly. It reported $0.03–$0.49 per turn
  where OpenRouter's per-request `cost` summed to $0.01–$0.03, about 5–20×.
  `maxBudgetUsd` would trip early on these models. `core/usage.ts` records
  tokens, not this figure. The only carrier is the chat result message, which
  now omits it for third-party runs (boxholder, 2026-09-19: "we shouldn't
  misreport it, instead just skip reporting"). GLM gets the same treatment.

**Suggestions that ship:** `moonshotai/kimi-k2-0905:exacto` (Kimi K2),
`deepseek/deepseek-v3.2` (DeepSeek V3.2), `qwen/qwen3-coder` (Qwen3 Coder).
