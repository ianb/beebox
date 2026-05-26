---
name: finish
description: Use when the human says the worktree's work is done and they want it merged back to main. Drives the full close-out flow: commit any straggling changes, pull main into the worktree, run the test suite (ALL tests must pass — no exceptions), then merge the worktree branch into main. After this completes, the SessionEnd hook will auto-clean the worktree on session exit. Triggers include "finish", "wrap this up", "ship it", "merge this back", "/finish".
allowed-tools: Bash, Read, Edit, Write
---

# /finish

Close out a worktree session by landing its work in `main`. **Only invoke
when the human says they're done with this worktree.**

## Test failures are NEVER acceptable

The single most important rule in this skill:

> If `pnpm test` reports ANY failure — anywhere in the suite, in any file,
> for any reason — you do not proceed. You do not file the failure under
> "not my problem". You do not declare the session done. You investigate
> and fix the failing test, OR you escalate to the human and stop.

You may be tempted to think "those tests were failing before I started",
"that test is flaky", "that file is unrelated to my changes", or "the
test infrastructure is broken". Those are not exits from this rule.
Either the failure is yours to fix or it's a real bug that has to be
escalated — never silently shrugged off.

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

### 5. Merge the worktree branch into main

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

### 6. Confirm and report

Show the human:

```bash
git -C ~/src/callback-mono log --oneline -3
```

Then say something like:

> Done. Merged `worktree-<name>` (N commits) into main as <hash>. Tests
> all pass (X/X). Exit this session when ready — the worktree and box
> will be auto-cleaned by the SessionEnd hook since the branch is now
> fully merged.

### 7. (Implicit) Session exit cleanup

You don't do this — the SessionEnd hook at
`.claude/hooks/session-end.sh` runs when the human exits the session.
It detects that the worktree branch is fully merged into main (no
commits ahead, no dirty files) and removes:

- The worktree directory at `~/src/callback-worktrees/<name>/`
- The branch `worktree-<name>`
- The cloned box at `~/src/box-worktrees/test1-<name>/`
- Any router state for this worktree

You can mention this to the human so they know what to expect, but you
shouldn't run the cleanup yourself — the hook handles it cleanly.
