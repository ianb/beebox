/**
 * Real-time event subscriptions over the tRPC WebSocket transport.
 *
 * `subscribe` is the durable global stream — the WebSocket replacement for the
 * `/api/events` SSE route. It bridges the SQLite-backed event bus into an async
 * generator: persistent events are `tracked()` by their bus id so a reconnect
 * replays exactly what was missed (the client resends `lastEventId`, the bus
 * replays from `afterId`); transient (negative-id) events are yielded plain and
 * are not resumable, matching the prior SSE behavior.
 *
 * `turnStream` is the resumable per-turn agent output stream (see
 * chat-turn-buffer).
 */

import { z } from "zod";
import { tracked } from "@trpc/server";
import type { BusEvent } from "../../../core/event-bus.js";
import type { ChatMessage } from "../../../core/chat-session.js";
import { ensureBoxWatcher } from "../../../core/box-file-watcher.js";
import { getTurnBuffer } from "../../../core/chat-turn-buffer.js";
import { router, publicProcedure } from "../trpc.js";

/** Cap on the per-subscriber bus queue before coalescing transient events. */
const MAX_BUS_QUEUE = 1000;

/** Wire shape delivered to subscribers — matches the old SSEEvent `{event,data}`. */
interface BusPayload {
  event: string;
  data: unknown;
}

/**
 * A frame on the per-turn stream. `msg` carries one agent message; `resync`
 * tells the client to fall back to a history refetch (the turn is unknown,
 * GC'd, or a reconnect landed past evicted frames); `error` is a terminal
 * failure that produced no result.
 */
type TurnStreamFrame =
  | { t: "msg"; msg: ChatMessage }
  | { t: "resync" }
  | { t: "error"; error: string };

export const eventsRouter = router({
  // The durable global stream. Replays missed persistent events from the bus
  // (via afterId/lastEventId), then streams live ones. Bridges the bus's
  // push-listener into an async generator with a small queue + a wake promise;
  // an abort listener (client unsubscribe / disconnect) wakes the loop so the
  // `finally` can unsubscribe.
  subscribe: publicProcedure
    .input(z.object({ lastEventId: z.string().nullish() }).optional())
    .subscription(async function* (opts) {
      const signal = opts.signal;
      // The bus's `file-change` events come from this watcher; start it here so
      // the subscription is self-sufficient (the SSE route used to do this).
      ensureBoxWatcher(opts.ctx.boxRoot, opts.ctx.eventBus);
      const afterId = opts.input?.lastEventId ? Number(opts.input.lastEventId) : 0;
      const queue: BusEvent[] = [];
      let wake: (() => void) | null = null;
      const ping = (): void => {
        if (wake) {
          wake();
          wake = null;
        }
      };
      const sub = opts.ctx.eventBus.subscribe({
        afterId,
        listener: (ev) => {
          // Bound memory for a slow/backgrounded subscriber: when the queue is
          // full, coalesce by dropping the oldest transient (negative-id)
          // event — those (e.g. file-change) are idempotent UI hints. Persistent
          // events are never dropped: they stay deliverable and resumable from
          // the bus on reconnect, so the resume guarantee holds. (An all-
          // persistent overflow is unrealistic at single-box event rates.)
          if (queue.length >= MAX_BUS_QUEUE) {
            const oldestTransient = queue.findIndex((q) => q.id < 0);
            if (oldestTransient !== -1) queue.splice(oldestTransient, 1);
          }
          queue.push(ev);
          ping();
        },
      });
      signal?.addEventListener("abort", ping, { once: true });
      try {
        while (!signal?.aborted) {
          const ev = queue.shift();
          if (ev === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          const payload: BusPayload = { event: ev.event, data: ev.data };
          // Positive id → persistent → resumable. Negative → transient.
          yield ev.id > 0 ? tracked(String(ev.id), payload) : payload;
        }
      } finally {
        sub.unsubscribe();
      }
    }),
  // Per-turn agent output stream, resumable by `turnId`. Replays the turn's
  // buffered frames after `lastEventId` (the last seq the client saw), then
  // streams live, tracking each by its seq so a dropped WebSocket resumes
  // mid-turn with no gap. An unknown/GC'd turn or a reconnect past evicted
  // frames yields `{t:"resync"}` → the client falls back to a history refetch.
  turnStream: publicProcedure
    .input(z.object({ turnId: z.string().min(1), lastEventId: z.string().nullish() }))
    .subscription(async function* (opts) {
      const signal = opts.signal;
      const buffer = getTurnBuffer(opts.input.turnId);
      let lastSeq = opts.input.lastEventId ? Number(opts.input.lastEventId) : 0;

      if (!buffer || buffer.hasGapAfter(lastSeq)) {
        const resync: TurnStreamFrame = { t: "resync" };
        yield resync;
        return;
      }

      while (!signal?.aborted) {
        // Snapshot the change counter before draining so a frame pushed while
        // we're yielding can't be missed: waitForChange returns immediately if
        // the version moved on.
        const version = buffer.versionSnapshot();
        for (const frame of buffer.framesAfter(lastSeq)) {
          lastSeq = frame.seq;
          const out: TurnStreamFrame = { t: "msg", msg: frame.msg };
          yield tracked(String(frame.seq), out);
        }
        if (buffer.complete && buffer.framesAfter(lastSeq).length === 0) {
          // Delivered everything. A failure with no result frame is surfaced;
          // otherwise the agent's own `result` frame already ended the turn.
          if (buffer.errored !== null) {
            const err: TurnStreamFrame = { t: "error", error: buffer.errored };
            yield err;
          }
          return;
        }
        await buffer.waitForChange(signal, version);
      }
    }),
});
