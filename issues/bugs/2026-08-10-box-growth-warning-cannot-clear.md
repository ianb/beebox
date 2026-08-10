---
title: "Box-growth warns forever on a box with an email connector, and is blind to the box's biggest bytes"
workstream: box-family-email
area: callback-box
filed-by: agent
discovered-in: worktree-box-family-email — investigating growth on a production box
labels: [code-error]
---

Three separate problems in `callback-box/src/core/box-growth/`, found together
on one production box. They compound: the check cries wolf about the wrong
thing while missing the real thing.

## 1. The absolute thresholds are below a legitimate Gmail box

`BOX_GROWTH_THRESHOLDS` (`policy.ts:11`) sets `absoluteDirectories: 250` and
`absoluteFiles: 1_000`. One Gmail account with 530 archived threads produces
1,562 directories and 2,322 files under `box/inbox/email` by itself — a thread
card, a `.attach/` dir, a `msg-NNN.attach/` dir per message, and an
`attachments/` dir under that. The observed box sits at 1,776 directories and
3,453 files and is growing by roughly two files a day.

So the check fires a permanent warning naming `box/inbox/email` as largest
contributor. The message reads as an alarm about email growth when what it
actually reports is a level, not a rate. No rate finding is firing on that box
— the rate thresholds are fine.

## 2. `acknowledgedAt` can never engage when the first measurement is large

`absoluteThreshold` (`policy.ts:35`) returns the global threshold whenever
`acknowledgedAt` is null, and only then falls back to `accepted × 2`. But
`measureBoxGrowthIfDue` (`health.ts:202`) writes `acknowledgedAt: null` for a
first measurement that is already above the global threshold:

```ts
acknowledgedAt: isAboveGlobalThreshold(measurement) ? null : measurement.measuredAt,
```

That is the intended prompt-the-human design, but it means any box that is
already large when monitoring first runs starts in a warning state that cannot
clear by itself no matter how much the box shrinks. The observed box's baseline
was captured mid-anomaly at 144,425 files; the box has since dropped to 3,453
and the warning is unchanged, because 3,453 is still above the 1,000 global.
The only exit is the `acknowledge-box-growth` action — which, if the boxholder
takes it, also silently blesses whatever the baseline happened to catch.

## 3. The scan prunes `.callback-box`, which is where the bytes are

`findArguments` (`scan.ts:107`) prunes `.git`, `.callback-box` and
`node_modules`. On the observed box `.callback-box` is 193 MB against 415 MB of
content — the single largest thing in the box, and entirely invisible to the
growth check. 165 MB of it is one stale `search-index.json` (see
[low-priority-jobs-wedge-wakeup-forever](2026-08-10-low-priority-jobs-wedge-wakeup-forever.md)).

Related: the measurement has no byte dimension at all. It counts files,
directories, commits and git object bytes, but never content bytes, so a box
whose file count is flat while its bytes climb reports healthy. Given that
prod disk hit 100% on 2026-08-04, bytes are the dimension that actually hurts.

## A fourth symptom worth the same fix

Directory count has an operational consequence the growth check does not
mention. `MAX_WATCHED_DIRS` is 1,024
(`callback-box/src/core/box/file-watcher.ts:48`); the observed box exceeds it
and logs, on every server start since 2026-08-05:

```
[box-watcher] directory watch limit of 1,024 reached for <box>; live updates below <path> are disabled
```

No other box on the server logs it. Live updates are silently off for part of
the email tree. If the growth check's directory threshold has a defensible
number behind it, this is probably it — but 250 is not that number either.

## Directions (unsettled)

- Separate "this box is large" from "this box is growing". A level warning that
  can never clear trains the boxholder to ignore the surface. Possibly: report
  level once at baseline, then only ever warn on rate.
- Scale the absolute thresholds to what the box's enabled connectors imply,
  rather than one global pair.
- Measure bytes, and stop pruning `.callback-box` (or measure it separately and
  report it as engine overhead rather than box content).
- Tie the directory threshold to `MAX_WATCHED_DIRS` so the warning predicts a
  real degradation instead of an arbitrary one.
