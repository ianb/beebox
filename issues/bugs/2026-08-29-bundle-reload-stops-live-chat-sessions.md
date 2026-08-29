---
title: "Development bundle reload stops live chat sessions instead of draining them to idle"
workstream: unattached
area: callback-box
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

Related incident: [coined chat still runs on box default engine](../closed/bugs/2026-08-29-coined-chat-still-runs-on-box-default-engine.md).
