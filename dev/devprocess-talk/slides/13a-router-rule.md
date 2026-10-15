# The router rule loses its shouting
## Supporting: root CLAUDE.md, c8c728285
```text
BEFORE
**Dev server.** `pnpm dev` at the monorepo root runs one router on port 3210
serving every checkout by path prefix: … — worktrees lazy-start on first
request (~4s cold, ~10ms warm) and idle-stop after 5 min; only HTTP requests
count as activity (WebSockets never wake a worktree; stale tabs self-heal).
The router is shared across sessions — don't restart or `panic` it from a
worktree session; ask the boxholder. … **The `<worktree>` prefix is the
worktree's short name — what you passed to `--worktree` (e.g. `scanner-ingest`)
— NOT its git branch `worktree-<name>` … The router drops the `worktree-`
branch prefix, so a URL built from the branch name … hits a nonexistent
worktree and renders an empty/404 page. Strip the `worktree-` before building
a URL.**

AFTER
One shared dev router serves every checkout at
`http://localhost:3210/<main|worktree>/<box>/...`. Use the worktree's short
name, without the branch's `worktree-` prefix. HTTP requests wake idle
worktrees; WebSockets do not. **Do not restart or `panic` the shared router
from a worktree without asking the boxholder.** Lifecycle details:
bin/CLAUDE.md#lifecycle-commands.
```

Notes:
The mechanism (idle after five minutes, heartbeats, reloads) moved to bin/docs/router-operations.md, read by someone editing the router rather than on every turn. bin/CLAUDE.md itself went from 910 to 193 lines the same day.
