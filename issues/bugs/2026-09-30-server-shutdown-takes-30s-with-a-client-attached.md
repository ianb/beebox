---
title: "`bbx engine serve` takes ~30 s to exit on SIGTERM while a browser is attached; a supervisor that kills sooner leaks a box-work lease"
workstream: unattached
area: beebox
labels: [install]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-installable-app — Mac spike app restarts
---

Observed 2026-09-30 in the Mac spike app (`mac-app/`), which sends SIGTERM
and waits before tearing down the VM:

- Box with no browser attached: "Server closed." 0.3 s after SIGTERM.
- Box with a signed-in browser on the chat page (a session loaded, no turn
  run): the server printed "Received SIGTERM, shutting down..." and exited
  33.2 s later.

The shutdown path is `shutdown` in `beebox/src/webapp/server/app.ts:331`:
remove pid files and serve endpoints, `closeAllConnections()`, then
`await server.close()` (Fastify close hooks), then `drainBoxGitLocks`. A
~30 s wait with a client attached points at a close hook or an open
WebSocket rather than the git drain. Not yet traced.

Why it matters: a supervisor with a shorter timeout (the spike app used
20 s; container runtimes and systemd have their own) SIGKILLs the server.
Its box-work lease in `.git/bbx-maintenance/work/` then stays behind, and
the next start's maintenance step waits for the lease to go stale
(`LOCK_STALE_MS.default`, 5 min, `beebox/src/lib/file-lock.ts:189`) with
no output, which looks like a hang. `docker compose stop` defaults to a
10 s timeout before SIGKILL, so the container install likely hits this on
every restart with a browser open.

A similar symptom in the hub was fixed earlier:
[hub-shutdown-hits-the-sigterm-timeout](../closed/bugs/2026-09-09-hub-shutdown-hits-the-sigterm-timeout.md).
Check whether the box server has the same cause.

## Controlled test (2026-09-30)

Same box, same image, SIGTERM sent after the server was ready:

- No browser attached: server exited 0.0 s after SIGTERM.
- A signed-in browser on the box (no chat turn, no pending work): exited
  30.0 s after SIGTERM.

So the slow stop follows an attached client, not pending work. Lead, not
yet verified: the tRPC WebSocket keepalive pings every 30 s
(`beebox/src/webapp/server-box-scope.ts:232`, `pingMs: 30_000`), and
`closeAllConnections()` closes HTTP connections but not upgraded
WebSockets, so `server.close()` may wait until the next keepalive cycle
drops the socket. Closing open WebSocket clients explicitly at shutdown
would test it.

## To reproduce

Serve a box, open its chat page in a browser, send SIGTERM to the server,
and time "Received SIGTERM" to "Server closed.".
