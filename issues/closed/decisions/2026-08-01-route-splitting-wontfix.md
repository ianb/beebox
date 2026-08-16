---
title: Route-level code splitting — decided not now (wontfix)
workstream: unknown
resolution: wontfix
---

Decided 2026-08-01 (boxholder + measured analysis): do NOT implement
route-level code splitting in the frontend, despite a working prototype
showing 457→287 KB gzip initial (−37%).

The full plan, measured prototype numbers, corrected deploy-cache economics,
and the trigger conditions that would reopen this live in
`../../../callback-box/docs/plans/route-splitting.md`. Summary of the call:

- Chat — the primary entry path — gains nothing (−7% bytes, +1 serial fetch
  stage on cold loads; a wash or slightly negative).
- The −35% applies only to cold entries on secondary pages (dashboard is "a
  corner of the app").
- The deploy-cache benefit is modest once computed correctly (the entry
  chunk re-hashes with any route change → ~287 KB re-download per frontend
  deploy, not tens of KB).
- Shipping it properly requires a deploy-atomicity fix first (`deploy.sh`
  rsync `--delete` window).

Reopen if a trigger in the plan fires: phone/secondary-entry cold loads
become a felt complaint, PWA/offline work makes per-chunk caching
structural, deploys become frequent enough for the re-download reduction to
matter, or the renderer-registry rework gets independently justified.

One orphaned piece worth landing regardless: the prototype's
`CB_ANALYZE_FINE=1` per-file attribution mode for `analyze:bundle`
(diff preserved in the analysis worktree's scratch/).
