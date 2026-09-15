---
title: "Box-side GLM: Z.ai models on the claude engine"
status: draft
workstream: glm-v2-layout
issues:
  - ../../../issues/exploration/2026-07-18-model-backend-pluggability.md
---
# Box-side GLM: Z.ai models on the claude engine

Boxes gain GLM as a set of model ids (`glm`, `glm-flash`) that run on the
existing claude engine against Z.ai's Anthropic-compatible endpoint, with the
API key held in the machine secret store and injected into the agent child's
environment only when the resolved model is a GLM model. No third engine, no
routing, no new auth flow.

**Issues addressed:** executes the spike gated by
[2026-07-18-model-backend-pluggability](../../../issues/exploration/2026-07-18-model-backend-pluggability.md)
(its `## Research (incomplete)` section is this plan's Track 1). Partially
resolves
[2026-07-18-provider-endpoint-config](../../../issues/features/2026-07-18-provider-endpoint-config.md) —
the GLM slice of its Shape A — but that issue stays open: it scopes a generic
per-provider config surface (OpenRouter, vLLM, API-billed Anthropic), which this
plan does not build. Not related:
[2026-09-15-scan-vision-integration-fails-when-not-logged-in](../../../issues/bugs/2026-09-15-scan-vision-integration-fails-when-not-logged-in.md)
touches the same `claude auth status` weakness but is a dev-machine login problem.

## Smallest fix and budget

Smallest possible fix: paste the GLM env vars into the box server's
environment. Rejected up front — it reintroduces exactly the env-var
credentials that secret-custody Track 3 retired, and it is machine-global (the
dev-side lesson: `bin/lib/glm-provider.sh:16-17` refuses a second credential
home and refuses `~/.claude/settings.json` because it would silently redirect
every Claude session).

Chosen design, five tracks, estimated **500–650 changed lines** across ~15
files (source plus tests together; plan doc separate; no generated output):

| Track | Subject | Est. lines |
|---|---|---|
| 1 | Headless-loop spike against Z.ai (research, mostly runtime) | ~100 (spike script + recorded findings) |
| 2 | Model vocabulary: ids, tiers, provider-aware procedure resolution | ~150 |
| 3 | Key custody, env injection, auth preflight | ~200 |
| 4 | Z.ai unavailability classification | ~50 |
| 5 | Setup/UX surfaces and docs | ~100 |

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
  + `ANTHROPIC_BASE_URL` on some runs. The difference is consent and custody:
  the subscription assumption exists so ambient keys never leak into billing;
  here the boxholder opts a model (and therefore a spend) in by config, and the
  values are injected per-run via caller `additions`, never inherited. The
  allowlist itself does not widen.
- Boxholder scoping recorded in the endpoint-config issue (2026-07-18): one
  provider chosen up front, *"no routing, no fallback logic."* So: no fallback
  to first-party when Z.ai fails; the run fails visibly.
- Shipped precedent for a provider key: `core/gemini-key.ts` (store name,
  `server` access, per-caller `purpose` labels, consolidation of retired env
  reads). GLM follows it one-for-one.
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
  epoch-ms reset times). The probe-registry entry in track 5 reuses this
  endpoint knowledge; the card itself is not ported.
- **Key module pattern**: `core/gemini-key.ts` — store name constant,
  `resolveSecret({name, purpose, access: "server"})`, typed `purpose` per
  caller, `observe: false` status probes.
- **Injection point**: `buildScriptEnv(boxRoot, additions)` applies additions
  last (`core/script-env.ts:158-166`); `run.ts:213-216` and
  `core/chat/session/thread.ts:184-190` are the two agent spawn sites that take
  additions today.
- **Tier machinery**: `shared/agent-models.ts` `PROCEDURE_MODELS`,
  `MODEL_TIERS`, `TIER_RANK`; `shared/model-ids.ts` `MODEL_ID` +
  `normalizeModelId`; box-config validation via `readConfiguredModel`
  (`core/box/config.ts:206-220`) admits any id with a non-null
  `modelTier()`.
- **Preflight shape**: `core/agent/auth-preflight.ts` `preflightChatBackend`
  branches on engine with per-backend `requires*Auth` flags
  (`services/claude-chat-types.ts:104-110`).
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
  the posture in the setup docs so a future reader knows it was chosen.
- No prior art found for Z.ai rate-limit/quota error *strings* surfacing
  through the CLI — Track 1 records them, Track 4 depends on that.

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
`tool_use`/`tool_result` across compaction, (f) the concrete flash model id
(`glm-5.3-flash` is unverified — the spike confirms the literal), (g) verbatim
quota/rate-limit error strings for Track 4, (h) whether `total_cost_usd` is 0
or wrong for GLM.

**First chunk:** the spike script plus findings recorded. No open questions
survive into Track 2's chunk.

### Track 2 — Model vocabulary

**What:** `glm` and `glm-flash` become first-class model ids.

**Why:** today a glm id is rejected by box config ("not a model any engine
offers"), absent from chat menus, and unknown to procedure tier resolution.

**Direction:**
- `MODEL_ID.glm`, `MODEL_ID.glmFlash` in `shared/model-ids.ts` (literals from
  Track 1).
- New pure predicate in `shared/agent-models.ts`:
  `glmProvider(model: string): boolean` (any id in the GLM family — mirroring
  `glm_is_model`'s prefix rule in `bin/lib/glm-provider.sh:25-27`).
- `MODEL_TIERS` gains `glm: "strong"`, `glmFlash: "balanced"` (boxholder's
  mapping: GLM ≈ Opus/Sol, flash ≈ Sonnet/Terra). `modelTier()` then admits
  glm ids in `readConfiguredModel` with no config change. The one-to-one
  forward table stays one-to-one per *engine*; two providers sharing a tier is
  new, and only `modelTier()` consumes the reverse map, so it stays exact.
- Provider-aware procedure resolution: `resolveProcedureModel(engine, model)`
  gains the resolved box model's provider — concretely, `PROCEDURE_MODELS`
  becomes `Record<AgentEngine, Record<ProcedureProvider, Record<Tier,
  string>>>` with `ProcedureProvider = "anthropic" | "glm"`, and the call
  sites that already load the effective box model (`core/model-policy.ts`
  resolution, procedure execute at `core/procedure/engine-run-execute.ts`,
  judge default tier) pass the provider of the model they are about to run.
  Codex column is provider-"anthropic"-equivalent only (no GLM on codex); a
  glm id resolving onto the codex engine degrades by tier to terra, via the
  existing `resolveBoxModelForEngine` path.
- Chat menus: `shared/chat-models.ts` claude list gains "GLM" and "GLM Flash"
  entries.

**Vocabulary lock-ins:** model ids `glm-5.3` / `glm-5.3-flash` (Track 1
confirms); provider predicate named `glmProvider`; store secret name `glm`.

**First chunk:** ids + tiers + predicate + config admission + doctest for
resolution. No chat menu in this chunk.

### Track 3 — Key custody, injection, preflight

**What:** the key lives in the secret store; runs on a GLM model carry the
endpoint and token in their child env.

**Why:** without this the model ids select a provider that cannot authenticate.

**Direction:**
- `core/glm-key.ts`: `GLM_SECRET_NAME = "glm"`, `getGlmApiKey(boxRoot,
  {purpose})` mirroring `core/gemini-key.ts`, access `"server"`.
- Pure function `glmEnvAdditions(key: string): Record<string, string>` in the
  same module: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `API_TIMEOUT_MS=3000000`. Constants shared with nothing else; this module is
  the only place Z.ai's endpoint literal lives in `beebox/src`.
- Injection: `run.ts` setup env gains `...(glmProvider(model) && key ?
  glmEnvAdditions(key) : {})`; `core/chat/session/start.ts` `buildBackendStartOptions`
  does the same where it already builds env with additions. A refusal to
  resolve (missing/ungranted key) throws the existing typed refusal rendered
  with an actionable message: run `bbx secrets set glm` and `bbx secrets grant
  <box> glm`.
- Preflight: `checkGlmAuth(boxRoot, {observe})` — key presence via
  `resolveSecret({..., observe: false})`, optionally validated by a
  quota-endpoint ping (probe-registry precedent; the ping is Track 5 and the
  preflight ships with presence-only, which `resolveSecret` already answers).
  `preflightChatBackend` gains a model-aware branch: a claude-engine turn on a
  glm model checks GLM key, not `claude auth status` — which we proved this
  week reports logged-in from token presence alone
  (`issues/bugs/2026-09-15-scan-vision-integration-fails-when-not-logged-in.md`).

**First chunk:** glm-key module + injection in `run.ts` + a doctest on
`glmEnvAdditions` and the refusal messages. Chat injection follows in the
second chunk with the preflight.

### Track 4 — Unavailability classification

**What:** Z.ai quota/rate-limit failures are recognized and worded.

**Why:** today only Codex and first-party-Claude limit messages match
`core/agent/engine-unavailability.ts`; an unrecognized limit takes the ordinary
failure path (batch retry), which reads as flakiness.

**Direction:** add the Z.ai patterns recorded by Track 1 to the classifier and
`PROVIDER_NAMES` ("Z.ai (GLM)"). The availability *store* (`engine-availability-store.ts`,
keyed `{codex?, claude?}`) is NOT extended — see Open questions.

**First chunk:** classifier patterns + doctest, one chunk.

### Track 5 — Setup and docs

**What:** the boxholder can set this up from the admin surface and understand
the posture.

**Why:** the key has no OAuth flow; the store is the setup UX (secret-custody
Track 2 calls the admin Secrets section "the boxholder's management surface").

**Direction:** docs pass on `docs/model-policy.md` (a GLM section: what it is,
the data-posture warning verbatim-ish, setup = `bbx secrets set glm` + `bbx
secrets grant <box> glm` + `agentModel`/chat picker selection); a
probe-registry entry validating the key against the quota endpoint (reusing
`quota-glm-request.ts`'s endpoint/header knowledge, server-side); one line in
the admin Secrets section docs. No new admin UI component.

**First chunk:** docs + probe entry, one chunk.

## Could this be simpler?

Simplest shippable version: Tracks 2+3 only, with GLM as pinned-ids-only (no
tier integration, no procedure provider column, menus aside). What the fuller
plan buys, per the model-policy contract: tier resolution exists so a policy
survives engine and provider switches instead of silently changing spend —
without the provider column, `model: strong` on a GLM box resolves to
first-party Opus, which is the exact silent-wrong-provider outcome the policy
was built against (boxholder, 2026-09-14: unpinned boxes must have a default
they can name). Track 4 is the one track that could drop without breaking
anything (unrecognized limits already take the ordinary failure path); it
stays because retrying an exhausted quota as if it were flakiness is the
"silently wrong" class the plan exists to avoid. Nothing else in the plan is
machinery without a caller.

## Subplans

none — the spike is a track with a recorded deliverable, not a design step.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| glm model selected, key missing/ungranted | new doctest (refusal messages) | typed refusal → run refuses pre-spawn | clear |
| Key invalid/rotated (401 mid-run) | no (needs live key) | Z.ai 401 surfaces as run error; next preflight presence-check still passes | clear (error text names auth) but not classified — accepted, noted in docs |
| Z.ai quota exhausted mid-run | doctest on classifier patterns (Track 1 strings) | classifier words it as provider-limit; no auto-wait (store not extended) | clear |
| `total_cost_usd` is 0/wrong for GLM | spike records | `maxBudgetUsd` never trips; spend visible on Z.ai's quota endpoint | silent per-run, documented — accepted |
| Box on codex engine pins a glm id | doctest (tier degradation) | `resolveBoxModelForEngine` degrades to terra by tier | clear (existing warning) |
| Prompt caching absent on Z.ai | spike records | none — latency/cost regression | silent, documented — accepted |
| Dev key pasted into a prod box store by mistake | no | secret store has no env-scoping; `owningBox`/`shareable` fields exist but unused here | silent — accepted; docs name it |

> **Critical gap:** none unresolved — the two accepted-silent rows (cost
> accounting, caching) are Z.ai-side facts the spike records, not codepaths
> this plan can handle.

## Agent-flow / user-flow edge cases

- **Wrong field** — procedure card says `model: strong` on a GLM box: ADDRESSED
  (Track 2 provider-aware resolution).
- **Hand-edit drift** — boxholder writes `agentModel: "glm-4"` (typo):
  ADDRESSED (`readConfiguredModel` rejects unknown ids with a named warning,
  `core/box/config.ts:206-220`).
- **Two agents touching the same card**: unaffected — no new shared state.
- **Fabricated free-form value**: N/A — no agent-authored input in this plan.
- **Validation error UX**: ADDRESSED — refusal messages name the two store
  commands verbatim.
- **Partial migration / transition state**: ADDRESSED — there is no migration;
  existing boxes are untouched (no glm id anywhere unless the boxholder opts
  in). A box mid-edit (config names glm, grant not yet created) gets the clear
  refusal above.

## NOT in scope

- A third `AGENT_ENGINES` member — GLM rides claude; the dev side
  (`bin/lib/glm-provider.sh:2-14`) already committed to that framing.
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
- Chat menus gated by key presence — menus are static shared tables
  (`shared/chat-models.ts`); selecting GLM without a key fails with the
  actionable refusal instead. Keying UI to per-box secret state is machinery
  for a one-boxholder product.

## Open design questions

- **Availability-store extension** (`engine-availability-store.ts` is keyed
  `{codex?, claude?}`): extending it to providers would let the scheduler
  wait out a Z.ai quota window instead of failing runs. Lean: defer until a
  real box runs GLM and the failure cadence is known; the classifier already
  makes failures legible.
- **Whether the child also needs `ANTHROPIC_DEFAULT_*_MODEL` overrides** or
  SDK `options.model: "glm-5.3"` reaches the wire verbatim. Lean: options.model
  suffices (the dev shim needed tier overrides only because it never passes
  `--model`); Track 1 confirms on the wire.
- **Chat menu labels** for GLM ("GLM 5.3"? a friendlier name?). Lean: follow
  whatever naming the Z.ai dashboard uses; decided in Track 2's second chunk,
  not blocking.

## Knowledge audits

skip-with-rationale: no agent-facing concept is added. Model choice is an
owner-config surface; agents see only a resolved model id they already treat
as opaque, and procedure tiers behave identically.

## What will hold this after it ships

- Doctests reach the risky decisions, which are all extracted as pure
  functions: `glmProvider`/tier resolution (track 2), `glmEnvAdditions` and
  refusal wording (track 3), classifier patterns (track 4). One new doctest
  file per cluster under `beebox/test/`, following
  `agent-doctest/docs/syntax.md`.
- No new mock tier and no mock written by this plan encodes a provider
  behavior: Z.ai's wire behavior is anchored by the spike's recorded findings
  in the pluggability issue, not by a fixture pretending to be Z.ai.
- A real end-to-end call needs a live key and cannot run in ordinary tiers
  (the scan-vision lesson: suite isolation strips the auth). Verification on
  a real box is a manual step the boxholder runs once at setup; it is not a
  doctest.

## Implementation order

1. Track 1 spike; findings recorded in the pluggability issue. **Gate: no
   Track 2 chunk before (f) the flash model id is confirmed.**
2. Track 2 first chunk (ids, tiers, predicate, config admission + doctest).
3. Track 2 second chunk (procedure provider column + chat menus).
4. Track 3 first chunk (glm-key + run.ts injection + doctest).
5. Track 3 second chunk (chat injection + preflight branch).
6. Track 4 (classifier + doctest).
7. Track 5 (docs + probe entry).

The plan ships as one piece when all chunks land; per-box activation
(config + grant) is the boxholder's, box by box.

## Rollout shape

Tests are designed with the tracks (named above per chunk) and land with them.
Done-when: the new doctests pass; `pnpm --dir beebox typecheck` clean;
change-selected lint clean; the pluggability issue's `## Research (incomplete)`
section is filled with spike findings; and one manual real-box run on a GLM
model completes a reactor job (boxholder-run, recorded in the issue). No data
migration exists or is needed.
