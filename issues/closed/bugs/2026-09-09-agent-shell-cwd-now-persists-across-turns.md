---
title: "Agent SDK 0.3.265 makes the agent's shell `cd` persist across turns, and the commit-nudge retry assumes it does not"
workstream: sdk-update
area: beebox
priority: normal
resolution: wontfix
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

## Disproven 2026-09-11 — closing, nothing to fix

The premise was tested once `0.3.266` could be installed, and it does not hold.
Probe: a scratch working directory `work/`, the agent told to `cd` into a
subdirectory `work/sub`, then asked for `pwd` — (A) in a **resumed session in a
new process**, which is how `ensureAgentCommitted` runs the nudge (a separate
`invoke()`, so a separate `query()`), and (B) as a **second user message in the
same process**, which is a warm chat run.

| SDK | A: resume, new process | B: same process |
|---|---|---|
| `0.3.263` | `work` (reset) | `work` (reset) |
| `0.3.266` | `work` (reset) | `work/sub` (persisted) |

So persistence is per process. The commit-nudge retry starts a fresh process at
`boxRoot` and is **not affected**. The "shell parked outside the box" case is not
reachable on either version either: an earlier run of the same probe that
`cd`'d *outside* the working directory came back reset every time, because
Claude Code resets a shell that leaves the working directory.

What the release does change is a warm multi-message run, where a `cd` into a box
subdirectory now survives to the next user message. That is benign here: chat
links resolve from the box root by the chat prompt's own rule, `bbx` finds the box
root by walking up, and `git` operates repo-wide from a subdirectory. The model
also sees its own earlier `cd` in context.

`wontfix` because there is nothing to fix. This issue gated the `0.3.265`/`0.3.266`
bump; that gate is lifted, and the pin moved to `0.3.266` on 2026-09-11.
