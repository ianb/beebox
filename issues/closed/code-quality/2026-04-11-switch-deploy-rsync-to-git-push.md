---
title: "switch deploy rsync to git push"
workstream: unknown
area: callback-box
resolution: implemented
---

**Closed 2026-07-09** — resolved by a fourth option, "deploy-from-commit"
(option 3's spirit, enforced by construction): `deploy.sh` now builds the
requested ref in a persistent detached git worktree (`.deploy-checkout` at the
main repo root) and rsyncs from there, never from a working tree. Dirty-tree
deploys are impossible; `deploy.sh --ref <sha>` is a one-command rollback;
concurrent deploys collapse latest-wins; `deploy-info.json` (already read by
`/healthz`) is promoted from workaround to the authoritative deploy record.
Option 1 (bare repo + post-receive) was considered and rejected: it moves the
build — the most failure-prone step — onto the 4GB prod box that's serving
live boxes, and its unique payoff (truthful server `git HEAD`) is cosmetic
once deploy-info is guaranteed correct. Mechanism docs: `deploy/README.md`;
rollback runbook: `docs/server-operations.md`. A Codex adversarial review
shaped the hardenings (clean-artifact boundary, checkout ownership
validation, per-run deploy logs).

`deploy/deploy.sh` rsyncs the local working tree to `/opt/callback/`, excluding `.git`. Side effects:

- Server's `git rev-parse HEAD` is meaningless (it reflects whenever .git was last touched, not what's running). The health endpoint now reads `deploy-info.json` to surface the actual deployed hash, but that's a workaround.
- You can deploy from a dirty working tree, so the recorded hash may not match what's on disk.
- No git-native rollback (you redeploy from an older local checkout instead).

Options:

1. **Git push to a bare repo on the server with a post-receive hook.** Hook checks out HEAD into `/opt/callback/`, runs `npm install`, builds frontend, restarts services. Server git matches what's running. Loses today's "scp a single file to test a hotfix" iteration loop — every change has to be a commit. (This section predates the cardworks-into-callback-box merge and the monorepo restructure, which removed the multi-repo deploy complication it originally called out.)

2. **Server pulls from GitHub on deploy.** Standard CI/CD pattern, single source of truth, but every deploy is a GitHub roundtrip.

3. **Keep rsync but require a clean working tree** (with `--force` for hotfix work). Smallest change. Fixes the truthfulness problem without losing iteration speed.

For now: keeping rsync. Revisit if deployment reproducibility / rollback ergonomics start to bite.
