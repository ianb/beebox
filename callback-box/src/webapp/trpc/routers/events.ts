/**
 * Real-time event subscriptions over the tRPC WebSocket transport.
 *
 * `ping` is the transport probe (Track 1): an incrementing counter, tracked so
 * a reconnect resumes from the last id. The durable `subscribe` over the
 * SQLite event bus lands in Track 2.
 */

import { z } from "zod";
import { tracked } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";

const PING_INTERVAL_MS = 1000;

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export const eventsRouter = router({
  // Transport probe: verifies connect / multiplex / reconnect-resume end to
  // end without depending on the event bus. `lastEventId` is injected by the
  // client on reconnect; we resume the counter from it so a dropped frame is
  // visibly recovered. Removed once `subscribe` (Track 2) is the real consumer.
  ping: publicProcedure
    .input(z.object({ lastEventId: z.string().nullish() }).optional())
    .subscription(async function* (opts) {
      const resume = opts.input?.lastEventId;
      let n = resume ? Number(resume) : 0;
      while (!opts.signal?.aborted) {
        n += 1;
        yield tracked(String(n), { n, at: new Date().toISOString() });
        await sleep(PING_INTERVAL_MS, opts.signal);
      }
    }),
});
