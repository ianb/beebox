---
title: "/finish public merge blocked: harness forbids worktree-session git against the main checkout"
workstream: security-report
area: bin
labels: [soft-launch]
filed-by: agent
discovered-in: worktree-security-report — running /finish at the end of the security-report work
next-action: reconfirm
---

A worktree-isolated Claude Code session can no longer run **any** git
command targeting the shared main checkout `~/src/callback-box`. The
harness refuses with:

> "This session is isolated in the worktree … but this command redirects
> git to the shared checkout via -C. Refusing to run it — a
> worktree-isolated session's git operations must target its own worktree."

This is **intended, documented Claude Code behavior**, not a bug and not
one of this repo's hooks (the message text appears nowhere in `.claude/`
or `bin/`). The official docs section "How Claude Code enforces
isolation" (https://code.claude.com/docs/en/worktrees) states that a
worktree-isolated session blocks any Bash command that redirects git into
the main checkout "through `git -C`, `--git-dir`, a `GIT_DIR` or
`GIT_WORK_TREE` variable, or a `cd` into the main checkout before running
git," and that the same enforcement "covers every subagent Claude spawns
from the isolated session." It refuses the bare command, variable-
indirected `-C`, a `sh -c` wrapper, and even a read-only `git -C … log`,
and is not lifted by `dangerouslyDisableSandbox`; there is no documented
flag to disable the git-redirect check.

Timing: worktree isolation shipped ~Feb 2026, but the enforcement was
extended to cover Bash / `git -C` in **every** session type including
subagents around **v2.1.218 (2026-07-22)** — which is why the flow
worked before and blocks now. The guard is scoped to the repository the
worktree is linked from, so a `git -C` against the *private-issues* repo
(a separate repository) is unaffected — that is why the private leg still
lands.

The intended upstream model is that you integrate to `main` **from the
main checkout, not from inside the worktree** (`git checkout main &&
git merge <branch>`). Our `/finish` predates that model.

**Why it breaks `/finish`:** `.claude/agents/finish.md` step 8 performs
the public merge as `git -C ~/src/callback-box merge --ff-only "$BRANCH"`
(line ~463), and its finalization gate reads main's state with
`git -C ~/src/callback-box status --porcelain` / `rev-parse` (lines
446-449). All of these are now refused, so the finish subagent completes
every verification step and then **BLOCKS at the public merge** with
nothing merged to `main`. The private leg still lands, because it runs
through the blessed `bin/private-issues with-lock … git -C "$PRIV" …`
wrapper against a repo path the guard doesn't cover. Confirmed on the
security-report worktree: branch green (6444/6444), `main` merged in,
private leg merged, public merge impossible from the session.

**Current workaround:** run the one merge command from a session/terminal
that is not worktree-isolated (the main checkout itself):
`git -C ~/src/callback-box merge --ff-only worktree-<name>`.

**Fix directions (pick one):**
- A blessed, locked wrapper for the main checkout analogous to
  `bin/private-issues with-lock` — a `bin/workstreams land <name>` that the
  harness permits and that serializes against concurrent sweeps — and
  rewrite finish step 8 to call it instead of bare `git -C`.
- Or have `/finish` hand the final merge back to the main
  (non-worktree) session by design, rather than attempting it from the
  worktree.
- Either way, update `.claude/agents/finish.md` step 8 and `bin/CLAUDE.md`
  so the documented flow matches what the harness actually allows.

Until then, every worktree `/finish` will BLOCK at the public merge and
need a human to run the one command **from the main checkout**. This is a
process breakage in our own tooling caused by an intended upstream
isolation change, not a code defect in the shipped product and not a
Claude Code regression — the fix is on our side (adapt the finish flow to
the documented model).
