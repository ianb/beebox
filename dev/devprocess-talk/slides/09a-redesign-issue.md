# The issue that reorganized August
## Supporting: filed 2026-08-08, closed 2026-08-14
```markdown
Sessions are currently doing double duty as a to-do database. A worktree stays
open until I have verified the work, because the open session is the only
record of _what still needs checking_. Everything else follows from that:

- Closing a session feels lossy, so ~9 accumulate (they were live when this was
  filed, on a machine that had exhausted its 20 GB of swap).
- There's no way to see what's outstanding — the list exists only as terminal tabs.

## The distinction the design turns on
"Keep it open until verified" is two cases with opposite answers:
- **Merged + needs verification** — the code is on `main`; the worktree has
  nothing unique about it. Nothing to resume; you only need a record of what to
  check. The worktree should go away.
- **Unmerged, paused mid-work** — the worktree is the only copy. Resume is real.
Today both pin a tab. Separating them is what makes the first case disposable.
```

Notes:
Path: issues/closed/features/2026-08-08-worktree-session-workflow-redesign.md. The plan that closed it (implemented-plans/workstreams.md) lists it in its frontmatter, so the issue and plan point at each other.
