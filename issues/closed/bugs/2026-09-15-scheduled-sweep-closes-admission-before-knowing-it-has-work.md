---
title: "The hourly sweep closes box admission before it knows whether it has any work"
workstream: migration-admission-cost
area: beebox
priority: important
filed-by: agent
discovered-by: Ian
discovered-in: main — a local box refused a chat send with "Box admission is closed; retry after maintenance"
resolution: implemented
---

Resolved by `7bd19c63f` (every admission names its holder), `65af4d7a6`
(peek before closing; `--yield`; refusal names reason and deadline), and
`a78a172a3` (yield closes briefly since an idle chat run holds its lease
until the server sees a phase). `sweepMigrations` and `refreshGeneratedDocs`
now peek under an ordinary work lease (`peekBoxWork`,
`src/lib/box-maintenance.ts`) before escalating, so a current box never
closes admission. The scheduled pass also yields to live work instead of
draining it unconditionally (`--yield`, `src/core/migration-sweep.ts`), and
a refusal now names its holder and expected reopening
(`describeWorkHolders`, `retryAfterMs`/`Retry-After`). Plan:
`docs/implemented-plans/migration-admission-cost.md`. No divergence from the
plan's four tracks.

`sweepMigrations` shuts a box before reading its manifest. On a box with nothing
pending, the hourly `box-convergence` schedule still takes the box away from the
boxholder for up to ten minutes and then does nothing.

The lockout window is exactly when the box is in use. An idle box drains
instantly and the sweep is invisible; a box with a live chat run holds a work
lease for the whole run, so that is the only case where the drain blocks — and
the person it blocks is the one using the box.

## Observed

A local box refused an interactive chat send. Timeline from its gate directory
and the process table:

| time | event |
|---|---|
| 00:01:54 | chat send takes a work lease; agent run starts ~90 s later |
| 00:18:49 | schedule runs `bbx migrate --sweep --repair --json`, writes `phase: draining` |
| 00:18–00:28 | every new request refused: `Box admission is closed; retry after maintenance` |
| 00:28:49 | drain deadline expires, sweep releases, `phase.json` removed, admission reopens |

The box had nothing to migrate:

```
manifest: present
pending:  []
```

One work lease existed for the whole window, held by the box's own `bbx serve`
for the in-flight chat.

## Cause

Admission closes on the first line of `sweepMigrations`
(`src/core/migration-sweep.ts:69`), before anything reads the manifest:

```ts
const maintenance = await acquireBoxMaintenance(opts.boxRoot, { reason: "migration", … });
```

and `acquireBoxMaintenance` (`src/lib/box-maintenance.ts:224`) welds closing and
draining into one call:

```ts
const held = await closeBoxMaintenance(boxRoot, opts);
try { await held.drain(); return held; }
```

So the caller gets no chance to look first. By the time line 69 returns, the box
is shut and the drain has already run to completion or to its 10-minute default
deadline (`drainMs ?? 600_000`). The cheap check that would settle it —
`readManifest` + `computePending`, a file read — happens several calls deeper,
inside the gate.

`refreshGeneratedDocs` (`src/core/docs-refresh.ts:57`) has the same shape:
`acquireBoxMaintenance` first, then `refreshSnapshot`, which returns
`{ status: "current" }` when there is nothing to do.

The schedule is `cadence: 1h`, so this recurs every hour.

## Not broken, checked

The work permit reaches the chat agent's environment — `warmCompatible`
(`src/services/claude-chat.ts:155`) compares `env.BBX_BOX_WORK` and refuses to
reuse a warm slot across permits — so a running agent's own `bbx` calls are
admitted under the parent's permit and do not deadlock against the closed gate.
Nothing wedges permanently; `sweepMigrations` releases in a `finally`, and a
phase that never left `draining` is removed on release.

## The narrow fix

Read box state under an ordinary work lease, which blocks nobody, and escalate
to `acquireBoxMaintenance` only when something is actually pending. A stale read
between the peek and the escalation is harmless — re-check inside the gate and
release — and that is strictly better than today, where the box is shut
unconditionally. This needs a way to ask "is there work?" without exclusivity,
which the current API does not offer.

## The policy question behind it

Should a *scheduled* sweep evict live work at all, even when it does have
migrations to apply? A deploy must land and is right to take the box. An hourly
background convergence pass is a convenience, and yielding to an active work
lease — try again next hour — may be the better default. That is a separate
decision from the bug above, which is about not paying the cost when there is
provably nothing to do.

## Smaller, also true

`Box admission is closed; retry after maintenance` names neither the holder nor
the expected wait, though both are known: the reason is in `phase.json` and the
drain deadline is computable. The boxholder's only control is a dismiss button.
