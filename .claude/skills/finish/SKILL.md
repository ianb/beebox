---
name: finish
description: Use when the human says they're done with a worktree and wants its work landed in main — whether that's a final wrap-up or a mid-stream checkpoint, the flow is identical. Triggers include "finish", "wrap this up", "ship it", "merge this back", "checkpoint this", "/finish".
---

# /finish

Land the worktree's work in `main` — but run the actual work in a **subagent** so
the git / test / merge churn stays out of this chat thread. This conversation
only dispatches and relays the result. **Only invoke when the human asks for it.**

## What to do

1. **Dispatch the `finish` subagent** (subagent_type `finish`, via your
   subagent-launch tool). It runs the whole merge procedure headless on Sonnet
   and lives in `.claude/agents/finish.md` — including a diff-scoped review pass
   (Track O) over the changed lines for the patterns lint can't yet catch (its
   findings come back in the report). Because it can't ask questions
   mid-run, give it everything it needs up front in the prompt:
   - any **`issues/` item** this work resolves (or partly resolves) — it closes
     what's done and leaves punch-lists open, but it can only judge issues it
     knows about;
   - whether any **uncommitted changes** in the worktree are intentional;
   - anything unusual about **scope or verification** its final report should be
     honest about (e.g. "tests pass but I never exercised it in the app").

   If the worktree has a `private-issues/` mount, the subagent lands that
   repo's branch too (its step 1b detects this itself); relay its `PRIVATE:`
   line to the human verbatim — especially a MERGE/PUSH FAILED one.

   Don't ask "close-out vs checkpoint" — it changed nothing the flow does. The
   subagent's work is identical either way, and cleanup is the SessionEnd hook's
   job: it fires on ANY worktree exit once the branch is merged + clean,
   regardless of intent. So just land the work; the human decides whether to exit
   (clean up) or keep going (keep the worktree) on their own.

2. **Relay its result** to the human — don't re-run its steps here:
   - **`RESULT: MERGED`** → pass along its report (hash, test counts,
     scope/verification honesty, any deferred cleanup). Remind them the worktree + box auto-clean on exit now that it's merged
     — so exit to clean up, or keep the session going to keep the worktree.
     - If the report carries a **`NEW ISSUES:`** block (issues the finish filed —
       a flake, a spun-out scope gap, a Track O finding), surface it **prominently
       at the end**, each as its `issues/…` path + title. The human often wants to
       continue the session by fixing exactly these, so make them easy to act on —
       don't fold them into the prose.
   - **`RESULT: BLOCKED`** → it hit something needing a human call (on `main`, a
     merge conflict, a test failure, ambiguous uncommitted files, missing info). Surface exactly what it reported, resolve it with
     the human here, then **re-dispatch** the subagent (or, if faster and the
     human agrees, finish the remaining step yourself). Nothing merged if it
     blocked before the merge step — say so.

**Do not execute the merge/test steps yourself in this thread.** That's the
subagent's job; doing it here defeats the point (keeping this thread clean). Your
job is: pick the mode, hand off, relay.
