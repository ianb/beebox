---
title: "Let the boxholder add OpenRouter chat models in admin, explicitly, never by default"
workstream: unattached
area: beebox
labels: [models, admin]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder asking whether Claude Code and boxes can run other models through OpenRouter
---

OpenRouter serves an Anthropic-compatible endpoint (its "Anthropic skin"), so a
box's chat and agent runs could use any model it carries — DeepSeek and others
— through the same path GLM already uses. The boxholder wants that possible,
with one hard condition: **an OpenRouter model must be added deliberately in
admin. It must never run pay-as-you-go because a key happens to exist.**

Their words: "they would require setup in admin. The admin would have to
explicitly add a model… Since it's not a subscription I don't want it to run
pay as you go without that setup."

## Why this cuts against the existing OpenRouter shape

`beebox/src/core/openrouter.ts` states the current product shape outright:
"one secret and no configuration: grant a box an `openrouter` key and the
services that can run through OpenRouter simply do. There is no base-URL
setting, and no per-service provider field." That is right for the optional
services it covers, which cost cents
([consolidation issue](../closed/exploration/2026-08-31-openrouter-optional-services-consolidation.md)),
and the secret guide already says usage is pay-as-you-go
(`core/secrets/guide-registry.ts:59`).

Chat and agent runs are a different order of spend. So this feature is a
deliberate exception to that shape, and the code comment should say so rather
than leaving the next reader to wonder which rule won.

## The precedent to copy

GLM already rides the claude engine through an Anthropic-compatible endpoint:

- `beebox/src/shared/model-ids.ts` carries `glm` / `glmFlash` ids.
- `shared/chat-models.ts:20-30` lists them in the picker with a comment saying
  a box without a granted key fails the turn with a setup refusal.
- `core/glm-key.ts` resolves the key from the machine secret store at `server`
  access, so nothing agent-authored can grant itself access.
- `core/agent/run.ts:211` branches on `providerOf(model) === "glm"` and adds
  the provider env; `docs/plans/box-glm-provider.md` is the design.

The difference: GLM's model list is fixed in our source. OpenRouter's is not,
and that is the substance of this issue.

## What to work out

1. **Where the list lives.** A boxholder-added model is per-box configuration,
   not a constant in `shared/model-ids.ts`. `MODEL_ID` is deliberately
   dependency-free and bundled into the frontend, so a dynamic list needs
   another home and a shape the picker can render.
2. **Which models are worth offering.** The boxholder: "I'm not sure if
   there's a list of openrouter models that support Claude code reasonably, if
   not we'll just add a couple known ones." Check whether OpenRouter publishes
   a capability signal (tool use, prompt caching, context length) that predicts
   "works in an agent loop". If it does not, ship two or three known-good
   entries and let the boxholder type an id for anything else — with the
   understanding that an untested model may simply fail the turn.
3. **What the admin surface asks for.** At minimum a model id and a label. The
   boxholder lives in the web UI, not the CLI, so this belongs beside the
   existing model and engine controls in `components/admin/`, not behind a
   `bbx` command.
4. **Spend visibility.** "Not a subscription" is the whole reason for the
   gate. Whether the box shows what an added model has cost, or just that it
   is billed per use, is a decision — but the admin copy must not imply a flat
   rate.
5. **Failure when the key is missing or the model is wrong.** GLM's setup
   refusal is the precedent: fail the turn with a message naming the fix,
   rather than falling back to a subscription model and quietly changing who
   answered.

## Not in scope

Routing the existing optional services (embeddings, transcription) differently
— that is settled in `core/openrouter.ts` and should stay settled. This is
about chat and agent models only.

Also worth knowing, not a blocker: `ANTHROPIC_BASE_URL` is a single slot, and
the prompt logger claims it too (`core/agent/run.ts:208` already warns for
GLM), so prompt logging and a third-party provider cannot both be on in one
run.
