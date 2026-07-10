/**
 * Narrow a bus {@link RealtimeEvent} to a specific event's typed payload.
 *
 * `events.subscribe` (via `useBusSubscription`) delivers `{ event, data }` where
 * `data` is typed `unknown` on the wire. Its real shape is the core
 * `EventMap[event]`. This is the SINGLE place that carries `data` across to its
 * `EventMap` type, keyed on a runtime event-name check — the centralized typed
 * helper `code-style.md` blesses in place of a bare `as` at each call site.
 *
 * The narrowing is sound: every persistent bus row is validated against the zod
 * `eventSchemas` on the server read boundary (`event-bus`'s `parseRows`) before
 * it reaches this stream, and transient events are produced only through the
 * typed `emit`/`emitTransient` surface — so a delivered `data` already matches
 * its schema. `busEventData` is the frontend view of that validated boundary.
 *
 * Returns the typed payload when `event.event === name`, else `null` (so a
 * dispatcher can `const d = busEventData(e, "x"); if (d) …` per branch).
 */

import type { RealtimeEvent } from "../hooks/useBusSubscription";
// Type-only, via the sanctioned `@backend` alias: the webapp re-exports these
// core types (frontend/src/lib/trpc imports `AppRouter` the same way). The
// frontend's alias contract can't reach `core/*` directly.
import type { EventMap, BusEventName } from "@backend/trpc/routers/events.js";

export function busEventData<K extends BusEventName>(
  event: RealtimeEvent,
  name: K,
): EventMap[K] | null {
  if (event.event !== name) return null;
  // `data` arrives `unknown`; it matches `EventMap[K]` by the server-side schema
  // validation described above. Centralized here so no call site casts.
  return event.data as EventMap[K];
}
