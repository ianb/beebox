---
title: "Chat on OpenRouter or GLM models: turn off Claude Code telemetry, and give the security report an honest row for it"
workstream: unattached
area: beebox
labels: [security, providers]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder asked what privacy a Claude Code run on an OpenRouter model has
---

The claude engine can run third-party models: OpenRouter models the owner
added (`beebox/src/core/provider-env/openrouter-chat.ts`) and GLM through Z.ai
(`beebox/src/core/glm-key.ts`). Both point Claude Code at another endpoint
with `ANTHROPIC_BASE_URL`. Two problems.

## 1. Claude Code's own telemetry still goes to Anthropic

Claude Code can send usage telemetry and error reports to Anthropic
independently of the model endpoint. The box passes `DISABLE_TELEMETRY` and
`DISABLE_ERROR_REPORTING` through when the parent environment has them
(`beebox/src/core/script-env/allowlist.ts:85-86`,
`beebox/src/hub/supervisor/child-env.ts:88-89`) but never sets them. The
boxholder's decision (2026-10-06): **set `DISABLE_TELEMETRY=1` and
`DISABLE_ERROR_REPORTING=1` on every run that uses a non-Claude model**
(OpenRouter, GLM, and any later third-party provider), in the same env
additions that set the base URL (`openRouterChatEnv`, the GLM env block).
Also check whether `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` should be set
for those runs, and whether Claude Code already suppresses any of this for a
custom base URL. Test that the child env carries the flags for third-party
runs and not for first-party ones.

## 2. The security report conflates OpenRouter's two uses

`beebox/docs/security-report.md:316` has one "OpenRouter" egress row. It
describes the optional services (embeddings, transcription, scan vision, TTS)
and rates them "ok — requests pin `data_collection: \"deny\"`" and the
upstream provider. It has no row for chat and agent turns on OpenRouter or
GLM models, which are the largest flow: Claude Code sends the full context
(system prompt, conversation, every tool result, including card text, files
read, and connector content). None of the pins apply to it, because Claude
Code builds the requests (`openrouter-chat.ts` header;
`beebox/docs/model-policy.md:175-177`). Host choice, training, and retention
follow the OpenRouter account's privacy settings, and the host varies per
request.

Fix:

- Add an egress row for third-party models on the claude engine (OpenRouter
  and GLM): what is sent, who receives it, the controls (owner adds each
  model; account privacy settings; telemetry flags from part 1), and the
  residual risk. Update `beebox/docs/security-overview.md` to match.
- Narrow row 316 to the optional services.
- In Admin → OpenRouter models
  (`beebox/src/frontend/src/components/admin/OpenRouterModelsSection/view.tsx`),
  link to the OpenRouter account's privacy settings and recommend allowing
  only hosts with no training and zero data retention, so the owner sees it
  before adding a model.
- Consider whether `beebox/src/core/secrets/uses.ts:78-86` should separate the
  chat use from the cents-a-call services.

Use the security-report skill for the report changes.
