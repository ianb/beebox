---
title: "iOS hard crashes leave no record of why — adopt MetricKit and forward the diagnostic on next launch"
workstream: unattached
area: ios-app
priority: important
needs: [design]
labels: [ios, diagnostics, crash]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "I've noticed some iOS hard crashes. The app just disappears. Sometimes it repeats, but eventually works out for no reason."
---

The app terminates with no warning. It sometimes repeats and then stops on its
own, which is the signature of a resource-pressure kill rather than a
deterministic bug — the same input succeeds once the pressure passes.

**Nothing in the app records why.** A search across `ios-app/` finds no
`MetricKit`, no `MXMetricManager`, no `NSSetUncaughtExceptionHandler`, and no
signal handler. The only diagnostics are `BoxLog` lines the app chose to write
*before* dying, so the cause of the termination itself is never captured.

## The mechanism the boxholder asked for already exists

"Maybe when the app restarts it could upload logs in this case?" — that half is
built. `LogForwarder` keeps a **persisted, bounded queue** at
`log-forwarder/queue.json`, writes it atomically before an enqueue returns, and
flushes opportunistically to each paired box. Its own docstring: persistence is
the guarantee, the network flush is opportunistic, and an entry "survives a
suspension, a kill, or a crash and lands on the box at the next" flush.

So the missing piece is not delivery. It is that **nothing produces a record of
the crash to deliver.**

## MetricKit is the Apple-sanctioned source, and it fits this shape exactly

`MXMetricManager` delivers payloads to a subscriber **on the next launch** —
the same restart-and-upload flow already in mind. Two payload types matter:

- **`MXCrashDiagnostic`** — exception type, termination reason, signal, and a
  call stack tree, for an actual crash.
- **`MXAppExitMetric`** — counts of *why* the app exited, including
  `cumulativeMemoryResourceLimitExitCount` (jetsam) and watchdog exits. This is
  the one that matters here: **a memory kill produces no crash report at all**,
  so without this metric a jetsam termination is indistinguishable from the app
  vanishing for no reason. Given this app runs a `WKWebView` plus audio capture
  and media, jetsam is a leading hypothesis.

A subscriber attaches in `BeeBoxAppDelegate.application(_:didFinishLaunchingWithOptions:)`
and each received payload becomes `LogForwarder` entries, which then ride the
existing queue to the box.

## What needs care

- **Forwarded content is governed.** `BoxLog`'s message discipline is explicit:
  metadata only — ids, counts, sizes, status codes, `URLError` values, error
  text from the box or Foundation; never transcript or composer text, media
  bytes, or auth values. A crash call stack is frames and addresses, which
  fits, but whatever is extracted must be filtered deliberately rather than
  serialized wholesale.
- **The queue is bounded** and evicts, leaving a synthetic marker when it does.
  A crash payload is large next to a log line; decide whether it competes for
  the same bound or gets its own budget, so a diagnostic cannot silently push
  out the very lines leading up to the crash.
- **It only reports the PREVIOUS run.** Nothing arrives at the moment of death,
  so the boxholder sees the cause after the next launch — worth saying in
  whatever surfaces it, or it reads as stale.
- **MetricKit needs a real device and real time** — payloads arrive roughly
  daily, and simulators do not produce them. Verification is inherently a
  device exercise, and the boxholder is the only one who can do it.
- **Consider `MXMetricManager.pastPayloads`** on launch so the first run after
  adoption still reports what is already on file, rather than waiting for the
  next delivery window.

## Worth pairing with

A crash also loses the web side. `webViewWebContentProcessDidTerminate` already
exists in `ChatWebView.swift` and its comment notes the transcript, session
state, and every pending native emission go with it — that is a *related*
disappearance with a handler that could report through the same path.
