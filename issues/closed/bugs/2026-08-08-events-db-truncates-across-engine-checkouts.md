---
title: "Two engine checkouts on one box silently truncate each other's events.db"
workstream: bug-burndown-4
resolution: implemented
area: beebox
filed-by: agent
discovered-in: main session — while scoping the worktree workflow redesign
labels: [worktrees, data-loss]
priority: normal
---

**Closed 2026-10-20:** fixed by this workstream's fix commit, which takes the
first direction below. When `.beebox/events.db` carries an event-schema
generation newer than the engine's, `createEventBus` throws
`NewerEventSchemaError` (box written by a newer engine; this engine is older;
use the newer engine) and leaves the rows and stored generation untouched.
`bbx serve` runs the same check read-only (`assertEventSchemaNotNewer`) before
it takes the startup lease or stops the box's previous server, so an older
checkout refuses without killing the newer engine's server. An older on-disk
generation still truncates as before, so a newer engine opening an older box
resets once and then the older engine refuses; the two no longer take turns
wiping each other. The other two directions (a cross-process lock on the box,
engine-identity tagging of `.beebox/` state) were not implemented. Two engines
with the SAME generation sharing a box remain unguarded, as
`boxes-as-packages-v2.md` accepted.

`event-bus.ts` opens `.beebox/events.db` and reconciles against an
in-process `EVENT_SCHEMA_GENERATION` constant (`event-bus.ts:47-51`), **dropping
the events table on any mismatch**. The comment explains the intent — clients
reconnecting across a deploy — which assumes exactly one engine version is ever
live against a box.

That assumption is violable today with no warning. A worktree's
`beebox/.env` can carry `BOXES=/path/to/a/real/box` (`bin/router.ts:150-186`),
which points that worktree's engine at a box the main checkout also serves. If
the two checkouts disagree on the generation constant, they don't race — **they
take turns wiping each other's event history**, once per open.

On a scratch clone that's harmless. On a working box it's unprompted data loss,
and the `BOXES=` override is exactly what someone reaches for when they want to
test new engine code against real data.

The existing guard doesn't cover it: `hub-config.ts:129-182` refuses a
`hub.json` whose slugs canonicalize to the same box root, but that is per-hub —
it cannot see a second worktree's independent router pointed at the same path.

Known and accepted upstream as an unguarded risk
(`beebox/docs/implemented-plans/boxes-as-packages-v2.md:579-585`: "two
engines on one `events.db`/chat runtime … no code-level guard planned"), but
that was written when the only boxes at risk were disposable clones.

Possible directions, none decided:

- Refuse to truncate when the on-disk generation is *newer* than ours (an older
  engine opening a newer box is the destructive direction, and it's detectable).
- A cross-process advisory lock on the box, so a second engine refuses or warns
  rather than opening. `src/lib/file-lock.ts` already interoperates across
  checkouts — the lock paths are box-relative and engine-agnostic.
- Tag shared `.beebox/` state with the engine identity that wrote it.

Related: [workstream real-box attachment](../../features/2026-08-14-workstream-real-box-attachment.md),
which wants running new engine code against real boxes and is blocked on this.
