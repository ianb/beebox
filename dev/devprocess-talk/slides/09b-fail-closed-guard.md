# The guard that failed open
## Supporting: found by cross-model review, fixed in two steps
- Before: `ps` and `lsof` errors were silenced, so an empty answer read as "nothing running", and the sweep would delete a tree with an agent in it
- After: three states plus `unknown`; only `none` authorizes a delete; `--force` cannot override it

```bash
# BEFORE (bin/worktrees, 2026-08-08^)
active_cwds=$(lsof -a -d cwd -p "$agent_pids" -Fn 2>/dev/null | sed -n 's/^n//p' | sort -u)

# AFTER (bin/lib/worktree-teardown.sh)
# Always returns 0; the answer is in WT_AGENT_STATE (`none` | `launching` |
# `live` | `unknown`)… Callers MUST treat `launching` and `unknown` the same
# as `live` for destructive decisions — that's the fail-closed half of this guard.
  if [ -z "$other_cwds" ]; then
    WT_AGENT_REASON="cannot-read-agent-cwds others=[$pid_csv]"
    return 0        # state stays unknown
  fi

# the sweep (bin/workstreams)
      if [ "$WT_AGENT_STATE" != "none" ]; then
        echo "skip $name: agent=$WT_AGENT_STATE ($WT_AGENT_REASON)"
```

Notes:
"--force overrides the first two [merged, dirty]; nothing overrides the liveness check." Forty days of logs: 793 skips for a live agent, 0 for unknown, 144 removals with no human step.
