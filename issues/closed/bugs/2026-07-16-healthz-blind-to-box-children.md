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
2. **Acting on the child state healthz already reports** — `/healthz` does
   include per-box supervisor status (`running`/`stopped` + restart counts);
   the deploy just doesn't evaluate it. A crash-looping child (nonzero
   restarts, or a spawn that dies before "running") should fail verification.
   Worth checking what status a crash-looping child actually reports —
   during this incident the children died at request time and the hub
   answered `No running box`, which a status-blind 200 check can't see.

Related observation from the same incident: the deploy's 30s healthz timeout
raced the hub's ~32s cold boot and reported failure on a deploy that (at hub
level) succeeded — the window deserves a small bump or a readiness-aware wait.
