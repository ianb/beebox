---
name: finish
description: Use when the human wants the worktree's work merged back to main — either as a final close-out or as a mid-stream checkpoint with the session continuing. Drives the merge flow: commit any straggling changes, pull main into the worktree, run the test suite (ALL tests must pass — no exceptions), resolve any feedback item the work addressed, then merge the worktree branch into main. The close-out report must match the work's actual status (complete vs partial, verified vs tests-only) and only suggest exiting the session when the work is truly done. Triggers include "finish", "wrap this up", "ship it", "merge this back", "checkpoint this", "/finish".
allowed-tools: Bash, Read, Edit, Write
---

# /finish

Land the worktree's work in `main`. **Only invoke when the human asks for
it.** The human uses this in two modes, and you usually learn which from
context rather than being told:

- **Close-out** — the work is done; after the merge they'll exit the
  session and the worktree gets auto-cleaned.
- **Checkpoint** — they want what's done so far landed on main, then the
  session continues working. Everything below still applies (especially
  the test rule — a checkpoint is still a merge to main, which deploys),
  but the session does NOT end and your final report must not talk as if
  it does.

## Test failures are NEVER acceptable

The single most important rule in this skill (applies whenever the
worktree touched code — see "When tests don't apply" below for the
narrow exception):

> If `pnpm test` reports ANY failure — anywhere in the suite, in any file,
> for any reason — you do not proceed. You do not file the failure under
> "not my problem". You do not declare the session done. You investigate
> and fix the failing test, OR you escalate to the human and stop.

You may be tempted to think "those tests were failing before I started",
"that test is flaky", "that file is unrelated to my changes", or "the
test infrastructure is broken". Those are not exits from this rule.
Either the failure is yours to fix or it's a real bug that has to be
escalated — never silently shrugged off.

### When tests don't apply

Tests are contingent on code. If the worktree's diff is entirely
documentation, notes, ideas, or other non-code artifacts (`.md`,
`docs/`, `ideas.md`, comments-only changes, etc.), there's no
behavior to verify and step 4 below can be skipped. Run `pnpm
typecheck` and `pnpm lint` anyway in case a stray edit slipped into
a code file. If you're unsure whether a change qualifies as
documentation-only, run the tests — the bias is toward running them,
not skipping.

## The flow

Execute these steps in order. Stop and ask the human if anything goes
sideways (conflict, test failure, unexpected state).

### 1. Confirm worktree state

```bash
git status
git rev-parse --abbrev-ref HEAD
```

You should be on a branch like `worktree-<name>` inside
`~/src/callback-worktrees/<name>/`. If you're on `main` or in the main
checkout, stop and ask the human — this skill is for worktrees only.

### 2. Commit any straggling changes

If `git status` shows uncommitted changes, decide whether they belong
with this session's work or are accidental. If they're meant to ship:
stage them and commit with a clear message describing what's being
shipped (not "wip" or "final" — what it actually does). If they're
accidental, ask the human before discarding.

### 3. Pull main into the worktree branch

Bring the worktree branch up to date with main, so the merge back will
be clean:

```bash
git fetch origin main 2>/dev/null || true     # if there's a remote
git merge main
```

If `git merge main` produces conflicts: resolve them carefully (read
both sides, don't blindly pick one), test compile + lint, then `git add`
+ `git commit`. If you can't resolve a conflict confidently, **stop and
ask the human**.

### 4. Run the full test suite

From the worktree's `callback-box/` directory:

```bash
cd ~/src/callback-worktrees/<name>/callback-box
pnpm test
```

**Read the full output.** Look for:
- `# { total: N, pass: N }` with `total === pass` (count up to the four-digit numbers).
- Exit code 0.
- No `not ok` lines anywhere.

If `pnpm test` reports any failure, or exits non-zero, or you see
`not ok` lines: **STOP**. Re-read the "Test failures are NEVER
acceptable" section at the top of this file. Fix the failure (in the
worktree), or escalate to the human and stop the skill.

Also worth running:

```bash
pnpm typecheck
pnpm lint
```

These run in pre-commit anyway, but running them explicitly now means
the next step (merge) won't get blocked by pre-commit lint errors.

### 5. Reconcile planning docs with reality

If the worktree introduced or modified a planning document — a design
doc, RFC, "plan", "proposal", or anything written in the future tense
about work that has now actually happened — update it before the
merge:

- **If the plan is now implemented**, the doc shouldn't read like a
  plan anymore. Default action: **`git mv` it from `docs/plans/` to
  `docs/implemented-plans/`** (the convention — see
  `callback-box/docs/plans/README.md`), so it stays a findable frozen
  record without masquerading as current docs. Then either:
  - fold any durable "how it works now" parts into a present-tense
    reference doc under `docs/` (and leave the moved plan as the
    historical record), or
  - delete the plan instead of moving it if the content is now fully
    duplicated by the code, schemas, or reference docs.
  Apply this only when applicable — a plan that's a regular `docs/`
  reference doc, or one not under `docs/plans/`, may just need a rewrite.
- **If the plan is partially implemented**, edit the prose to mark
  which parts are now real (with a link to where they live) and which
  parts are still future. Don't leave a doc that says "we will
  introduce X" when X already exists.
- **Filenames matter.** A file named `plan-foo.md` whose content is
  now historical confuses future readers; a file named
  `foo-implementation.md` or `foo.md` (a regular reference doc)
  doesn't.

Skip this step if the worktree didn't touch any planning-style docs.
If you're unsure whether a doc is a "plan" vs. a regular reference,
read the opening paragraph — future-tense plus aspirational verbs
("will", "proposes", "we should") is the giveaway.

### 6. Resolve any feedback item this work addressed

If this worktree's work was kicked off to address a `cb feedback` item —
or otherwise resolves one — mark it resolved as part of close-out, so it
doesn't resurface in the next feedback review. Only do this when the fix
is actually verified (tests green, behavior confirmed). If you're unsure
whether the work fully addresses the item, **ask the human** rather than
resolving it prematurely.

The feedback-review tool lives at the monorepo root:

```bash
cd ~/src/callback-mono/feedback-review
pnpm dlx tsx collect.ts --resolve <feedback-file-basename>.md
```

The basename is the feedback file the work came from (e.g.
`2026-05-28T05-52-18-when-regenerating-an-image-card-by-overw.md`); the
handoff briefing that spun up the worktree usually names it. If the script
prompts for the source box, give the box the feedback came from.

Skip this step if the work wasn't tied to a feedback item.

### 7. Merge the worktree branch into main

The agent is INSIDE the worktree, so use `-C` to operate on the main
checkout:

```bash
MONO=~/src/callback-mono
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git -C "$MONO" merge "$BRANCH"
```

This should be a fast-forward merge (since you merged main into the
worktree in step 3). The monorepo `post-merge` hook will trigger the
deploy regardless of whether the merge is fast-forward or not. If git
complains about conflicts, something's off (step 3 should have
surfaced them) — stop and ask.

### 8. Confirm and report

Show the human:

```bash
git -C ~/src/callback-mono log --oneline -3
```

Then report — and **match the language to your actual understanding of
the work's status.** Don't use close-out language for a checkpoint, and
never imply a confidence level you don't have. The facts to be straight
about:

- **Scope**: is the originally-planned work complete, or did this land a
  part of it? Name what's still outstanding.
- **Verification**: distinguish "tests pass" from "verified working in
  the running app" from "not really verified." Merging on green tests is
  fine — claiming more than that isn't.
- **Session disposition**: only suggest exiting when the work is complete
  AND you're not expecting to continue. For a checkpoint, say explicitly
  that the session stays open and what's next.

Complete + verified (close-out):

> Done. Merged `worktree-<name>` (N commits) into main as <hash>. Tests
> all pass (X/X) and I verified the behavior in the running app. Exit
> this session when ready — the worktree and box will be auto-cleaned by
> the SessionEnd hook since the branch is now fully merged.

Partial or lightly-verified (checkpoint):

> Checkpoint merged: `worktree-<name>` (N commits) into main as <hash>.
> Tests pass (X/X), but note: <what's only test-verified / not yet
> exercised end-to-end>. Still outstanding: <remaining scope>. Keeping
> this session open to continue — don't exit expecting cleanup; the
> branch will accumulate further commits.

### 9. (Implicit) Session exit cleanup

You don't do this — the SessionEnd hook at
`.claude/hooks/session-end.sh` runs when the human exits the session.
It detects that the worktree branch is fully merged into main (no
commits ahead, no dirty files) and removes:

- The worktree directory at `~/src/callback-worktrees/<name>/`
- The branch `worktree-<name>`
- The cloned box tree at `~/src/box-worktrees/<name>/` (containing `test1/`)
- Any router state for this worktree

You can mention this to the human so they know what to expect, but you
shouldn't run the cleanup yourself — the hook handles it cleanly.
