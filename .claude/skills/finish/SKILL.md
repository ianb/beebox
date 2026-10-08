---
name: finish
description: Land a worktree's changes in main when the human asks to finish, ship, merge, or wrap up the work.
---

# /finish

Land the worktree's work in `main` — but run the actual work in a **subagent** so
the git / test / merge churn stays out of this chat thread. This conversation
only dispatches and relays the result. **Only invoke when the human asks for it.**
That ask is consent to merge and deploy; run the flow through the merge. Small
follow-ups in the same workstream (closing its issue, a doc fix) land without a
fresh ask, and a docs-only workstream may land each verified change.

## What to do

1. **Dispatch the `finish` subagent** (subagent_type `finish`, via your
   subagent-launch tool). It runs the whole merge procedure headless on a
   pinned mid-tier model: Sonnet in Claude Code, `gpt-6-luna` in Codex. Do not
   run it on the session's own model. It lives in `.claude/agents/finish.md`
   (Codex gets a generated `.codex/agents/finish.toml`): `bin/finish-preflight` merges main and
   prints a decision sheet; the agent runs missing verification and Track O review.
   Passing checks remain valid unless later changes plausibly affect them: a new
   main commit alone is not a reason to retest. Give the agent:
   - any **`issues/` item** this work resolves (or partly resolves) — it closes
     what's done and leaves punch-lists open, but it can only judge issues it
     knows about;
   - whether **uncommitted changes** are intentional;
   - completed checks, their tested revision, and any later changes;
   - anything unusual about **scope or verification** its final report should be
     honest about (e.g. "tests pass but I never exercised it in the app").

   If the worktree has a `private-issues/` mount, the subagent lands that
   repo's branch too (its preflight detects this). Treat its `PRIVATE:`
   line as an internal status contract: surface actual private changes and any
   merge/push failure, but omit routine `PRIVATE: no changes` bookkeeping from
   the human-facing handoff.

   Land without asking "close-out vs checkpoint". The human decides when to exit;
   SessionEnd owns cleanup once the branch is merged and clean.

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
       prose. A named flake is not an issue; `beebox/test/careful.txt` is
       that channel.
   - **`RESULT: BLOCKED`** → it hit something needing a human call (on `main`, a
     merge conflict, a real test failure, ambiguous uncommitted files, missing
     info). Surface exactly what it reported, resolve it with the human here, then
     **re-dispatch** the subagent (or, if faster and the human agrees, finish the
     remaining step yourself). Nothing merged if it blocked before the merge step.

**Do not execute the merge/test steps yourself in this thread.** That's the
subagent's job; doing it here defeats the point (keeping this thread clean). Your
job is: hand off, adjudicate the report, and relay only what matters.
