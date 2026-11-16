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

1. **Add a what's-new line if a person using the box would notice the work.**
   Top of `beebox/docs/box/whats-new.md`, committed with the work:
   `- YYYY-MM-DD **New|Changed|Agent**: <≤30 words>`. Write for someone who
   uses the box for anything and knows none of its internals or our examples:
   what they can now do or will see, in their words, and how to get it.
   **New**: a thing to see, use, or ask for. **Changed**: works differently.
   **Agent**: seen only in what the agent does. Most finishes add nothing: skip
   internal work, restoring fixes, dev tooling, agent internals, iOS, Chrome.

2. **Dispatch the `finish` subagent** (subagent_type `finish`, via your
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
   - completed checks and the commit they passed at (its `--tested` revision);
   - anything unusual about **scope or verification** its final report should be
     honest about (e.g. "tests pass but I never exercised it in the app").

   With a `private-issues/` mount, the subagent lands that repo's branch too.
   Surface its `PRIVATE:` line only for actual changes or a merge/push failure.

   Land without asking "close-out vs checkpoint"; SessionEnd owns cleanup.

3. **Relay its result** to the human — don't re-run its steps here:
   - **`RESULT: MERGED`** → give a concise human-facing handoff: what landed,
     the hash, meaningful verification, and anything still open. Do not dump
     the subagent's status template or enumerate routine negatives.
     For UI work, relay the finish report's single labeled exhibit URL, not
     raw screenshot paths.
     Treat a merge as a **checkpoint by default**; do not end every finish
     with an instruction to exit or close the workstream.
     - Suggest closing only when planned scope is complete, no issue or manual
       check remains open, and the user's language indicates wrap-up.
     - If work remains, end with that continuation point; otherwise stop.
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
