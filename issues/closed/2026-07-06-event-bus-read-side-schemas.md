---
resolution: implemented
---

# EventBus read-side payload validation (Track B follow-up)

**Closed (implemented) by commit ae564c2f** (architectural-review follow-ups,
Track 3). Added `core/event-bus-schemas.ts` (per-event zod schemas for all 13
events; `EventMap` derived via `z.infer`), read-boundary validation in
`parseRows` with a logged/counted `event:"unknown"` sentinel for bad rows, and
`EVENT_SCHEMA_GENERATION` + a one-row `event_meta` table that truncates
persisted events on a generation mismatch (or a legacy no-meta DB) so replayed
rows stay valid against current schemas. Doctests: `test/core/event-bus.doctest.md`.

Track B (architectural review) typed the EventBus **producer** surface: `EventMap`
names every event and `emit<K>`/`emitTransient<K>` reject an unknown event name or
a mistyped payload at the call site (`core/event-bus.ts`).

That typing is producer-side only. The bus is **persisted and cross-process**: a
row read back through `JSON.parse` (`parseRows`) or replayed to another process was
not produced through the typed surface, so the read/subscribe boundary still hands
out `data: unknown`. The tRPC global stream (`webapp/trpc/routers/events.ts`)
exposes `{event: string; data: unknown}` to clients unchanged.

The follow-up (deferred from Track B as too invasive for that chunk, and carrying
live-regression risk if a schema imperfectly matches a real payload): add **per-event
zod schemas** validated at the read/subscribe boundary, with an **unknown-event
sentinel** fallback (the wire-tolerance pattern used for ChatMessage) so a
schema/version drift degrades a single event loudly rather than corrupting the
stream. Deriving `EventMap` from those schemas via `z.infer` would make the schema
the single source of truth.

Prerequisite before implementing: audit each of the ~14 events' every emit site and
write the schema as an exact superset, with a doctest per event, so validation can't
reject a legitimately-shaped payload.
