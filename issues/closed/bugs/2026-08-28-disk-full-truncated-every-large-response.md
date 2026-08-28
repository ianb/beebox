---
title: "Prod disk hit 100% (again); nginx truncated every large response and nothing paged anyone"
workstream: deploy-disk-hygiene
resolution: implemented
area: callback-box
priority: important
labels: [deploy, ops]
filed-by: agent
discovered-by: Ian
discovered-in: main session — phones stuck on "Loading Callback Box…" for two days
---

Closed by `a17d74a2e`: deploys prune the package caches they grow, refuse to
install below a capacity-relative disk threshold, and expose low disk through
hub health and `cb doctor`. Production verification remains the landing deploy.

Second 100%-full in three weeks (first: 2026-08-04). From 2026-08-26 23:27 to
2026-08-28 ~12:50 UTC, the server's disk was full. Consequences, all silent:

- nginx could not spill large responses to proxy temp files, so anything over
  its in-memory buffer truncated mid-stream: the ~1.9MB SPA bundle died at
  ~32KB for every client. Phones showed the pre-mount "Loading Callback Box…"
  forever while small responses (document, API, WebSocket) worked — which made
  every server-side probe look healthy.
- nginx stopped writing logs (ENOSPC alerts in error.log, then nothing).
- `/home/callback/.cb-auth.json` vanished — plausibly an atomic-write casualty
  (temp write fails on a full disk); every password login now fails. Recovery
  is the Google-owner credential-init flow; not yet done.
- Nothing alerted: the deploy's health verification, hub `/healthz`,
  `/healthz/canary`, and `cb doctor` all passed throughout.

What filled it: **57GB of pnpm store under `/root/.local/share/pnpm`**
(deploy.sh installs as root; the store had never been pruned) plus **10.8GB of
uv cache** under `/home/callback/.cache/uv` (repeat offender from Aug 4).
Cleaned by hand 2026-08-28: `pnpm store prune`, `uv cache clean` (as callback,
with `-H` — bare sudo trips on `/root/uv.toml`), HF hub cache. 58G free after.

## What to build

1. **Caches don't accumulate:** `pnpm store prune` (and `uv cache clean`, if
   uv is part of the deploy's tooling) runs in deploy.sh after installs — or a
   weekly schedule; deploy.sh is the natural home since deploys are what grow
   the store.
2. **Disk-space health check:** hub `/healthz` reports disk free and answers
   degraded below a threshold; deploy.sh's verification fails loudly on low
   disk BEFORE installing (a deploy onto a full disk makes things worse);
   `cb doctor` checks it. A near-full disk must be an alert someone sees, not
   a latent truncation.
3. Diagnosis detail worth encoding: curl exit 92 / truncated transfers of
   hashed assets through the edge with healthy small responses = check disk
   first.
