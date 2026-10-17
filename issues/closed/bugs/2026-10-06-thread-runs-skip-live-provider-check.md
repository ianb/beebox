---
title: "Thread runs on OpenRouter or GLM models skip the per-turn provider re-check"
workstream: unattached
area: beebox
labels: [providers, security]
filed-by: agent
discovered-by: agent
discovered-in: worktree-third-party-engine-privacy — cross-model review of the third-party egress row
resolution: wontfix
---

**Closed 2026-10-17 (wontfix, moot):** thread sessions no longer exist. `beebox/src/core/chat/session/thread.ts` was deleted with the Telegram removal (`da6d70df9`), and no thread-session path remains in `beebox/src`. Chat turns re-check the provider through `liveProviderRefusal` in `beebox/src/core/chat/session/run/start-refusal.ts`. The security report's third-party models row no longer mentions threads.

A running chat re-checks its third-party provider before each turn
(`liveProviderRefusal` in `beebox/src/core/chat/session/run/core.ts`), so a
model the owner removes in admin, or a revoked `openrouter`/`glm` grant,
stops at the next turn. Thread sessions (`beebox/src/core/chat/session/thread.ts`)
check only when they spawn a run. A thread whose run is already live keeps
sending to OpenRouter or Z.ai, and keeps billing, until the run parks or
restarts.

The likely fix is the same `liveProviderRefusal` call before a thread send,
with the thread's existing error path. The security report states the
current behavior (`beebox/docs/security-report.md`, third-party models row).
