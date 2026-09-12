---
title: "The hub never exits on SIGTERM — every deploy takes the full 60s stop timeout and ends in SIGKILL"
workstream: unattached
area: beebox
priority: important
resolution: implemented
labels: [deploy, hub, lifecycle]
filed-by: agent
discovered-in: main session — found in the journal while explaining a 502 during a deploy
---

From the prod journal, a routine restart:

```
14:13:12  Stopping beebox-hub.service...
14:13:12  Received SIGTERM, shutting down hub...
14:14:12  beebox-hub.service: State 'stop-sigterm' timed out. Killing.
14:14:12  Killing process 363963 (MainThread) with signal SIGKILL
14:14:12  Killing process 417940 (claude) with signal SIGKILL
14:14:12  Killing process 417963 (claude) with signal SIGKILL
14:14:12  beebox-hub.service: Failed with result 'timeout'.
```

The hub logs that it received the signal and then never exits, so systemd waits
the full stop timeout and SIGKILLs the whole control group — including agent
children mid-turn. Every deploy therefore has a guaranteed ~60s window where
the site returns 502 (see
[deploy-restart 502s](2026-09-09-deploy-restart-502-surfaces-as-json-parse-error.md)),
and any running agent session dies uncleanly rather than being drained.

## What to find out

- **What holds the process open.** Candidates: box child processes not being
  signalled or awaited, open WebSocket connections keeping the server's
  `close()` pending, or a keepalive/interval never cleared. `Received SIGTERM`
  is logged, so the handler runs — it's what comes after that stalls.
- **Whether agent children should be drained or refused.** Killing a `claude`
  child mid-turn loses work; the honest options are a short drain, or refusing
  new turns and finishing in-flight ones within the stop timeout.
- **Whether the restart can be made overlapping** so there's no 502 window at
  all — a bigger change, and worth deciding only after the hang is fixed.


## Second occurrence, 2026-09-10

Same shape, one day later: SIGTERM 16:26:05, still alive at the 60s stop
timeout, SIGKILL of the control group at 16:27:05 — this time taking two
`claude` processes and an `esbuild` with it. The visible consequence was the
app bar's place-switch menu failing for the boxholder mid-session.

Raised to `important`: two user-visible failures in two days, plus agent
sessions killed mid-turn on every deploy. The frontend retry work in
[deploy-restart 502s](2026-09-09-deploy-restart-502-surfaces-as-json-parse-error.md)
hides the symptom; it does not stop the outage or the killed children.


## Fixed 2026-09-12

`server.close()` was the hang. It stops accepting new connections and then
waits for every EXISTING one to end — and the hub serves WebSocket upgrades
(a chat tab holds one open for as long as it is open) plus keep-alive HTTP, so
the callback could never fire. `cli/commands/hub.ts` awaited exactly that:

```ts
await new Promise<void>((resolve) => server.close(() => resolve()));
await supervisor.stopAll();
```

**The second line is the part that mattered.** `supervisor.stopAll()` SIGTERMs
each box child and waits for it, and its own comment says why: "the hub must
not exit while a box child is still finishing a git write… a git killed
mid-index-write leaves the box unable to commit at all." Because the close
never resolved, **that never ran on any deploy** — systemd's `KillMode=mixed`
plus the expired `TimeoutStopSec=60` SIGKILLed the whole control group instead,
killing box children abruptly rather than draining them. So this was a
data-integrity risk, not only a 60-second outage.

Now `closeServer()` stops accepting, ends idle connections immediately, forces
the remainder after a 2s linger window (`closeAllConnections()`), and races an 8s
deadline as a backstop — so `stopAll()` always gets its turn, with its own 30s
box-kill budget, comfortably inside the 60s budget.

One thing learned while testing and recorded in the doctest:
`closeIdleConnections()` does NOT end a WebSocket, nor a socket that connected
without sending a request — neither is "idle" by Node's reckoning. The forced
close is what actually does the work, which is why the linger window is short.

`test/hub/hub-shutdown.doctest.md` reproduces the original hang — a real
listening server with a client socket held open — and asserts the close is
bounded and does not reach the deadline. The hub suite (e2e, router, config)
stays green.

**Unverified on prod.** The next deploy is the real test: the journal should
show the hub exiting on its own rather than `State 'stop-sigterm' timed out.
Killing.`, and no `claude`/`esbuild` children in the kill list.
