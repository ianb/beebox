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
   and lives in `.claude/agents/finish.md`: `bin/finish-preflight` merges main and
   prints a decision sheet, `bin/finish-verify` runs the tests/typecheck/lint that
   sheet names (no full suite — `schedules/full-suite` covers `main` hourly), and the
   agent does the judgment steps, including a diff-scoped review (Track O) for what
   lint can't yet catch. It can't ask questions mid-run, so give it everything up
   front:
   - any **`issues/` item** this work resolves (or partly resolves) — it closes
     what's done and leaves punch-lists open, but it can only judge issues it
     knows about;
   - whether any **uncommitted changes** in the worktree are intentional;
   - anything unusual about **scope or verification** its final report should be
     honest about (e.g. "tests pass but I never exercised it in the app").

   If the worktree has a `private-issues/` mount, the subagent lands that
   repo's branch too (its preflight detects this). Treat its `PRIVATE:`
   line as an internal status contract: surface actual private changes and any
   merge/push failure, but omit routine `PRIVATE: no changes` bookkeeping from
   the human-facing handoff.

   Don't ask "close-out vs checkpoint" — it changes nothing the flow does, and
   cleanup is the SessionEnd hook's job: it fires on ANY worktree exit once the
   branch is merged + clean. Just land the work; the human decides whether to exit
   (clean up) or keep going on their own.

2. **Relay its result** to the human — don't re-run its steps here:
   - **`RESULT: MERGED`** → give a concise human-facing handoff: what landed,
     the hash, meaningful verification, and anything still open. Do not dump
     the subagent's status template or enumerate routine negatives.
     When UI verification produced multiple screenshots, relay the single
     labeled exhibit URL from the finish report—not raw screenshot paths. The
     exhibit is the human-facing evidence; the individual files are working
     artifacts.
     Treat a merge as a **checkpoint by default**: the conversation and
     workstream may continue after landing. Do not end every finish with an
     instruction to exit, clean up, or close the workstream.
     - Suggest closing/exiting only when the evidence supports it: planned
       scope is complete, no relevant issue/manual check remains open, and the
       user's language indicates wrap-up rather than checkpointing. Phrase it
       as a recommendation, not a ritual sign-off.
     - If work remains, end with that useful continuation point. If nothing needs
       saying, stop after the landing result; do not manufacture a next step.
     - If the report carries a **`NEW ISSUES:`** block (issues this workstream
       filed — a spun-out scope gap, a Track O finding, anything found along the
       way), surface it **prominently at the end**, each as its `issues/…` path +
       title, and **offer to fix them in this session** — they are this
       workstream's own finds, and it is their default owner; there is no
       someone-else they fall to. Offer, don't start. Don't fold them into the
       prose. A named flake is not an issue; `callback-box/test/careful.txt` is
       that channel.
   - **`RESULT: BLOCKED`** → it hit something needing a human call (on `main`, a
     merge conflict, a real test failure, ambiguous uncommitted files, missing
     info). Surface exactly what it reported, resolve it with the human here, then
     **re-dispatch** the subagent (or, if faster and the human agrees, finish the
     remaining step yourself). Nothing merged if it blocked before the merge step.

**Do not execute the merge/test steps yourself in this thread.** That's the
subagent's job; doing it here defeats the point (keeping this thread clean). Your
job is: hand off, adjudicate the report, and relay only what matters.
