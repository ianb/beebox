---
title: "Two engine checkouts on one box silently truncate each other's events.db"
area: callback-box
filed-by: agent
discovered-in: main session — while scoping the worktree workflow redesign
labels: [worktrees, data-loss]
---

`event-bus.ts` opens `.callback-box/events.db` and reconciles against an
in-process `EVENT_SCHEMA_GENERATION` constant (`event-bus.ts:47-51`), **dropping
the events table on any mismatch**. The comment explains the intent — clients
reconnecting across a deploy — which assumes exactly one engine version is ever
live against a box.

That assumption is violable today with no warning. A worktree's
`callback-box/.env` can carry `BOXES=/path/to/a/real/box` (`bin/router.ts:150-186`),
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
(`callback-box/docs/implemented-plans/boxes-as-packages-v2.md:579-585`: "two
engines on one `events.db`/chat runtime … no code-level guard planned"), but
that was written when the only boxes at risk were disposable clones.

Possible directions, none decided:

- Refuse to truncate when the on-disk generation is *newer* than ours (an older
  engine opening a newer box is the destructive direction, and it's detectable).
- A cross-process advisory lock on the box, so a second engine refuses or warns
  rather than opening. `src/lib/file-lock.ts` already interoperates across
  checkouts — the lock paths are box-relative and engine-agnostic.
- Tag shared `.callback-box/` state with the engine identity that wrote it.

Related: [worktree/session workflow redesign](../features/2026-08-08-worktree-session-workflow-redesign.md),
which wants running new engine code against real boxes and is blocked on this.
