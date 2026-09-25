---
title: "Box-side GLM: Z.ai models on the claude engine"
status: partial
workstream: glm-v2-layout
issues:
  - ../../../issues/closed/exploration/2026-07-18-model-backend-pluggability.md
---
# Box-side GLM: Z.ai models on the claude engine

Boxes gain GLM as a set of model ids that run on the existing claude engine
against Z.ai's Anthropic-compatible endpoint, with the API key held in the
machine secret store and injected into the agent child's environment whenever
the run's resolved provider is GLM. No third engine, no routing, no new auth
flow. A session may start on GLM and continue anywhere, or the reverse:
transcripts are local files (`core/chat/session/transcript-paths.ts:18-23`)
and the provider is per-process environment, so the CLI does not care — the
boxholder accepts mixed-provider sessions (all enabled agents in a box are
equally trusted).

**Issues addressed:** executes the spike gated by
[2026-07-18-model-backend-pluggability](../../../issues/closed/exploration/2026-07-18-model-backend-pluggability.md)
(its `## Research (incomplete)` section is this plan's Track 1). Partially
resolves
[2026-07-18-provider-endpoint-config](../../../issues/features/2026-07-18-provider-endpoint-config.md) —
the GLM slice of its Shape A — but that issue stays open: it scopes a generic
per-provider config surface (OpenRouter, vLLM, API-billed Anthropic), which this
plan does not build. Not related:
[2026-09-15-scan-vision-integration-fails-when-not-logged-in](../../../issues/bugs/2026-09-15-scan-vision-integration-fails-when-not-logged-in.md)
touches the same `claude auth status` weakness but is a dev-machine login problem.

**Spike results (2026-09-15, recorded in the pluggability issue):** the full
headless loop works on Z.ai — tools, streaming, thinking blocks, prompt caching
(22k cache-read tokens on the second call), structured `json_schema` output,
and resume — and both wire ids (`glm-5.3`, `glm-5.3-flash`) are confirmed.
`total_cost_usd` is reported but tracks first-party-tier pricing, so the
budget caveat stands in a weaker form: the number exists and is directionally
useless. One credential finding: `beebox/.env`'s `GLM_API_KEY` 401s; the
working key is the ambient `ANTHROPIC_AUTH_TOKEN` — boxholder to reconcile.

**Review status:** a Codex (gpt-5.6-sol) adversarial plan review ran 2026-09-15
(raw output: `scratch/cross-model-out.md`, worktree-local). Ten findings; all
ten verified against source and adjudicated. The material revisions they forced:
provider resolution moved from per-invocation to per-session/per-box with
explicit lifecycle sites (commit retry, prewarm, thread path); chat-path
injection moved into model resolution after the reviewer showed the env builder
runs before the model exists; GLM availability made owner-gated per box; the
secrets-refusal adapter made concrete; Track 4 cut (see NOT in scope); guide/
uses/format registry entries added to Track 5. Boxholder round-2 adjudication
(2026-09-15): the per-provider consent gate is cut — *"I assume people trust
all enabled agents equally in a box"* — and mixed-provider sessions are
accepted, so GLM menu entries are unconditional; tier overlap confirmed as the
intended design.

## Smallest fix and budget

Smallest possible fix: paste the GLM env vars into the box server's
environment. Rejected up front — it reintroduces exactly the env-var
credentials that secret-custody Track 3 retired, and it is machine-global (the
dev-side lesson: `bin/lib/glm-provider.sh:16-17` refuses a second credential
home and refuses `~/.claude/settings.json` because it would silently redirect
every Claude session).

Chosen design, four tracks, estimated **600–700 changed lines** across ~15
files (source plus tests together; plan doc separate; no generated output):

| Track | Subject | Est. lines |
|---|---|---|
| 1 | Headless-loop spike against Z.ai (research, mostly runtime) | ~100 (spike script + recorded findings) |
| 2 | Model vocabulary: ids, tiers, provider-aware resolution, menus | ~180 |
| 3 | Key custody, provider-resolved injection across all spawn lifecycles, preflight | ~280 |
| 4 | Setup/UX surfaces and docs | ~120 |

The fuller design buys tier integrity: without track 2's provider-aware tier
resolution, a GLM-defaulted box running a `model: strong` procedure step would
silently bill first-party Opus — a wrong-provider spend the resolver exists to
prevent (`docs/model-policy.md`: "the resolver … cannot produce a name the
running engine does not know"). Not a BIG CHANGE.

## Stated preferences this plan trades against

- `docs/implemented-plans/secret-custody.md` — the defended line is
  agent-vs-server; server processes are inside the trust boundary. The key is
  resolved by the server and injected into the child env; the agent can run
  `env` and read it, exactly as it can read every connector credential the
  server legitimately holds. No `agent`-access grant is created.
- `core/script-env-allowlist.ts:29-32` — *"ANTHROPIC_API_KEY — the Claude Agent
  SDK and CLI both pick it up if present and silently bill it instead of the
  boxholder's subscription."* This plan deliberately sets `ANTHROPIC_AUTH_TOKEN`
  + `ANTHROPIC_BASE_URL` on GLM-provider runs. The difference is consent and
  custody: the subscription assumption exists so ambient keys never leak into
  billing; here the owner opts a box (and therefore a spend and a data
  posture) in by config, and the values are injected per-run via caller
  `additions`, never inherited. The allowlist itself does not widen.
- Boxholder scoping recorded in the endpoint-config issue (2026-07-18): one
  provider chosen up front, *"no routing, no fallback logic."* Two
  consequences the review sharpened: (a) no fallback to first-party when Z.ai
  fails — the run fails visibly; (b) no per-provider consent gating inside a box: the boxholder accepts that
  any agent a box runs is equally trusted with its content, so a chat moved to
  a GLM model is not an information leak to defend against
  (boxholder, 2026-09-15).
- Shipped precedent for a provider key: `core/gemini-key.ts` (store name,
  `server` access, per-caller `purpose` labels). GLM follows the shape but NOT
  the null-collapse: `getGeminiApiKey` returns `null` on every refusal
  (`gemini-key.ts:43`); GLM must distinguish them, because for GLM the key is
  load-bearing for the selected model, not an optional backend.
- Shipped precedent for the env mechanism: `core/agent/run.ts:215` already
  passes `ANTHROPIC_BASE_URL` through `buildScriptEnv` additions (prompt-logger
  proxy), and `core/script-env.ts:158-166` applies `additions` after the
  allowlist by design.

## What already exists

- **The provider shim, proven interactive-side**: `bin/lib/glm-provider.sh` —
  endpoint `https://api.z.ai/api/anthropic`, `ANTHROPIC_AUTH_TOKEN` (raw key),
  `API_TIMEOUT_MS=3000000` (first token can lag the CLI's default into reading
  as a hang), tier-name overrides `ANTHROPIC_DEFAULT_OPUS/SONNET/HAIKU_MODEL`.
  Reuse its constants and its timeout rationale; its key source (`beebox/.env`)
  is dev-only and is NOT reused.
- **Quota parser**: `workstreams-app/src/server/quota-glm.ts` documents Z.ai's
  quota API (raw `Authorization`, no Bearer; `percentage` is used-share;
  epoch-ms reset times). The probe-registry entry in track 4 reuses this
  endpoint knowledge; the card itself is not ported.
- **Key module pattern**: `core/gemini-key.ts` — store name constant,
  `resolveSecret({name, purpose, access: "server"})`, typed `purpose` per
  caller, `observe: false` status probes. (`resolveSecret` returns a
  `Result`, `core/secrets/resolve.ts:105` — refusal mapping is the caller's
  job; see Track 3.)
- **Injection point**: `buildScriptEnv(boxRoot, additions)` applies additions
  last (`core/script-env.ts:158-166`); `run.ts:213-216` and
  `core/chat/session/thread.ts:184-190` are agent spawn sites that take
  additions today.
- **Model resolution points** (the review pinned these; injection must ride
  them): chat cold start resolves the model AFTER env and preflight today
  (`core/chat/session/index.ts:168-172`: preflight, then
  `resolveSessionModel`); the env builder `buildBackendStartOptions` does not
  know the model (`core/chat/session/start.ts:114-161`); prewarm resolves the
  model separately from env (`core/chat/session/registry-warm.ts:47-59`);
  agent runs forward `opts.model` per invocation and the commit-nudge retry
  re-invokes WITHOUT a model (`core/agent/commit.ts:65-70`,
  `core/agent/index.ts:101-113`); the thread path starts with no model at all
  (`core/chat/session/thread.ts:166-200`).
- **Tier machinery**: `shared/agent-models.ts` `PROCEDURE_MODELS`,
  `MODEL_TIERS`, `TIER_RANK`; `shared/model-ids.ts` `MODEL_ID` +
  `normalizeModelId`; box-config validation via `readConfiguredModel`
  (`core/box/config.ts:206-220`) admits any id with a non-null
  `modelTier()`.
- **Preflight shape**: `core/agent/auth-preflight.ts` `preflightChatBackend`
  branches on engine with per-backend `requires*Auth` flags
  (`services/claude-chat-types.ts:104-110`).
- **Secrets setup surface**: built-in secret names need guide entries — a
  doctest asserts `unguidedSecretNames()` is empty
  (`core/secrets/guide-registry.ts:195-197`), and uses + format hints are
  separate registries (`core/secrets/uses.ts`, `core/secrets/format-registry.ts:50`).
- Searched `beebox/src` and `beebox/docs` for existing glm/z.ai groundwork:
  nothing (only an unrelated self-hosted OCR model name in an unimplemented
  plan). All box-side work is new.

## Prior art (external)

- Z.ai's Anthropic-compatible endpoint works for the full interactive Claude
  Code loop — tool use, streaming, resume — evidenced by daily dev workstream
  use since 2026-09-14 (`fb0e21501`). Not yet evidenced: the **headless SDK
  loop** with beebox's shape (structured `outputFormat`, harness plugin,
  `maxTurns`, long compaction-heavy sessions). That gap is Track 1; no external
  source substitutes for it.
- Translating proxies are documented lossy on thinking blocks and
  `cache_control` (claude-code-router, LiteLLM — per the pluggability issue).
  Z.ai is a native compatible endpoint, not a proxy, but "compatible, not
  Anthropic's own" is exactly what the spike tests.
- Z.ai data posture (from the July deep pass, recorded in the endpoint-config
  issue): coding-plan request content IS inspected; "personal assistants" is a
  named banned pattern; headless use trips an "SDK-based access" flag. The
  boxholder runs dev workstreams on GLM already; boxes carry personal content
  of exactly the flagged shape. **Decision recorded, not re-litigated here:**
  the boxholder's request to build this is the acceptance; the plan surfaces
  the posture in the setup docs, and per-box owner gating (Track 2) keeps the
  choice out of chat-follower hands.
- No prior art found for Z.ai rate-limit/quota error *strings* surfacing
  through the CLI — Track 1 records them for future unavailability work.

## Tracks / scope

### Track 1 — Spike: the headless loop on Z.ai

**What:** a throwaway script (not shipped) runs the real SDK `query()` against
Z.ai with the boxholder's dev key, mirroring `run.ts` options: harness plugin,
`outputFormat: json_schema`, `maxTurns`, a multi-turn tool-using task, and one
structured-output extraction.

**Why:** the pluggability issue gates all of Shape A on this. Interactive dev
use does not exercise structured output or the plugin.

**Direction:** record in the pluggability issue: (a) tools fire and results
parse, (b) streaming, (c) thinking blocks round-trip, (d) prompt caching
present or absent (if absent: accepted latency/cost regression, noted), (e)
`tool_use`/`tool_result` across compaction, (f) the concrete wire model ids
for GLM and GLM Flash (`glm-5.3-flash` is unverified — the spike confirms the
literal), (g) verbatim quota/rate-limit error strings (recorded for future
unavailability work, see NOT in scope), (h) whether `total_cost_usd` is 0 or
wrong for GLM.

**First chunk:** the spike script plus findings recorded. No open questions
survive into Track 2's chunk.

### Track 2 — Model vocabulary and owner gating

**What:** GLM becomes first-class model ids, selectable only where the owner
enabled it.

**Why:** today a glm id is rejected by box config ("not a model any engine
offers"), absent from chat menus, and unknown to procedure tier resolution.

**Direction:**
- `MODEL_ID.glm` and `MODEL_ID.glmFlash` in `shared/model-ids.ts`, values =
  the wire literals Track 1 confirms; `glm`/`glmFlash` are property names,
  never persisted or sent.
- New pure predicate in `shared/agent-models.ts`:
  `glmProvider(model: string): boolean` (any id in the GLM family — mirroring
  `glm_is_model`'s prefix rule in `bin/lib/glm-provider.sh:25-27`), plus
  `providerOf(model): "anthropic" | "glm" | "openai"` partitioning all ids.
- `MODEL_TIERS` gains both GLM ids (boxholder's mapping: GLM ≈ Opus/Sol =
  strong, flash ≈ Sonnet/Terra = balanced). `modelTier()` then admits glm ids
  in `readConfiguredModel` with no config change. The reverse map stays exact
  (each id → one tier); only `modelTier()` consumes it.
- Provider-aware tier tables: `PROCEDURE_MODELS` becomes
  `Record<AgentEngine, Record<ProcedureProvider, Record<Tier, string>>>`
  with `ProcedureProvider = "anthropic" | "glm"`; the GLM column is
  `efficient: glmFlash, balanced: glmFlash, strong: glm, strongest: glm`
  (two ids cover all four tiers — no third model exists to buy tiers with).
  `resolveProcedureModel(engine, model, provider)` gains the provider arg with
  a default of `"anthropic"` so existing call sites keep compiling, and the
  call sites that must become provider-aware are exactly the ones the review
  showed resolve engine-only today: `resolveSmallModelForEngine`
  (`core/model-policy.ts:142-147` — a GLM-defaulted box's cheap passes must
  reach glm-flash, not first-party haiku), procedure execute
  (`core/procedure/engine-run-execute.ts:95-101`), and the judge
  (`core/procedure/engine-validate-model.ts:145-147`). Each loads the box's
  effective default model it is already entitled to load and derives the
  provider from it; a pinned GLM `smallModel` resolves provider glm directly.
- Chat menus: `shared/chat-models.ts` claude list gains GLM entries,
  unconditionally — the static menu is the whole mechanism, and a box without
  a usable key fails at spawn with the Track 3 refusal, which names the two
  setup commands. No new config field gates them (boxholder, 2026-09-15:
  enabled agents are equally trusted; provider drift inside a box is not an
  information-leak surface).

**Vocabulary lock-ins:** store secret name `glm`; provider names
`"anthropic" | "glm"`.

**First chunk:** ids + tiers + predicate + config admission + doctest for
resolution. Menus are the second chunk.

### Track 3 — Key custody, provider-resolved injection, preflight

**What:** the key lives in the secret store; every run whose resolved provider
is GLM carries the endpoint and token in its child env, across all spawn
lifecycles.

**Why:** without this the model ids select a provider that cannot authenticate
— and the review showed provider identity must be resolved ONCE per logical
session and carried through resumes, prewarm, and the thread path, or GLM
sessions silently revert to first-party mid-life (a transcript that started on
Z.ai resuming against Anthropic is a data-posture violation, not just a bug).

**Direction:**
- `core/glm-key.ts`: `GLM_SECRET_NAME = "glm"`, `resolveGlmKey(boxRoot,
  {purpose})` on the gemini-key shape with `access: "server"`. Unlike
  `getGeminiApiKey`, refusals are NOT collapsed to null: the module maps
  `SecretRefusal` kinds to one actionable error naming the two commands
  verbatim (`bbx secrets set glm`, `bbx secrets grant <box> glm`). A GLM run
  without a usable key is a hard error, never a silent first-party fallback.
- Pure function `glmEnvAdditions(key: string): Record<string, string>` in the
  same module: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `API_TIMEOUT_MS=3000000`. This module is the only place Z.ai's endpoint
  literal lives in `beebox/src`.
- **One provider resolution per session, pinned at construction:**
  `createClaudeAgent` already resolves the box engine once at factory time
  (`core/agent/index.ts`) and tracks per-instance invocation count; it gains
  the box's resolved default model + provider at the same moment, records the
  model of each invocation, and reuses the recorded model when an invocation
  omits one. That closes the commit-nudge retry gap (`core/agent/commit.ts:65-70`
  re-invokes without a model — today's design would resume a GLM session with
  first-party env) without touching the retry itself.
- **Batch/agent injection:** `run.ts` setup env adds GLM additions when the
  run's effective model is GLM. When prompt logging is also active, the two
  collide on `ANTHROPIC_BASE_URL` (the logger is a local proxy,
  `core/agent/prompt-logger.ts`); resolution: warn and disable prompt logging
  for GLM runs (it is a debug surface, and teaching the proxy a Z.ai upstream
  buys little), stated here so implementation does not re-litigate.
- **Chat injection:** model resolution moves ahead of env assembly on the cold
  start: `buildBackendStartOptions` (`core/chat/session/start.ts`) resolves
  the session model itself and returns env + model + provider together, so
  preflight (`core/chat/session/index.ts:168-172`), env, and the warm pool
  (`registry-warm.ts`, which already resolves the model separately) all see
  one resolved triple. Prewarm slots key on provider as they already key on
  model.
- **Thread path:** `core/chat/session/thread.ts` resolves the chat/box model
  for the thread (it currently passes none and starts on the harness default,
  `thread.ts:195-200`), injects GLM env when its provider is glm, and
  preflights GLM instead of Claude for those runs.
- **Preflight:** `checkGlmAuth(boxRoot, {observe})` — key presence via
  `resolveSecret({..., observe: false})`. `preflightChatBackend` gains a
  provider-aware branch: a claude-engine turn on a GLM-model session checks
  the GLM key, not `claude auth status` — which we proved this week reports
  logged-in from token presence alone
  (`issues/bugs/2026-09-15-scan-vision-integration-fails-when-not-logged-in.md`).

**First chunk:** glm-key module + refusal mapping + `run.ts`/agent-factory
resolution + doctests on `glmEnvAdditions`, the refusal messages, and the
model-carried-through-retry behavior. Chat, thread, and preflight follow in
the second chunk.

### Track 4 — Setup and docs

**What:** the boxholder can set this up from the admin surface and understand
the posture.

**Why:** the key has no OAuth flow; the store is the setup UX (secret-custody
Track 2 calls the admin Secrets section "the boxholder's management surface").

**Direction:** the `glm` secret name needs guide, uses, and format-registry
entries — the guide doctest fails on a builtin name without one
(`core/secrets/guide-registry.ts:195-197`); the guide's `what` carries the
Z.ai data-posture warning. Docs pass on `docs/model-policy.md` (a GLM
section: what it is, the posture warning, setup = set the key, grant the box,
opt in via `providers`/`agentModel`); a probe-registry entry validating the
key against the quota endpoint (reusing `quota-glm-request.ts`'s
endpoint/header knowledge, server-side). No new admin UI component.

**First chunk:** registries + probe + docs, one chunk.

## Could this be simpler?

Simplest shippable version: Tracks 2+3 only, with GLM as pinned-ids-only (no
tier integration, no procedure provider column, no `providers` gate). What the
fuller plan buys, per the model-policy contract: tier resolution exists so a
policy survives engine and provider switches instead of silently changing
spend — without the provider column, `model: strong` on a GLM box resolves to
first-party Opus, which is the exact silent-wrong-provider outcome the policy
was built against (boxholder, 2026-09-14: unpinned boxes must have a default
they can name). Without the `providers` gate, any chat participant can move a
conversation's content to Z.ai — the one spend-and-posture choice this plan
agrees stays with the owner. Nothing else in the plan is machinery without a
caller; the review's proposed cut candidates (unavailability classification,
admin probe) were accepted and are gone from the tracks.

## Subplans

none — the spike is a track with a recorded deliverable, not a design step.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| glm model selected, key missing/ungranted | new doctest (refusal mapping) | typed, actionable error → run refuses pre-spawn | clear |
| GLM session resumes without its provider (retry/prewarm/thread) | new doctest (model carried through omitted-model invocations) | agent instance records its model; chat resolves model before env | clear — would have been silent without the review; this row is the fix |
| Key invalid/rotated (401 mid-run) | no (needs live key) | Z.ai 401 surfaces as run error; presence preflight still passes | clear (error text names auth) but not classified — accepted, noted in docs |
| Z.ai quota exhausted mid-run | none | ordinary failure path (batch retry); strings recorded by the spike for future work | clear error text, wrong retry class — accepted, see NOT in scope |
| `total_cost_usd` is first-party-priced for GLM (spike: 0.158 for ~28k in / 46 out) | spike records | `maxBudgetUsd` trips at the wrong price point; spend authority lives on Z.ai's quota endpoint | silent per-run, documented — accepted |
| Box on codex engine pins a glm id | doctest (tier degradation) | `resolveBoxModelForEngine` degrades to terra by tier | clear (existing warning) |
| Prompt caching absent on Z.ai | spike records: caching WORKS (22k cache-read on call 2) | n/a — regression risk closed | n/a |
| Prompt logging requested on a GLM run | covered in implementation choice | proxy forwards to Z.ai upstream (or warn-and-disable fallback) | clear either way |
| Dev key pasted into a prod box store by mistake | no | secret store has no env-scoping; `owningBox`/`shareable` fields exist but unused here | silent — accepted; docs name it |

> **Critical gap:** none unresolved — the accepted-silent rows (cost
> accounting, caching, key rotation) are Z.ai-side facts or machine states the
> plan records rather than codepaths it can handle.

## Agent-flow / user-flow edge cases

- **Wrong field** — procedure card says `model: strong` on a GLM box: ADDRESSED
  (Track 2 provider-aware resolution).
- **Hand-edit drift** — boxholder writes `agentModel: "glm-4"` (typo):
  ADDRESSED (`readConfiguredModel` rejects unknown ids with a named warning,
  `core/box/config.ts:206-220`).
- **Chat follower moves a chat onto GLM** — ADDRESSED by decision, not
  machinery: allowed everywhere the claude menu shows it; the boxholder trusts
  all enabled agents with box content equally (2026-09-15). The data-posture
  warning lives in the setup docs and the secret guide's `what` text.
- **Two agents touching the same card**: unaffected — no new shared state.
- **Fabricated free-form value**: N/A — no agent-authored input in this plan.
- **Validation error UX**: ADDRESSED — the refusal names the two store
  commands verbatim.
- **Partial migration / transition state**: ADDRESSED — there is no migration;
  existing boxes are untouched (no glm id anywhere unless the owner opts in).
  A box mid-edit (config names glm, grant not yet created) gets the clear
  refusal above.

## NOT in scope

- A third `AGENT_ENGINES` member — GLM rides claude; the dev side
  (`bin/lib/glm-provider.sh:2-14`) already committed to that framing.
- **Unavailability classification for Z.ai** (was Track 4; cut after review):
  `EngineProvider` is literally `AgentEngine` (`engine-unavailability.ts:12-16`)
  and run.ts hardcodes `provider: "claude"` (`run.ts:289`) — classifying Z.ai
  limits as claude would wrongly park every first-party Claude box, and doing
  it right means provider-keying the availability store, its schema, and the
  scheduler (`schedule/engine-wait.ts`). Deferred until a real box runs GLM
  and the failure cadence justifies that machinery; the spike records the
  error strings so the work is ready when it is.
- Generic provider-endpoint config (OpenRouter, vLLM, API-billed Anthropic) —
  the endpoint-config issue stays open; building the config surface for one
  provider inverts its generality for no second user yet.
- Routing/fallback between providers — excluded by boxholder scoping
  (2026-07-18).
- Scan-vision on GLM — `scan-vision-claude.ts` is hardcoded first-party
  Sonnet; vision was gated hard in the July research and there is no need.
- GLM quota cards on the box admin page — the dev dashboard already shows them;
  box-side is a probe validation, not a card.
- `maxBudgetUsd` enforcement for GLM runs — the CLI cannot price GLM; spend
  visibility lives on Z.ai's dashboard. Documented, not worked around.
- Per-provider consent gating inside a box (`providers` config field) —
  designed, then cut by boxholder decision (2026-09-15): enabled agents are
  equally trusted, so the gate was machinery without a threat model.
- ~~Chat menus gated by key *presence*~~ — REVERSED by boxholder 2026-09-15
  after seeing it live: GLM rows showed on boxes with no key, selectable but
  unusable. The picker now filters GLM rows on a server-reported usability
  check (`chat.status`'s `glmAvailable`, backed by a non-spending presence
  resolve); the spawn refusal remains the backstop. Flicker risk accepted —
  store edits are rare.

## Open design questions

- **Prompt-logger upstream vs disable on GLM runs**: lean upstream (keeps the
  feature), fallback warn-and-disable; both stated in Track 3, decided at
  implementation by proxy complexity.
- **Chat menu labels** for GLM (follow Z.ai's own naming). Decided in Track 2's
  second chunk; not blocking.

## Knowledge audits

skip-with-rationale: no agent-facing concept is added. Model choice is an
owner-config surface; agents see only a resolved model id they already treat
as opaque, and procedure tiers behave identically.

## What will hold this after it ships

- Doctests reach the risky decisions, which are extracted as pure functions or
  narrow seams: `glmProvider`/provider-aware tier resolution (track 2),
  `glmEnvAdditions` and refusal wording (track 3), and the
  model-carried-through-retry agent behavior (track 3). One new doctest file
  per cluster under `beebox/test/`,
  following `agent-doctest/docs/syntax.md`.
- No new mock tier and no mock written by this plan encodes a provider
  behavior: Z.ai's wire behavior is anchored by the spike's recorded findings
  in the pluggability issue, not by a fixture pretending to be Z.ai.
- A real end-to-end call needs a live key and cannot run in ordinary tiers
  (the scan-vision lesson: suite isolation strips the auth). Verification on
  a real box is a manual step the boxholder runs once at setup; it is not a
  doctest.

## Implementation order

1. Track 1 spike; findings recorded in the pluggability issue. **Gate: no
   Track 2 chunk before the wire model ids are confirmed.**
2. Track 2 first chunk (ids, tiers, predicate, config admission + doctest).
3. Track 2 second chunk (procedure provider column, menus).
4. Track 3 first chunk (glm-key + refusal mapping + agent-factory model
   carrying + run.ts injection + doctests).
5. Track 3 second chunk (chat/thread injection + preflight branch).
6. Track 4 (registries + probe + docs).

The plan ships as one piece when all chunks land; per-box activation
(config + grant) is the boxholder's, box by box.

## Rollout shape

Tests are designed with the tracks (named above per chunk) and land with them.
Done-when: the new doctests pass; `pnpm --dir beebox typecheck` clean;
change-selected lint clean; the pluggability issue's `## Research (incomplete)`
section is filled with spike findings; and one manual real-box run on a GLM
model completes a reactor job (boxholder-run, recorded in the issue). No data
migration exists or is needed.

**Status (2026-09-15, at landing):** every code and doc track above is shipped
on `main` — model vocabulary, tier resolution, key custody and injection
across all spawn lifecycles, preflight, secrets registries, and
`docs/model-policy.md`'s GLM section. The one open item is the boxholder-run
manual real-box reactor job on a GLM model: it has not run yet. Until a box
pins a GLM model and the owner grants the `glm` key, the feature ships
dormant; that activation and its verification run are per-box owner actions,
not branch work. Post-landing divergences from the direction text above:
provider resolution landed as `createModelCarrier` on the agent factory
(`core/agent/model-carry.ts`) rather than recording on the factory itself, and
`resolveProcedureModel` takes a params object instead of a defaulted third
argument.
