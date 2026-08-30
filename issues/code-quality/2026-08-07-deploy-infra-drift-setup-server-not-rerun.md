---
title: "Infra config drift: setup-server.sh is not re-run by deploy.sh"
workstream: security-report
area: beebox
filed-by: agent
discovered-in: worktree-security-report — operational inventory for the security report
---

`deploy/deploy.sh` ships code but does not re-run
`deploy/setup-server.sh`, which owns the nginx and systemd configuration
(`deploy/README.md` documents this as a known gap). So a change to the
nginx vhost, the systemd units, or the bind/TLS posture only reaches the
live server if someone remembers to apply it by hand — a security-
relevant config change can silently fail to deploy while the code change
around it succeeds.

This surfaced adjacently to
[cloudflare-flexible-ssl-origin-plaintext](../bugs/2026-08-07-cloudflare-flexible-ssl-origin-plaintext.md):
the fix for that (an nginx TLS listener) is exactly the kind of infra
change this gap would strand.

Fix direction: either split an explicit `deploy/deploy-infra.sh` that
re-applies the idempotent parts of `setup-server.sh` on demand, or have
`deploy.sh` detect and warn when the committed infra config differs from
what is live. The security report tracks this as an operational gap
(§5), not an accepted risk — nobody decided the drift is fine, it is
just currently unaddressed.
