---
title: Hub blocks on startAll() before it listens, so /healthz is unanswerable during a slow/failing boot
workstream: unknown
---

`src/cli/commands/hub.ts` does `await supervisor.startAll()` *before*
`createHubServer(...)` + `listen`. On a lazy hub `startAll` runs `prestartLazy`
(and awaits each pre-started box's readiness); a failing box launch blocks up to
`READY_TIMEOUT_MS` (30s, `src/hub/child-spawn.ts`) before giving up. So the hub
does not answer `/healthz` at all for ~30s+ *precisely when a box is failing* —
which is what raced the deploy's old 30s healthcheck during the 2026-07-16 ABI
incident.

The healthz-aggregation work
([design](../../callback-box/docs/implemented-plans/hub-healthz-box-aggregation.md)) worked
around this by bumping the deploy poll to 180s. The cleaner fix is to `listen`
first and start boxes after — but a hub answering *before* pre-start finishes
reports every box `stopped`, which a naive deploy check would read as a vacuous
pass. That needs an explicit "boot complete" / "still pre-starting" state on the
health verdict so a caller can distinguish "booting" from "idle". Deferred from
that plan as its own decision: is the readiness state worth adding, or is the
180s window good enough?
