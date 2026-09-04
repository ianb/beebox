---
title: "Separate the boxholder-specific deploy machinery from the repo's release story — abstract the deploy, keep opt-in infrastructure"
workstream: deploy-separation
needs: [design]
area: beebox
labels: [deploy, soft-launch]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — needed for release; the deploy stuff is really specific to my machine and deployment"
---

`beebox/deploy/` is the boxholder's personal pipeline wearing repo
clothes: `deploy.sh` assumes one specific server (gitignored `server-ip`),
one SSH root path, macOS-specific pieces (shlock, terminal-notifier,
Terminal-activating notifications), and the root husky `post-commit` hook
auto-deploys every landing on the boxholder's machine. A visitor who clones
the repo gets scripts that reference infrastructure they don't have — and
worse, a hook that *tries*. The boxholder's direction: **separate it out —
abstract the deploy some, while leaving infrastructure a developer can
opt IN to.**

Shape to design (not decided):

- **A generic core**: build → ship → converge boxes → verify (healthz/canary)
  as the documented, target-agnostic flow — probably what the Docker/VPS
  install guide already describes, promoted to the one honest deploy story.
- **An operator-config layer**: the boxholder's specifics (server-ip, ssh
  target, notification style, auto-deploy-on-commit) become per-developer
  opt-in config — gitignored like `server-ip` already is, or a
  `deploy/local/` the hook consults. The post-commit auto-deploy fires only
  when configured; absent config, landings just land.
- **What stays in the repo**: the smoke harnesses, the health verification,
  the disk gate and cache pruning (recently built and generic), the
  release/update story ([release-discipline](../decisions/2026-07-20-release-discipline-and-update-story.md)
  is the sibling — a *release* is what a visitor consumes; this issue is
  about not shipping the boxholder's *pipeline* as if it were that).
- **Boundary cases**: prod-curl/prod-ssh/prod-browse (operator debug tools —
  useful pattern, personal endpoints), add-box/migrate scripts (half setup, half
  personal history), `claude-update.sh`, the notification wiring.

Overlaps to name, not absorb: [setup-server drift](../code-quality/2026-08-07-deploy-infra-drift-setup-server-not-rerun.md),
the installation-remaining work (the visitor-facing install paths), and the
name-change plan (renaming will touch every one of these files anyway —
sequencing the separation before or with the rename avoids doing it twice).

> 2026-09-04 survey (bbx-pick-issues, release lens): still true. The root
> `.husky/post-commit` now gates on deployed paths, but a clone with no
> `beebox/deploy/server-ip` still prints "NOT deploying — server-ip is
> missing (lost in a repo move?) — restore it" on every commit to main: a
> false alarm telling a visitor to restore a file they never had. `deploy.sh`
> references the server-ip/prod-ssh/notifier pieces 25 times. The rename has
> landed, so the sequencing concern in the last paragraph is moot; the
> generic core the issue asks for is what `docs/docker-install.md` already
> describes.
