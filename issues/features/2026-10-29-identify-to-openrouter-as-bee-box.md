---
title: "OpenRouter requests do not identify Bee Box as the calling app"
workstream: unattached
area: beebox
labels: [openrouter, provider]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-pi-engine — pi engine discussion
---

OpenRouter attributes each request to an app through the `HTTP-Referer` and
`X-Title` headers. Bee Box sends neither, so its usage does not appear under
its own name in OpenRouter's app rankings or in the boxholder's activity view.

Three request paths are affected, and each sets headers differently:

- The optional services in `beebox/src/core/openrouter.ts` call OpenRouter
  directly. They can add the headers.
- Claude-engine chat on OpenRouter models
  (`beebox/src/core/provider-env/openrouter-chat.ts`) goes through Claude
  Code, which sends its own headers. The child environment may not reach them.
- The planned pi engine
  ([pi third engine](../closed/features/2026-10-18-pi-third-engine.md)) sends pi's attribution
  headers. pi 1.4.0 moved them into pi-ai's client identity; an extension
  `before_provider_headers` handler can remove them but no longer sees them.

The boxholder wants Bee Box to be the identified app. It is out of scope for
the pi engine workstream.

## Research

Probed 2026-10-29 on pi 1.4.0: pi sends `HTTP-Referer: https://pi.dev`,
`X-OpenRouter-Title: pi` and `X-OpenRouter-Categories: cli-agent`. A
`providers.openrouter.headers` entry in pi's `agentDir/models.json` replaced
the first two on the wire. `PI_TELEMETRY=0` removes all three.
