---
title: "Cloudflare 'Flexible' SSL leaves edge-to-origin traffic plain HTTP"
workstream: security-report
area: beebox
labels: [soft-launch]
filed-by: agent
discovered-in: worktree-security-report — operational inventory for the security report
priority: normal
---

The public deploy path is Cloudflare-proxied DNS with SSL mode
"Flexible": HTTPS between the client and Cloudflare, but **plain HTTP
between Cloudflare's edge and the origin** — nginx listens on port 80
only and proxies to `127.0.0.1:3210` (`deploy/` + `docs/server-operations.md`).
Session cookies, box content, and credentials transit the public
internet unencrypted on that leg.

Fix direction: switch the zone to "Full (strict)" and give nginx a TLS
listener with an origin certificate (Cloudflare Origin CA certs are
free and purpose-built for this). Small, contained change to
`deploy/setup-server.sh`'s nginx config + a dashboard toggle — but note
the documented drift gap: `setup-server.sh` is not re-run by
`deploy.sh`, so the nginx change must be applied to the live server
manually.
