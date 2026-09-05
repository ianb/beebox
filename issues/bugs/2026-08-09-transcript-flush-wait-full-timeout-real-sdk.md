---
title: "Transcript durability gate hits its full 5s timeout on both turns of a real-SDK doctest"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: weekly manual-test triage — 2026-08-09T151705Z run, repo 508f42cc
labels: [manual-tests]
priority: normal
---

`test/manual/chat-queue-real.doctest.md` (real `claude` SDK process, not the
fake backend) logged the durability-gate warning from
`beebox/src/core/chat/session/transcript-sync.ts` on **both** of its two
turns:

```
[chat-session] transcript flush wait timed out for entry 49ccd9db-... (session 1900a730-...);
an immediate history fetch may miss the turn's final message
[chat-session] transcript flush wait timed out for entry cfa5b569-...(session 1900a730-...);
an immediate history fetch may miss the turn's final message
```

Full log: `logs/manual-tests/2026-08-09T151705Z-76179.log` (lines 35, 39). Exit
status 0 — the doctest still passed, because `waitForTranscriptEntry` is a
best-effort wait, not a gate the turn is failed on
(`transcript-sync.ts:58-60`).

Why this is suspicious rather than benign: `waitForTranscriptEntry` polls
every 30ms up to `WAIT_TIMEOUT_MS = 5_000`, and the file's own doc comment
says the measured CLI flush lag is ~150ms — "the cap only bites if the CLI
misbehaves." Two out of two turns running the full 5s bound (not landing
somewhere in between) is a ~33x miss on that assumption, and reads more like
"the entry is never found" than "the flush is just slow." This session was
root-bound (no landmark `contextDir`), so `resolveSessionLogPath` should
reduce to the plain `getSessionLogPath(boxRoot, sessionId)` path with no
lookup dependency — that rules out the most obvious path-mismatch
explanation, but wasn't traced further.

Candidates worth checking when this recurs:
- Whether the polled tail file genuinely never contains the `uuid`, or
  whether it does and the string match fails (e.g. real transcripts formatting
  the `uuid` key differently than the fixture-built ones in
  `chat-session-transcript-sync.doctest.md` assume).
- Whether this machine's load (concurrent Claude/Codex processes — see
  [run less of the test suite](../closed/exploration/2026-08-08-run-less-of-the-test-suite.md)
  for the same environment's contention profile) is inflating the real CLI's
  flush latency well past 150ms, in which case the fix is a larger timeout or
  a different gating strategy, not a code bug.

This is the first logged run of the new weekly manual-test job (prior
`logs/manual-tests/launchd.log` is empty), so there's no baseline to say
whether this is new or has always been the case on this machine. Re-check
next week's log for recurrence before assuming a regression.

## 2026-08-16 recurrence

Same warning fired on both turns again, in the same doctest, still on exit
status 0 (test still passes). Run log:
`logs/manual-tests/2026-08-16T151700Z-53382.log` (lines 35, 39), repo
`39752043`. `WAIT_TIMEOUT_MS` is still 5s and the warning text is unchanged
in `beebox/src/core/chat/session/transcript-sync.ts:29,129`. Two
separate weekly runs, both two-for-two on the full timeout, rules out a
one-off fluke — this now looks like a standing condition on this machine
rather than an isolated slow poll. Still unconfirmed which of the two
candidate explanations above applies.

## 2026-08-23 recurrence

Third consecutive weekly run, same shape: warning on both turns of
`chat-queue-real.doctest.md`, exit status still 0. Run log:
`logs/manual-tests/2026-08-23T151704Z-74009.log` (lines 35, 39), repo
`b6171b95`. Entry UUIDs `e03a5ab0-51a6-49cc-9ea8-a1ef8fe97c04` and
`85dfeaf2-738a-4251-af2a-92607403b017`, session
`1a8b1b44-d384-4b56-9be0-fa42c49d0c30`. Three-for-three across three weeks
confirms this is a standing condition, not noise — still unconfirmed which
of the two candidate explanations above applies.
