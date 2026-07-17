---
title: Hub /healthz is blind to box children — deploy verified "healthy" while every box was crashing
---

During the Node 22→24 upgrade (2026-07-16), every per-box `cb serve` child
crash-looped on a better-sqlite3 ABI mismatch (`ERR_DLOPEN_FAILED`), yet the
hub's `/healthz` returned 200 — the deploy healthcheck (and any external
monitoring pointed at it) considered the system healthy while no box could
serve a single request. Requests to boxes returned the hub's
`No running box for "/<slug>/"` 404.

Two layers to consider:

1. **Deploy verification depth** — `deploy.sh`'s "Verifying /healthz" step
   should also probe at least one real box path (a box `/healthz` or a page
   fetch through the hub) so a child-level startup failure fails the deploy.
   A specific ABI guard was added to `deploy.sh` for the better-sqlite3 case,
   but the verification gap is generic — any child-only startup crash slips
   through.
2. **Hub health semantics** — consider a `/healthz?deep=1` (or a separate
   endpoint) that reports child supervisor state (n running / n crashed /
   last spawn error per slug), so both deploys and monitoring can see child
   failures without fetching authenticated pages.

Related observation from the same incident: the deploy's 30s healthz timeout
raced the hub's ~32s cold boot and reported failure on a deploy that (at hub
level) succeeded — the window deserves a small bump or a readiness-aware wait.
