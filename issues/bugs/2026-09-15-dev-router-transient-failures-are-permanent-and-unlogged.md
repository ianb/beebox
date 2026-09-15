---
title: "Dev router: a transient startup failure is permanent, and nothing about it is logged"
workstream: router-resilience
area: router
priority: important
filed-by: agent
discovered-by: Ian
discovered-in: main — a worktree died under test-suite load and stayed dead for three hours
---

The dev router turns a momentary load spike into an outage that lasts until a
human notices, and it keeps no durable record of any of it. Three defects share
that surface. The second and third were each found while investigating an
unexplained failure the third would have explained in seconds.

## 1. A `waitForHttp` timeout parks the worktree forever

The hourly `full-suite` schedule was mid-run (it filed at `17:52:28Z`) when the
`main` worktree restarted. A cold Vite could not answer `GET /main/` inside the
fixed 30-second budget:

```
[router 2026-09-15T17:16:44.460Z] [main] frontend=61769 backend=61770 dashboard=61771 base=/main/
[router 2026-09-15T17:16:44.693Z] [main] dashboard ready on :61771
[router 2026-09-15T17:33:03.842Z] [main] startup failed in waitForHttp: vite/main did not respond to HTTP GET /main/ within 30000ms
```

Every box under `main` then served 502 for about three hours. Not one box — all
of them, plus the iOS app, which is how it was noticed. The machine was not out
of file descriptors (15,352 open against a 122,880 limit); it was out of CPU,
with a 15-minute load average still at 8.90 well afterwards.

`ensureRunning` (`workstreams-app/src/router/router-core.ts:89`) does this on
purpose:

```ts
// Failed worktrees stay failed until the user explicitly retries (via the
// /__router/retry/<name> endpoint). Auto-restarting on every page-fetch
// would mask the failure and burn CPU / log noise — a broken worktree
// should *look* broken, with the captured error visible.
const failed = failedLifecycle(existing);
if (failed) throw statusError(failed.lastError.message, 502);
```

That is correct for a deterministic failure — a bad config, a syntax error —
where restarting in a loop would hide a real break. It is wrong for a stopwatch
losing to machine load, and the state machine cannot tell the two apart even
though the data is already there: `router-worktree-start.ts:274` records
`progress.failurePhase = "waitForHttp"` before the wait.

A bounded retry with backoff for the `waitForHttp` phase only, parking as
`failed` afterwards exactly as today, keeps the stated intent for everything
genuinely broken. Unbounded retry is not wanted; the repo's rule is that
nothing retries forever, and a stranded terminal state must stay visible.

The timeout is the secondary lever. A fixed 30 s on a machine that deliberately
runs a six-way parallel suite every hour is two settings in conflict, and the
suite wins. `beebox/.taprc` already documents the scale of the distortion:
`hub-e2e` measured 8.4 s solo against 110.8 s loaded.

Recovery, for the record, is `POST /__router/retry/<name>`, which works over the
UDS without an owner session and restored the worktree on the first probe:

```
curl -X POST --unix-socket ~/.cache/beebox/router.sock http://localhost/__router/retry/main
```

## 2. The mobile session bootstrap does not survive a restart race

Earlier the same day, an iOS request got `Mobile session bootstrap failed`. The
box child had been replaced 30 seconds into its life, so the bootstrap POST went
to a dying port. The device token was fine — `mobile-devices.secret.json` was
written a minute later when the retry succeeded, and `deviceStore.verify()` only
writes `lastUsedAt` on success.

The bootstrap sits inside the `for (;;)` loop in `router-proxy.ts` whose own
comment describes exactly this case: *"after a kill/restart race the worktree's
new generation listens on different ports, so retrying the original target would
hammer a dead port."* The loop re-resolves the handle every attempt. The
bootstrap uses none of it — a `null` result writes 401 and returns.

Worse, `bootstrapPending` is set to `null` **before** the attempt, so a retry
would skip the bootstrap and proxy the request with no session cookie, which
fails more quietly than the error above.

The message also flattens every non-204 into one string. The box distinguishes
its cases — its own 401 says "Mobile device token is invalid or revoked" — so a
transient port race is indistinguishable from a dead pairing.

## 3. Nothing the router does is written down

```
grep -c "frontend=.*backend=.*dashboard=" ~/.cache/beebox/logs/main.log → 0
grep -c "\[router "                        ~/.cache/beebox/logs/main.log → 0
```

`router-config.ts:122` is a bare `console.log`. Every `[router …]` line exists
only in the terminal scrollback of whoever ran the router, so the line that
explains the outage above had to be pasted in by hand.

Auth denials are worse: `deny()` (`router-auth.ts:383`) is a pure function that
returns a decision and logs nothing, so a refused request leaves no trace at
all. Of the two failure paths in the bootstrap above, only the 502 exception
branch logs; the 401 branch is silent.

This is the defect that made the other two expensive. Three failures in one day
were diagnosed from a file mtime, a box child log, and a hand-pasted console
line, and one of them is still unexplained.

## Still unexplained, and blocked on 3

An iOS request reported `owner-session-required`. That reason can only be
produced by `classifyRouterRoot` for the bare root `/`, for `/__router/*`, or
for a non-read `/dev` — verified by running `classifyRouterRoute` over the
candidate paths. Every legitimate box path, including `/main/hearth-test/` and
`/main/hearth-test/chat`, classifies as `box`, whose denials read
`target-box-unresolved` or `box-auth-required`. So something requested a
non-box path, and there is no record of what. It probably shares a root cause
with the outage above, since the worktree was unstartable at the time.

## The coupling underneath

The suite does not run *through* the router; `full-suite` builds its own temp
checkout. What they share is one machine and one CPU budget, and the router
converts contention into a permanent failure. Nothing declares that
relationship, which is why the failure reads as unrelated to the thing that
caused it.
