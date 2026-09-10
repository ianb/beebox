---
title: "The hub never exits on SIGTERM — every deploy takes the full 60s stop timeout and ends in SIGKILL"
workstream: unattached
area: beebox
priority: important
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
[deploy-restart 502s](../closed/bugs/2026-09-09-deploy-restart-502-surfaces-as-json-parse-error.md)),
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
[deploy-restart 502s](../closed/bugs/2026-09-09-deploy-restart-502-surfaces-as-json-parse-error.md)
hides the symptom; it does not stop the outage or the killed children.
