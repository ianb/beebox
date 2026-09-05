---
title: "bbx tailscale: dev-router exposure operational polish (from the first live proof)"
workstream: unknown
area: beebox
needs: [design]
filed-by: agent
discovered-in: first real-tailscaled live proof of the exposed dev router (2026-07-22)
priority: normal
---

The dev-router Tailscale exposure (`docs/implemented-plans/expose-dev-router.md`)
works end-to-end against the real daemon — but the first live run surfaced
operational rough edges the fakes/reviews couldn't. Each cost real
back-and-forth. Prioritized by how hard it bit.

## 1. Hostname change orphans the serve mapping — and `stop` can't clean it (the worst)
Exposing under `macbook-pro-4.…`, then `tailscale set --hostname mac`, left the
serve mapping bound to the OLD name. Result cascade: hitting the new name →
`ERR_SSL_PROTOCOL_ERROR` (no mapping for it), then after a manual
`tailscale serve reset` → "no connection" until re-run. And `bbx tailscale stop`
CANNOT remove the stale mapping, because `tailscale serve … off` only addresses
the node's CURRENT hostname (the exact pre-rename case the unit tests model at
`test/services/tailscale-setup.doctest.md` "Stop scans EVERY host"). The recorded
exposure intent also still points at the dead `dnsName`.
- **Fix:** `bbx tailscale status` should detect `recorded dnsName ≠ Self.DNSName`
  and flag it loudly ("your machine was renamed; the exposure points at a dead
  name"). `bbx tailscale setup`/`stop` should heal it: re-point (reconfigure serve
  under the current name + update the record) or fall back to `tailscale serve
  reset` when a cross-host mapping can't be removed via `off`. Consider keying
  teardown off `serve reset` / port rather than current-host `off`.

## 2. Kill the cert race at the source (partially done)
The first `tailscale serve --https=443` on a tailnet provisions a Let's Encrypt
cert (a few seconds), during which the served probe fails → a scary "REFUSING to
expose". A retry-poll already shipped (`settleRouterExposure` / `pollServedRouter`,
merged `9e2f7c1b`). Better still: **pre-provision the cert** with
`tailscale cert <Self.DNSName>` BEFORE configuring serve, so there's never a
window — cleaner than retry-after-fail. (Also re-provisions on a rename, tying
into #1.)

## 3. Auto-detect the dev router as a target
On a dev machine, `bbx tailscale setup` with no `--target` finds no `hub.json`
(dev uses the shared router, not a standalone hub) and refuses, so the operator
must know to pass `--target 3210` AND that 3210 is the router. Discovery could
probe the running dev router (its UDS / `/__router/status` self-identifies via
`x-bbx-router-guarded`) and offer "expose your whole dev router?" directly.

## 4. Process note (not a code change)
For infra that only exercises against a real external daemon, a live smoke test
belongs IN the build loop, not only after the final merge — #1 and #2 became
follow-up merges because the first live run happened post-merge. It needs the
boxholder's hands + the real tailnet, so it can't be fully automated, but even a
single "expose it once on my Mac" checkpoint mid-build would have caught both.
