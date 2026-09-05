---
title: "Deploy's `pnpm install --frozen-lockfile` step gets OOM-killed under box-session memory pressure"
workstream: architectural-review
area: deploy
filed-by: agent
discovered-in: worktree-architectural-review — /finish merging the markdoc-walkers/as-ban batch to main
resolution: implemented
---

**Resolved** (worktree `fix-bugs`, 2026-07-11): implemented option 2/4 (retry
with backoff) — the bare `pnpm install --frozen-lockfile` in the remote
heredoc is now wrapped in an `install_with_retry` function
(`beebox/deploy/deploy.sh:430-448`) that retries up to 3 attempts,
**only** on exit 137, with 60s then 180s backoff between attempts, logging
each retry to stderr; a non-137 failure or a third 137 fails immediately and
returns the code so the deploy still fails loudly. Options 1 and 3 (add swap /
upgrade server RAM) were **not done** — those are infra decisions for Ian to
make, not something to implement unilaterally.

Merging `worktree-architectural-review` into `main` triggered the post-commit
auto-deploy (`deploy/deploy.sh`), which failed 3 times in a row with the same
signature:

```
bash: line 48: <pid> Killed  HUSKY=0 npm_config_update_notifier=false pnpm install --frozen-lockfile
Deploy failed (exit 137)
```

Checked the server directly (`deploy/ssh-server.sh "free -h"`): 3.7Gi total
RAM, ~830Mi free, **0B swap**. `ps aux --sort=-%mem` showed 7 running `bbx serve`
box processes plus 5 concurrent `claude-agent-sdk` subprocesses (active box
agent sessions) already consuming the bulk of it — `pnpm install` on the deploy
checkout needs enough headroom to resolve/link the workspace, and there wasn't
any; the kernel OOM-killed it every time, immediately after "reused N, added 0"
lockfile resolution (so it's the link/write phase, not network).

The immediately-prior deploy (commit `1ce43f2d`, ~13 minutes earlier) succeeded
fine, so this isn't a permanent regression — it's a capacity/contention window
that widens as more boxes run concurrent agent sessions on this single 3.7Gi
box. Result: `main` is currently running an OLDER deployed commit than its git
HEAD (the merge landed, but its dist/build never went live) until a deploy
retry succeeds when memory pressure drops.

Options to resolve properly, pick one (or combine):
1. Add swap (even a few GB) so a transient spike degrades to slow instead of
   OOM-killed — cheapest fix, no behavior change.
2. Give the deploy's `pnpm install` step a memory budget check /
   retry-with-backoff before giving up, so a transient contention window
   doesn't require a human/agent to notice and manually re-run
   `deploy/deploy.sh`.
3. Upgrade the server's RAM if concurrent-box-session load is only going to
   grow (7 boxes + N agent sessions already near the ceiling at idle-ish
   levels).
4. Make `deploy.sh` itself detect an exit-137 and auto-retry a couple of times
   with a short delay before reporting failure — the two manual retries here
   both hit the exact same wall immediately, suggesting a longer backoff (not
   an instant retry) is what would actually help.

Workaround used here: re-ran `deploy/deploy.sh` manually from the main
checkout; still failed on the third attempt too. Whoever picks this up should
check `deploy/.deploy-logs/` for the latest ref and re-run once server memory
has headroom, or implement one of the above first.
