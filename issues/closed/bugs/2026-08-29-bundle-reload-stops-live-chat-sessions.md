---
title: "Development bundle reload stops live chat sessions instead of draining them to idle"
workstream: coined-engine-authority
resolution: implemented
area: beebox
labels: [chat, deploy]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-coined-engine-authority — investigating a lost coined chat
---

When a box child notices a rebuilt development bundle, it logs
`Development bundle changed; draining before reload…`, but registry shutdown
then stops every live chat session. On 2026-08-29 this killed an in-progress
boxholder chat at 11:06 UTC, after its turn had completed but while the native
session was still live.

The word "draining" promises a lifecycle boundary the implementation does not
currently honor. A reload should wait for chat sessions to become idle, or
transfer ownership to the replacement child, rather than stopping live
sessions as part of ordinary development deploy churn. Investigate the box
child reload path and define how long a genuinely busy turn may defer reload,
how idle persistent runs are retired, and what happens when a drain deadline is
reached.

Related incident: [coined chat still runs on box default engine](2026-08-29-coined-chat-still-runs-on-box-default-engine.md).

## Resolution

The existing reload gate already waits for active turns, async preparation,
schedules, mutations, and background delivery to become idle. The remaining
gap was the final close boundary: the Fastify `onClose` hook called synchronous
`registry.shutdown()`, which started each SDK run's graceful `close()` and
returned immediately. Server shutdown could therefore reach `process.exit(75)`
while those subprocesses were still closing.

Registry shutdown is now awaitable and bounded. It attaches each run's close
listener before stopping it, waits up to ten seconds of awake time for live
sessions to emit close, reports any session IDs that miss the grace, and only
then allows the server hook and supervised reload exit to complete. The
registry maps are cleared before that wait, so shutdown cannot expose stale
entries during the async boundary. Regression coverage uses a deliberately
delayed close to prove shutdown does not resolve early, plus a stuck close to
prove the deadline releases the child and names what it left behind.
