---
title: "The dev router is load-bearing, and the obvious way to harden it would make outages worse"
workstream: unattached
area: router
labels: [router, availability, dev-machine]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-router-resilience — while planning the 2026-09-15 outage fixes
design: ../../beebox/docs/plans/router-transient-failure-resilience.md
---

One dev router on port 3210 fronts every checkout and every box on this machine,
runs in a terminal under no supervisor, and is the path the boxholder's phone
takes to a dev box. On 2026-09-15 a single worktree's startup timeout took every
box under `main` offline for three hours, the phone included.

`docs/plans/router-transient-failure-resilience.md` makes that failure rarer and
makes it diagnosable. It does not make the router less load-bearing, and the
boxholder asked directly whether it would. It does not, in three distinct ways.

## 1. A router restart kills every worktree, so supervision alone is a trap

The obvious hardening is a supervisor (launchd) so the process comes back. As
the boot path stands, that would convert one failure into a worse one.

`sweepStaleChildren` (`workstreams-app/src/router/router-real-effects.ts:179-193`)
walks the pidfile directory and **kills** every tracked child it finds alive:

```
log(`sweep: killing leftover pid ${pid} from ${file}`);
process.kill(-pid, "SIGTERM");
```

So a restarted router does not resume serving; it tears down every running
worktree and then cold-starts each one on its next request — simultaneously,
because a supervisor restarts during whatever caused the crash. Simultaneous
cold starts under load is precisely the failure the plan above is written to
prevent. Supervision is only an improvement after the sweep learns to adopt.

Adoption looks feasible rather than speculative: `PidRecord`
(`workstreams-app/src/router/router-pidfile.ts:19-30`) already carries `name`,
both child pids, all three ports, `socketDir`, and `profileDir` — nearly the
whole of `ReadyLifecycle`, with `browseEnv`, `logFile`, and `sourceToken`
derivable from configuration. A liveness probe against the recorded ports would
distinguish a generation worth adopting from one worth killing. Whether the
generation guards (`bin/docs/router-protocol.md`, invariants 1 and 5) survive an
adopted handle that no `startWorktree` ever created is the real design question,
and it is not answered here.

## 2. The blast radius is the whole machine, by construction

One router, every worktree, every box. Nothing in the resilience plan narrows
that, and nothing should: the router is a dev-loop convenience and a single
front door is most of its value.

## 3. The phone is paired to the dev router, which may be the actual mistake

`docs/mobile-contract.md:21-23` records the shape: *"A paired box's `baseURL`
already includes the hub slug (e.g. `http://127.0.0.1:3210/main/test1` in dev,
`https://host/<slug>` in prod)."*

So a phone paired to a dev box depends on the dev router, while a phone paired
to a deployed box does not. The router carries first-class mobile plumbing to
support this — bearer-to-session exchange and `bbx_mobile` cookie-path rewriting
for `/<worktree>/<slug>/`
(`workstreams-app/src/router/router-mobile-bootstrap.ts`,
`router-cookie.ts`) — so it is a supported path, not an accident of
configuration.

It sits oddly beside a shipped invariant. Track A of
`docs/implemented-plans/tailscale-expose-and-protect.md:232-238` states *"The
router is never a valid target"* for Tailscale exposure, and enforces it
structurally by probing for the `/__router/status` signature and refusing on
match. Remote access is supposed to reach a dedicated auth-gated `bbx serve` or
`bbx hub`. Whether the phone reaching a dev box through the router is a
deliberate dev-only exception or drift from that invariant is not recorded
anywhere, and it decides how much the other two items matter: if the boxholder's
daily-driver box moved off the dev router, a dev-router outage would stop
reaching the phone at all, and the router would go back to being a dev tool
whose failure costs a reload.

## The decision this needs

Not "harden the router" — that is the plan above, and it is already scoped. The
question is which of these the boxholder wants, and in what order:

- **Adopt-on-boot**, which is a prerequisite for supervision meaning anything.
- **Supervision**, only after adoption.
- **Move the phone's daily-driver box off the dev router**, which is the only one
  of the three that reduces what depends on the router rather than making the
  router sturdier.

The third is the one that would actually answer the question, and it is a
decision about how the machine is used rather than a code change.
