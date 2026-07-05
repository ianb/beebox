---
needs: [decision]
area: callback-box
---

# Switch deploy from rsync to git push

`deploy/deploy.sh` rsyncs the local working tree to `/opt/callback/`, excluding `.git`. Side effects:

- Server's `git rev-parse HEAD` is meaningless (it reflects whenever .git was last touched, not what's running). The health endpoint now reads `deploy-info.json` to surface the actual deployed hash, but that's a workaround.
- You can deploy from a dirty working tree, so the recorded hash may not match what's on disk.
- No git-native rollback (you redeploy from an older local checkout instead).

Options:

1. **Git push to a bare repo on the server with a post-receive hook.** Hook checks out HEAD into `/opt/callback/`, runs `npm install`, builds frontend, restarts services. Server git matches what's running. Loses today's "scp a single file to test a hotfix" iteration loop — every change has to be a commit. (This section predates the cardworks-into-callback-box merge and the monorepo restructure, which removed the multi-repo deploy complication it originally called out.)

2. **Server pulls from GitHub on deploy.** Standard CI/CD pattern, single source of truth, but every deploy is a GitHub roundtrip.

3. **Keep rsync but require a clean working tree** (with `--force` for hotfix work). Smallest change. Fixes the truthfulness problem without losing iteration speed.

For now: keeping rsync. Revisit if deployment reproducibility / rollback ergonomics start to bite.
