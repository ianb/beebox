---
title: "Separate the boxholder-specific deploy machinery from the repo's release story — abstract the deploy, keep opt-in infrastructure"
workstream: deploy-separation
needs: [design]
area: beebox
labels: [deploy, soft-launch]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — needed for release; the deploy stuff is really specific to my machine and deployment"
priority: backlog
next-action: reconfirm
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

> 2026-09-04 built (worktree-deploy-separation). The separation is by
> **topology ownership**, not by abstracting `deploy.sh`: it is one shape
> (rsync a built commit to a long-lived multi-box VPS) and the container
> install is another, so parameterizing one over both would be an abstraction
> with a single real caller. What changed instead:
>
> - **`deploy/target.env`** (gitignored, `target.env.example` committed) plus
>   `deploy-target.sh` replaces `server-ip`. Its presence is the enable
>   switch: no target.env → the hooks ship nothing and say nothing, every
>   script refuses with the setup steps and a pointer at the container
>   install. Everything that had its own idea of where production is now asks
>   that one script — the doctor's two prod checks, the leak scan's prod leg,
>   feedback collection, the CSP report, add-box. Host, SSH user, install dir,
>   service account and home, hub port, and the failure notifier are config.
> - **`deploy/hetzner/`** holds `create-server.sh` + `setup-server.sh`, headed
>   as one example provisioner rather than the install path.
> - **Deleted**: `rebuild.sh`/`rebuild-server.sh` (a second deploy path with no
>   convergence and no healthcheck — nothing depended on it; the `bbx-rebuild`
>   symlink it installed does not exist on the live server) and
>   `migrate-to-beebox-user.sh` + its rehearsal (one-shot, already performed).
> - **shlock → a portable lock directory**, so a deploy from anything but a Mac
>   no longer dies mid-run on a missing macOS binary. Stale-lock breaking kept
>   and now actually tested.
> - **The container path converges on start** (`bbx migrate --sweep` +
>   `bbx docs refresh`). It did not before — `bbx serve` does not migrate on
>   boot — so the story being promoted could not honestly update a box. This
>   was the real gap behind "the generic core is what docker-install already
>   describes": it described everything except convergence.
>
> Not resolved by this, and deliberately: the setup-server drift issue below.
> Naming `hetzner/setup-server.sh` as the un-converged half makes it more
> visible, not smaller.
>
> Cross-model review (codex, gpt-5.5) found three things the build had wrong,
> all fixed:
>
> - **The layout knobs were half-honored.** `target.env` advertised
>   `INSTALL_DIR`/`SERVICE_USER`/`SERVICE_HOME`/`HUB_PORT`, but only the rsync
>   destination read them — deploy.sh's remote heredocs, add-box.sh, the leak
>   scan and the CSP report all name `/opt/beebox`, `/home/beebox`, `beebox`
>   and 3210 literally. A relocated server would have been shipped to one path
>   and installed, converged and health-checked at another, reporting success.
>   The loader now refuses those settings outright and exports them as fixed
>   constants, so the four codebases share one source for the layout. Making
>   them real means threading four values through every remote block; that is
>   the outstanding follow-up, not something to advertise before it exists.
> - **Deploying from a worktree became possible.** The old check was
>   `[ -s "$SCRIPT_DIR/server-ip" ]` with no fallback — deliberately
>   main-checkout-only. The new loader's worktree→main fallback (right for
>   diagnostics) silently extended to deploy.sh, so `deploy.sh` in a worktree
>   would have borrowed main's target and shipped an UNLANDED BRANCH to
>   production. deploy.sh now loads with `BBX_DEPLOY_NO_FALLBACK=1`. The test
>   that claimed this invariant only regex-matched the call text; it now runs
>   deploy.sh from a real worktree and asserts the refusal.
> - **Container convergence could hang the start.** The entrypoint promised
>   convergence "cannot stop the box from serving" but ran both commands
>   unbounded, where deploy.sh wraps its equivalents in `timeout 600`. Same
>   bound now, with a distinct message for the timeout case.

