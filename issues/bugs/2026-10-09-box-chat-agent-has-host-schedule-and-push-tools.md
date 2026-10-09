---
title: "Box chat sessions list Claude Code's schedule and push tools (CronCreate, PushNotification, RemoteTrigger)"
workstream: unattached
area: beebox
labels: [security, privacy]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — C-reconnecting journey walks, 2026-10-09
---

A box chat session lists host Claude Code tools that act through the host's Claude account. The C-reconnecting walk's transcripts show them in `deferred_tools_delta`. This is the same class as [the closed connectors issue](../closed/bugs/2026-10-08-box-chat-agent-inherits-host-claude-account-connectors.md). That fix removed claude.ai connectors; it did not touch these built-in tools.

## Evidence

In the largest transcript of the C walk (the box agent's Claude transcript for the C walk box), the one `deferred_tools_delta` entry has `addedNames`: `CronCreate`, `CronDelete`, `CronList`, `DesignSync`, `EnterWorktree`, `ExitWorktree`, `Monitor`, `NotebookEdit`, `PushNotification`, `RemoteTrigger`, `SendMessage`, `TaskStop`, `WebFetch`, `WebSearch`. `ScheduleWakeup` is not in that list. Its definition appears in the same file's tool schemas, so it is available too.

Why these matter: `CronCreate` and `RemoteTrigger` create scheduled or cloud-run routines under the host account. `PushNotification` pushes to the account's devices. A box member's chat could cause those effects on the host owner's account.

## Not checked

- **No call to these tools was observed.** The finding is that the tools are available to the agent, not that it used them.
- Production past use was not checked. That needs the boxholder's approval.
- Whether a box agent can complete a call (the CLI may refuse in non-interactive mode) was not tested.

## Mechanism

`boxSessionSettings` (`beebox/src/core/agent/box-session-settings.ts:46-58`) sets the setting sources, `claudeMdExcludes` and `disableClaudeAiConnectors`. It restricts no built-in tools. The chat backend sets `queryOptions.tools` only when the caller supplies `opts.tools` (`beebox/src/services/claude-chat/core.ts:132-134`). The agent invoke path (`beebox/src/core/agent/invoke/run.ts`) sets none.

## Direction

Block or omit the host-account tools (disallow list, or an explicit tool allowlist) for every box session. Decide per tool: `WebFetch`, `WebSearch` and `Monitor` may be wanted. Check that box features that need scheduling use the box's own scheduler, not these tools.

Report: [C](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md).
