import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { saveLocation } from "../../../core/location-store.js";
import { getBoxTimeISO } from "../../../lib/time.js";

/**
 * User location capture. The web frontend posts a Geolocation fix here (with
 * the user's explicit consent); it's cached in `.beebox/location.json`
 * for `bbx location get` to read on demand. Coordinates are never logged.
 */
export const locationRouter = router({
  capture: publicProcedure
    .input(
      z.object({
        lat: z.number().finite().min(-90).max(90),
        lng: z.number().finite().min(-180).max(180),
        accuracy: z.number().finite().nonnegative(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await saveLocation(ctx.boxRoot, {
        lat: input.lat,
        lng: input.lng,
        accuracy: input.accuracy,
        capturedAt: getBoxTimeISO(ctx.boxRoot),
        source: "web",
      });
      return { ok: true };
    }),
});
