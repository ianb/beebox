---
area: router
filed-by: agent
discovered-in: worktree-architectural-review — Track D (P2-c), during the architectural-review multi-agent commit run
resolution: implemented
---

**Closed 2026-07-09** (W-core-sweep): Track 2 of
`callback-box/docs/implemented-plans/architectural-review-followups.md` swept ~31
stage→commit sites onto the path-scoped `stageAndCommitPaths` helper
(`callback-box/src/lib/git.ts`, landed in commit c1e65a22), and this agent's
non-connector share of that sweep + the process-fix paragraph in
`bin/CLAUDE.md`'s new "Multiple agents sharing one worktree" section
document the path-scoped-commit convention (`git add <paths> && git commit
-- <paths>`, never a bare `git commit`) for future multi-agent runs.

# Parallel task agents sharing one worktree can race `git add`/`git commit`

The architectural-review plan is being executed by several concurrent Claude
Code agents, all committing directly to the same shared worktree/branch
(`worktree-architectural-review`) as each finishes a track. `git add
<my-files>` followed by `git commit` is not atomic across processes: while
this agent was running its own `git add` + `git commit`, another agent's
commit (a `lint-staged` run, which itself does a `git stash` backup/restore
around the staged files) landed in between, and this agent's already-staged-
but-not-yet-committed changes (Track D.5's Gemini JSON boundary work) were
swept into the OTHER agent's commit instead of getting their own. No content
was lost and both agents' work is intact on disk and in history, but the
commit attribution/message for D.5 is wrong (it reads
"refactor(chat): ChatMessage flat interface -> discriminated union (Track B)"
but also contains the Track D.5 diff).

Worth a process fix for future multi-agent runs against one shared worktree:
either serialize commits (a lock file / turn-taking convention agents check
before `git add`+`commit`), or give each concurrent task agent its own
worktree/branch and merge at the end instead of committing straight to a
shared branch. The current per-worktree isolation (`bin/CLAUDE.md`) already
solves this for a single agent per worktree; it doesn't cover N agents
sharing one.
