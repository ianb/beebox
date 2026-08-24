---
title: "A staging slot for pre-merge workstream testing"
workstream: streams-and-issues
area: deploy
design: ../../../callback-box/docs/implemented-plans/workstreams.md
filed-by: agent
discovered-in: worktree-workstreams — implementing the workstreams testing queue
resolution: wontfix
---

> **Closed by `0b7daa13` on 2026-08-24 — do not build a staging slot now.** Authenticated
> Tailnet exposure of the dev router can give remote devices the selected
> worktree and its isolated test box before merge. The real phone/Tailnet path
> still needs the boxholder's acceptance check. The production deploy ships an
> exact commit and verifies build, install, hub boot, and one box start after
> merge. The remaining staging-only value is too small to justify a second
> mutable deployment with its own state, secrets, identity, reset, and lease
> lifecycle. Reconsider only after repeated, labeled incidents show that a
> named class of defect must be demonstrated on a remote host before merge.

The `/workstreams/testing/` queue currently points at each worktree's local
router URL. That is the right default: most verification is cheapest and most
truthful against the isolated local checkout and test1 clone.

Some changes eventually need a deployed environment before merge: remote
network behavior, production-like auth, or a device that cannot reach the
developer router. Explore one deliberately singular staging deployment slot,
where "test this" replaces the slot with one selected workstream rather than
creating a fleet of persistent environments.

The integration point is a target column/action on `/workstreams/testing/`.
The exploration must cover deployment serialization, authentication,
provisioning and cleanup, and how the UI makes it unmistakable that staging is
shared and mutable. Keep the local worktree URL as the primary target; staging
is an explicit escalation, not the default testing path.

## What changed after this was filed

The original remote-access mechanism now exists. `cb tailscale setup --target
3210` can expose the authenticated dev router to the owner's Tailnet. The
router can serve every worktree by prefix, so a phone or other remote device
can open the same isolated checkout and `test1` clone that
`/workstreams/testing/` links to. This keeps pre-merge evidence attached to the
exact worktree without deploying it elsewhere.

The implementation has browser, curl, WebSocket, and isolated-router
acceptance coverage. It has not been accepted through the real `tailscaled`
path on the boxholder's phone. The staging conclusion depends on completing
that check. If it fails, fix the Tailnet exposure; do not infer that a staging
deployment is the required solution.

Remote dev also remains dev. Hidden tabs allow a worktree to idle-stop, and a
WebSocket does not cold-start it. The launcher opts into development-only
surfaces that production fails closed. These are known differences, not claims
of production parity.

The production deploy also became a more useful post-merge gate. It resolves
one commit, builds from a detached checkout, serializes concurrent requests,
restarts the hub and scheduler, waits for aggregate health, and cold-starts a
real box through a canary. It attempts migrations, but migration failures are
reported and deliberately do not fail the deploy. Both health checks use
server-local HTTP, so they do not exercise nginx, TLS, the public URL, or
per-user access. This does not make production a pre-merge environment. It
does reduce the value of staging to behavior that depends on the deployed host
itself.

The residual test classes are:

- nginx proxy and TLS behavior;
- systemd restart and process ownership behavior;
- the cloud host's network and filesystem environment;
- deployment-time migrations against persistent server state; and
- integrations that require server-side credentials or public callbacks.

These are important when a change touches them. They are not the ordinary
manual-testing cases listed in `/workstreams/testing/`.

## Why a singular slot is still a full environment

The existing deploy script is intentionally one-target. It reads one local
`server-ip`, and its latest-wins lock and request file are correct for one
production intent. A second host makes the install root, service names, and
deploy history naturally separate. The deploy-side change is comparatively
small: add an explicit target identity, choose a target-specific server
address, and key the local lock, request file, and checkout metadata by that
identity. Without that split, a staging request could supersede production.

Authentication is also environment state. A staging origin needs its own OAuth
redirects or local-password setup, Tailnet/HTTPS configuration, session
secrets, and owner identity. It must not borrow production cookies or secrets.

Provisioning cannot copy a real box casually. Box contents can be private.
Migrations can be destructive. Connectors can send messages, register
webhooks, or modify remote data. A safe slot therefore needs synthetic boxes,
staging-only credentials, disabled-by-default outbound integrations, and a
reliable reset to a known snapshot between workstreams.

Cleanup needs a lease rather than a button that deploys whatever was clicked
last. At minimum a future design must record the selected workstream, exact
commit, requesting identity, start time, expiry, and current deployment phase.
Replacement must require an explicit confirmation and must refuse or queue
while a deployment is active. The page must show that the target is shared and
mutable, who holds it, what commit is live, and when it will be replaced.

The deploy parameterization is not the expensive part. Safe data, credentials,
reset, and ownership of the shared slot are. Those requirements are
appropriate for a staging service. They are not an incremental extension of
the testing queue.

## Disposition and trigger

Use the worktree URL for pre-merge testing, including remote-device testing
through the authenticated Tailnet router after its real-device acceptance
check. Use the production deploy's health and box canaries after merge for
build, install, boot, and box-start evidence.

For changes to deployed-host behavior, keep a specific production check in the
issue's `## Manual testing` section:

- nginx, TLS, and public routing: probe the external health URL, not localhost;
- systemd settings: inspect the named unit properties after deploy;
- migrations: read the migration sweep output in the deploy log and inspect
  every reported box; and
- public callbacks and server credentials: exercise the named integration
  through its public endpoint with production authorization.

`/workstreams/testing/` currently links landed issues to the main dev box. It
cannot represent a production target, so the issue text must carry the exact
production URL or command. That queue limitation is tracked separately as
[manual-testing targets](../../features/2026-08-24-manual-testing-targets.md); it
is not a reason to create staging.

For each future incident that makes a staging slot plausible, file or update an
issue with the label `staging-candidate` and link this exploration. Reopen this
direction only when at least two such incidents show all of these properties:

1. the defect depends on deployed-host behavior that the remote dev router does
   not reproduce;
2. post-merge detection was materially too late; and
3. it is reproducible without production data or production credentials.

At that point, file a feature for a parameterized deployment-target contract
and a staging lease. Do not begin with a UI column; the deployment and data
isolation contracts are the prerequisite.
