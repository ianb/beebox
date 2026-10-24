---
title: "Box-local day, elapsed-time text, and duration parsing each have several implementations"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-backend — backend pass of the functional-duplication sweep
resolution: implemented
---

Closed 2026-10-23 (worktree-dup-sweep-backend), plan `beebox/docs/implemented-plans/dup-sweep-backend-final.md`. Box-local day: `localDay` (`beebox/src/shared/local-day.ts`), `boxTimeZoneOrHost` (`core/box/config.ts`) and `boxLocalDay(boxRoot, now?)` (`core/box/local-day.ts`) replace the four functions and the six fallback copies; each caller keeps its clock (commit fa89bc30a). Durations: the schedules parser is now `parseScheduleDuration`, so no two parsers share a name. `parseTimespan` keeps `m` as months, and `bbx calendar` help, its error, and the agent guide now say so (commit 5c6bdf7c0). The three grammars stay separate on purpose: `schedule.yaml` takes whole hours, days and weeks, and `bbx calendar` takes days, weeks and months.

Status 2026-10-23 (worktree-dup-sweep-backend): elapsed-time text now uses `beebox/src/shared/relative-time.ts` (commit 1e737840d). Still open: the box-local day implementations and the duration parsers below.

## Box-local day

Three functions compute "today in the box's timezone":
`boxLocalDay` (`beebox/src/connector-activity/core.ts:117`),
`getTriageTodoDate` (`beebox/src/core/triage/todo.ts:16`, which reads the box
clock through `getBoxTime`), and the epoch forms `boxTodayEpoch`
(`beebox/src/core/todo/review-sweep.ts:43`) and `boxLocalDateEpoch`
(`beebox/src/shared/todo-model.ts:387`). The fallback
`(await loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone`
is repeated in six files (`core/triage/todo.ts`, `core/todo/query.ts`,
`core/todo/count.ts`, `core/todo/review-sweep.ts`, `cli/commands/calendar.ts`,
`connector-activity/core.ts`).

Whether each reads the box clock (simulated time) or the real clock matters
for the journey walks; merging must keep that.

## Elapsed time as short text

At least eight formatters turn milliseconds into "5m", "3h", "2d" or
"5m ago", with different cutoffs and rounding:
`formatDurationShort` (`beebox/src/core/schedule/health-box.ts:169`, about 15
callers), `formatAge` (`beebox/src/lib/git-stale-lock.ts:390`, minutes up to
90), `formatOffset` (`beebox/src/core/notification/health.ts:104`),
`ago` (`bin/deploy-status-render.ts:31`, minutes up to 120),
`formatDuration` (`beebox/src/cli/commands/scheduled.ts:109`, floors),
`describeElapsed` (`beebox/src/core/session-context.ts:112`),
`formatDuration` (`beebox/src/field-test/report.ts:37`).
A merge changes the text a person or agent reads for some of them.

## Duration parsing

`parseDuration` (`beebox/src/scheduled-script-duration.ts:34`) accepts
`1.5h`, `30m`, `2w`. `bin/lib/schedules.ts:57` has a narrower `parseDuration`
with the same name (whole `d`, `h`, `w` only). `parseTimespan`
(`beebox/src/connectors/google-calendar/utils.ts:360`) reads `m` as months,
not minutes. The narrow grammars may be deliberate; the shared name and the
different meaning of `m` are a trap.
