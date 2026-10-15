---
title: "Background agent runs (jobs, procedures, reviews) do not follow the box's OpenRouter default; they need the host's Claude subscription"
workstream: background-provider
area: beebox
labels: [providers]
filed-by: agent
discovered-by: Ian
discovered-in: main session — 2026-10-15
---

## What the boxholder reported

The boxholder (2026-10-15): "while I can use a openrouter default service for
the foreground, the background tasks seem to suppress that ability." A chat
on the box runs on an OpenRouter model (a DeepSeek model). Jobs, procedures,
and reviews do not.

The box's own chat agent, running on that OpenRouter model, explained it
this way. This is the agent's claim, not verified here:

> Background agent runs authenticate differently than chats. This chat rides
> the OpenRouter env (ANTHROPIC_BASE_URL + auth token, deepseek models) —
> that's why I'm a deepseek right now. Jobs, procedures and reviews can't:
> beebox's spawn allowlist deliberately strips ANTHROPIC_API_KEY and the
> provider vars so agents fall back to the subscription OAuth out of the
> macOS Keychain. So every background run depends on one credential that
> nothing in the box maintains.

## First look (not a diagnosis)

The claim is partly at odds with the code, so the cause is open:

- `beebox/src/core/agent/invoke/run.ts:235` says `ANTHROPIC_API_KEY` is
  stripped by `buildScriptEnv` to force subscription auth.
- The same function then calls `providerEnvAdditions({ boxRoot, model,
  purpose: "agent-run", env })` (`run.ts:244`), and the preflight at `:278`
  is provider-aware. So a background run whose model is an OpenRouter model
  appears to get the provider env.
- A likely gap is model choice: background runs may name a Claude model
  explicitly (the small model, a fixed review model), or read a setting other
  than the one the chat default uses. Then no OpenRouter env is added, and the
  run needs the host's Claude login.

## Expected

When the boxholder makes an OpenRouter model the default, background work
follows it, or the box says clearly which background runs still need a
Claude login and why. A box with no working Claude subscription should not
have background work fail silently.

## Questions

- Which background run paths (jobs, procedures, reviews, wakeups, titles,
  routing) choose their model where, and which of them can run on a
  third-party model at all (tool use, structured output).
- Whether a per-purpose setting is needed (for example "background model"),
  or the chat default applies everywhere.
- Privacy: moving background work to OpenRouter sends more box content
  there. [Show privacy implications](../features/2026-10-14-show-privacy-implications-of-this-box-setup.md)
  should list it.

## Related

- [Provider-endpoint config](../features/2026-07-18-provider-endpoint-config.md).
- [Explicit API key config](../features/2026-07-20-explicit-api-key-config.md).
- [Thread runs skip the live provider check](2026-10-06-thread-runs-skip-live-provider-check.md).
- [OpenRouter chat models in admin (closed)](../closed/features/2026-09-19-openrouter-chat-models-added-in-admin.md).
