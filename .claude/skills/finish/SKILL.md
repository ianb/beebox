---
name: finish
description: Use when the human says they're done with a worktree and wants its work landed in main — either a final close-out or a mid-stream checkpoint with the session continuing. Triggers include "finish", "wrap this up", "ship it", "merge this back", "checkpoint this", "/finish".
---

# /finish

Land the worktree's work in `main` — but run the actual work in a **subagent** so
the git / test / merge churn stays out of this chat thread. This conversation
only dispatches and relays the result. **Only invoke when the human asks for it.**

## What to do

1. **Work out the mode** from the conversation:
   - **Close-out** — the work is done; after the merge the human exits and the
     worktree auto-cleans (SessionEnd hook).
   - **Checkpoint** — land what's done so far; the session keeps going.

   If it's genuinely unclear which, ask the human one short question before
   dispatching (this is the one place asking is cheap — the subagent can't).

2. **Dispatch the `finish` subagent** (subagent_type `finish`, via your
   subagent-launch tool). It runs the whole merge procedure headless on Sonnet
   and lives in `.claude/agents/finish.md` — including a diff-scoped review pass
   (Track O) over the changed lines for the patterns lint can't yet catch (its
   findings come back in the report). Because it can't ask questions
   mid-run, give it everything it needs up front in the prompt:
   - the **mode** (close-out vs checkpoint);
   - any **`cb feedback` item** this work resolves — its file basename and the
     source box;
   - whether any **uncommitted changes** in the worktree are intentional;
   - anything unusual about **scope or verification** its final report should be
     honest about (e.g. "tests pass but I never exercised it in the app").

3. **Relay its result** to the human — don't re-run its steps here:
   - **`RESULT: MERGED`** → pass along its report (hash, test counts, mode,
     scope/verification honesty, any deferred cleanup like an unresolved feedback
     item). For a close-out, remind them the worktree + box auto-clean on exit.
   - **`RESULT: BLOCKED`** → it hit something needing a human call (on `main`, a
     merge conflict, a test failure, ambiguous uncommitted files, missing info,
     an unclear feedback item). Surface exactly what it reported, resolve it with
     the human here, then **re-dispatch** the subagent (or, if faster and the
     human agrees, finish the remaining step yourself). Nothing merged if it
     blocked before the merge step — say so.

**Do not execute the merge/test steps yourself in this thread.** That's the
subagent's job; doing it here defeats the point (keeping this thread clean). Your
job is: pick the mode, hand off, relay.
