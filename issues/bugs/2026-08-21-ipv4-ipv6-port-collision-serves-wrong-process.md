---
title: "A box can be handed a port another process already holds, because IPv4 and IPv6 binds don't collide — the hub then proxies to the wrong process"
workstream: unattached
area: router
labels: [router, ports, process-lifecycle]
filed-by: agent
discovered-by: Ian
discovered-in: main session — a box served an unrelated app's shell on both web and iOS
priority: backlog
---

A box was unreachable in two different ways at once: on iOS it returned the
plain-text `Mobile session bootstrap failed.`, and in a browser it logged in
fine and then showed an empty app. Other boxes on the same router were fine.

Neither symptom was about the box. Its port was being answered by a different
process.

## Two listeners, one port, no error

```
node  22902  IPv6  [::1]:58710      (LISTEN)   ← the box's `cb serve`
node  63235  IPv4  127.0.0.1:58710  (LISTEN)   ← an orphaned Vite
```

**Both binds succeeded because they are in different address families.** A
process holding `127.0.0.1:<p>` does not stop another from binding
`[::1]:<p>`, so neither side saw `EADDRINUSE` and nothing logged a conflict.
The hub then connected over IPv4 and reached the squatter instead of the box.

That explains both symptoms exactly:

- **Web** — the browser got the other app's shell instead of the box, which
  renders as "logged in but empty".
- **iOS** — the router's mobile bootstrap POSTs to
  `/<box>/api/pairing/session` and requires a `204`
  (`bin/router-mobile-bootstrap.ts:73`). The squatter answered something else,
  so `bootstrapMobileSessionCookie` returned null and the router replied `401
  Mobile session bootstrap failed.` (`bin/router.ts:568-570`). The 401 path
  does **not** log — only the 502 throw path does — so the router log was
  silent.

## The squatter was a two-day-old orphan

The offending process was a `workstreams-app` Vite with **`ppid=1`**, started
two days before the current router. The live router had its own healthy
`workstreams-app` child, so the orphan was serving nothing — it was purely
holding a port number.

`bin/process-cleanup.ts` exists for exactly this ("vite/fastify orphaned to
PID 1"), and the router sweeps on startup, yet this survived at least one
router restart. Worth finding out why: whether the pattern doesn't match
`workstreams-app`'s Vite, whether the live-agent guard spared it, or whether
the sweep simply never ran in the window that mattered. **An orphan that
survives is not merely stale — it can silently take a port a later box needs.**

## Why port allocation didn't prevent it

Ports come from `get-port`. A probe that checks one address family will call a
port free when the other family is occupied, and hand it out. The consumer then
binds the free family, succeeds, and the two coexist — with whichever family
the *proxy* dials deciding who answers.

Note the healthy case looks different: after a clean respawn, the box bound
**both** `127.0.0.1` and `[::1]` on its new port. So the single-family bind in
the failure is itself a symptom of the other family already being taken.

## Fix directions

- **Probe and bind both families.** If allocation checked (and ideally the
  server bound) IPv4 and IPv6 together, a partially-occupied port would be
  rejected as unavailable and the collision could not form.
- **Make the box's listener explicit** rather than letting `localhost` resolve
  per-process — the proxy and the child must agree on a family by construction,
  not by coincidence.
- **Verify identity after allocation.** The hub could confirm the process it
  proxies to is the box it spawned (a health/identity check on first proxy).
  The dev bundle already stamps child identity (`CB_DEV_BUNDLE_ID`), so there
  is precedent for "prove you are who I started".
- **Log the 401 bootstrap path.** A failure that returns a user-visible error
  while writing nothing to the log cost most of the diagnosis time here.
- **Close the orphan gap** so a dead generation cannot outlive the router that
  spawned it.

Related: an earlier port race the same week — three parallel `getPort()` calls
returning sequential ports, letting Vite's port-walk land on the hub's port —
was fixed by adding `--strictPort` to the Vite spawn (`bin/router-core.ts`).
Same family of defect (allocation not actually reserving), different mechanism.

## What was done

Killed the orphaned generation and restarted the box's `cb serve` child; it
respawned on a fresh port bound to both families and served normally. That is a
one-off repair, not a fix — nothing stops the collision recurring.
