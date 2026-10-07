---
name: deploy-status
description: Report production deploy state read-only. Use for "what is deployed", "did the deploy work", "is prod healthy", "pending migrations", "deploy status", or whether a deploy is in progress.
---

# Deploy status

Run `bin/deploy-status` (`--json` when a script consumes it) and answer from its output. Never improvise SSH for these questions.

- Read only. Never deploy, restart, migrate, or edit anything on prod from this skill; a change is a separate request to the boxholder.
- Deploys run only from `main` commits through the post-commit hook or `beebox/deploy/deploy.sh` in the main checkout. A worktree's HEAD ahead of prod is normal.
- `main` ahead of prod with the lock free is normal when those commits touch no shipped path (`beebox/`, `agent-doctest/`, `personal-vibe-check/`, `patches/`, root pnpm files); check with `git diff --stat <deployed>..main`. Otherwise a deploy failed or never ran: report the last run and point at `beebox/deploy/.last-deploy.log`.
- Pending migrations on prod are applied by the deploy sweep, not by hand. Open migration questions go to the boxholder.
- Low disk goes to the boxholder; do not delete anything on the server.
- A degraded section prints `unavailable: <reason>`. Say which sections ran and why the others did not.
