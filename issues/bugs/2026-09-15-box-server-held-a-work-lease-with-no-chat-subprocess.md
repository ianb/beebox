---
title: "A box server held one work lease for 90 minutes with no chat subprocess alive"
workstream: migration-admission-cost
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-migration-admission-cost — inspecting the gate directory of the box in the sweep-closes-admission incident
---

The drain that shut a local box for ten minutes was waiting on one work lease
held by the box's own `bbx serve`. That lease stayed held from 00:01:54 to at
least 01:26:54 (guard refreshed), while `pgrep -P <serve pid>` listed no child
process: no SDK chat subprocess existed for most of that window. The holder
was never identified; the server was restarted at 01:30 before an inspector
could attach.

## What is known

- One lease file for the serve pid, `acquiredAt` 00:01:54, the moment of a
  chat send. Five other lease files were dead-pid sidecars from finished
  `bbx` children; `scanLocks` reclaims those and they did not block.
- A process lease is held while any in-process admission is outstanding
  (`src/lib/box-maintenance.ts`, count on 0→1 / 1→0), so one leaked release
  anywhere in the server keeps the box undrainable until restart.
- The server's maintenance poll (`src/webapp/server.ts`, `quiesceForMaintenance`)
  closes idle chat runs within a second of a phase appearing. It did not free
  this lease, so either a session read as busy the whole time or the lease was
  not a chat run's at all.
- No server log was retained: the box's stdout went to a terminal.

## Candidates, unverified

- A chat run whose SDK subprocess exited without the message pump completing
  (`src/services/claude-chat.ts`, the `for await (const msg of q)` loop): the
  run lease is released in `consumeMessages(...).finally`, which never runs if
  the iterator never ends.
- An HTTP request lease (`src/webapp/box-admission.ts`) whose release did not
  fire on an unusual reply path.

## What changed since

Every admission now records a reason in the lease sidecar, and a drain
timeout names the holders (workstream `migration-admission-cost`). The next
occurrence identifies itself in the schedule's alert and in the closed-box
message. The scheduled sweep no longer drains against a held lease, so a leak
now surfaces as a "held work for Nh" deferral report rather than an hourly
lockout; a deploy drain still fails on it after ten minutes, naming it.

## Next step

When the report names a holder, trace that release path. If it is the chat
run pump, bound the wait on a dead subprocess (process exit should end the
iterator) and release the lease on exit.

## Resolution (2026-09-16)

Two candidates were tested; one is ruled out and one is a reproduced leak.

- SDK iterator on a dead subprocess: ruled out. A stub CLI exiting 0, exiting 1,
  dying by SIGKILL, and exiting silently before any output all end
  `query()`'s iterator within ~450 ms (SDK 0.3.268), so the run lease's
  `finally` runs.
- HTTP admission on an abandoned request: reproduced. `registerBoxAdmission`
  released a request's lease on handler return, on the response's `finish`,
  or in `onResponse`. A client that drops the connection before any reply —
  a phone losing its link mid-upload, a tab closed during a slow POST — fires
  none of those, and the lease stayed held until the server restarted. The
  doctest `test/webapp/box-admission.doctest.md` ("A request the client
  abandons releases its lease") failed against the old code and passes now:
  `releases` is registered before acquisition, an `onRequestAbort` hook
  releases when no handler is running, and a lease acquired after the abort
  is released on the spot.

Whether that was the incident's holder cannot be confirmed: the process was
restarted before inspection. It is the only reachable path found that leaves a
lease with no subprocess and no handler, and every admission now records its
reason, so a different holder will name itself in the next drain report.
