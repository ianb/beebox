# One unattended sweep
## Supporting: the cleanup log, lines from Oct 9 (two skips spliced from earlier sweeps)
```text
2026-10-09T11:57:18Z auto-sweep trigger=session-end START
  remove cross-box-leak-scan (branch=worktree-cross-box-leak-scan)
    told router to stop cross-box-leak-scan
    trashed worktree ~/src/beebox-worktrees/cross-box-leak-scan
    deleted branch worktree-cross-box-leak-scan
  skip devprocess-talk: agent=live (signal=argv pid=698)
  skip ios-on-device-hq: pinned=manual-testing
  skip future-dated-issues: agent=live (signal=cwd)
  skip quick-wins-oct: ahead=5 non-deletion-dirty=0 (has unmerged work)
  sweep done: 1 worktrees, 0 browse, 0 logs, 0 pids
2026-10-09T11:57:28Z auto-sweep trigger=session-end END
```
- 40 days: 184 sweeps; 83 session-end removals plus 61 sweep removals; skips: 1,017 unmerged, 238 pinned, 793 live, 0 unknown

Notes:
The same few unmerged trees are skipped about 120 times each: the sweep reports them but cannot decide for the human. That is by design.
