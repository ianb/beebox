# The seam: lifecycle out of one harness's hooks
## Supporting: a plain CLI, and thin clients
- Codex "had to impersonate Claude Code's hook JSON" to reach the worktree lifecycle, so the logic moved to `bin/workstreams`; hooks, the Codex launcher, schedules and the web app call it

```text
create <name>       worktree + box clone + installs + Codex mirrors
remove <name>       refuses unmerged/dirty/live; nothing overrides the liveness check
resume <name>       focus live, reopen idle, or recreate a culled workstream
confirm-tested      clear manual-testing on main and commit
list [--json]       every worktree joined across git, runtime, agent, registry, clone
agent-liveness      none|live|unknown as JSON, from the one shared guard
sweep               remove merged, clean, agent-free worktrees
```

```bash
# .claude/hooks/session-end.sh
# The guards and the removal itself live in bin/lib/worktree-teardown.sh,
# shared with bin/codex-session-end (codex sessions fire no hooks, so their
# teardown is driven by the launcher instead). This file holds what's specific
# to Claude Code: the stdin JSON, resolving which worktree the session belonged
# to, and the unconditional sweep trigger.
```

Notes:
Adding the second engine then cost one script. Scheduled workstreams (Aug 24) and GLM launches reuse the same path. Off-the-shelf orchestrators did not fit because they own this exact layer.
