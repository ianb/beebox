---
title: "Agent SDK 0.3.265 makes the agent's shell `cd` persist across turns, and the commit-nudge retry assumes it does not"
workstream: sdk-update
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Agent SDK 0.3.265
labels: [sdk-update]
---

Agent SDK `0.3.265` / Claude Code `2.1.265`:

> *"Fixed non-interactive sessions (`-p` with stream-json input, Agent SDK, cloud
> sessions) resetting the shell working directory at each new user message; a
> `cd` now persists across turns."*

Every beebox agent and chat thread is a multi-turn SDK session started with
`cwd: boxRoot` (`src/core/agent/run.ts`). Until now, each new user message put
the agent's shell back at the box root; from `0.3.265` on, a `cd` the agent made
in turn 1 is still in effect in turn 5.

**Where that lands here is the commit-nudge retry.**
`ensureAgentCommitted` (`src/core/agent/commit.ts`) checks the tree with
`getStatus(boxRoot)` — a child process given the box root explicitly — and then,
if work is uncommitted, **resumes the agent session** with `COMMIT_NUDGE_PROMPT`
so the agent commits through its own Bash shell. Those two halves no longer
agree about where they are:

- If the agent had `cd`'d into a subdirectory, a pathspec-scoped `git add` in the
  nudge turn stages only that subtree. `getStatus(boxRoot)` then still reports
  changes, the retry is judged a failure, and the fallback commit fires — noisier
  than the real state warrants, and the fallback commit is marked as one.
- If the agent had `cd`'d outside the box, its `git` runs against whatever
  repository contains that directory. The likely outcome is a failed command and
  the same fallback path; the bad outcome is box work committed somewhere else.

Neither is reachable today — the pin is `0.3.263`, and `0.3.265` had not settled
at the 2026-09-09 turn — which is the reason to fix it before the pin crosses,
rather than after.

**The fix is small and belongs in the prompt, not the plumbing.**
`COMMIT_NUDGE_PROMPT` should name the box root as an absolute path and tell the
agent to work from it, since the nudge is precisely the moment beebox needs the
agent to act on the whole box rather than wherever it happens to be standing.
Worth checking the same question for anything else that resumes a session to run
a command with implied scope.

**Not worth doing:** forcing a `cd` back to the box root at every turn to restore
the old behavior. Upstream changed this to match the interactive app, an agent
that navigates and stays put is the more useful default, and beebox's own chat
prompt already tells agents that links resolve from the box root "never from your
working directory" (`src/core/chat/session/prompts.ts:92`) — the assumption is
already documented as *not* holding.
