---
title: "Explicit-config Anthropic API key as an alternative to subscription auth"
workstream: open-source-readiness
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
priority: normal
---

Today only Claude subscription auth works: the ambient `ANTHROPIC_API_KEY`
is deliberately force-stripped (`src/cli/bootstrap.ts`,
`src/core/script-env.ts` — bill-safety, keep this) and there is no way to
supply a key at all. For the soft launch that's acceptable — the audience
is assumed to have a subscription
([soft-launch posture](../decisions/2026-07-20-soft-launch-posture.md)) —
but the boxholder wants this as an easy early follow ("you're right about
the API key feature, which should be easy", 2026-07-20).

The design is already fully worked out in
[the source-available release plan, Track F piece 1](../../callback-box/docs/plans/source-available-release.md):
keep scrubbing the ambient env var from the SDK child; inject a
*deliberately configured* key only via the SDK's explicit credential path
(constructor `apiKey` / `apiKeyHelper` temp file — never by setting the env
var, which the SDK ambient-grabs); ship with a test proving an ambient key
never reaches the SDK while a configured one does. This item exists so the
work is visible in the queue rather than only inside the plan doc.

Distinct from [provider-endpoint-config](2026-07-18-provider-endpoint-config.md)
(non-Anthropic providers/endpoints — a much bigger question); this is
Anthropic-only, auth-mechanism-only.
