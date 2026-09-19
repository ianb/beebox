/**
 * Connector activity on the dashboard: one warning per connector that has gone
 * quiet or keeps failing, until the condition clears or the owner dismisses it.
 * Healthy connectors add no line — an "ok" per connector would be noise on
 * every dashboard. See `connectors/activity-verdict.ts` for the rule.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { dismissConnectorEpisode, NoConnectorEpisodeError, undismissedEpisodes } from "../../../connectors/activity-episodes.js";
import { describeVerdict } from "../../../connectors/activity-verdict.js";
import { errorMessage } from "../../../lib/error-guards.js";
import { getBoxTime } from "../../../lib/time.js";
import { ownerProcedure } from "../trpc.js";
import type { HealthCheck } from "./health.js";

/** Check names are `connector-activity:<connector>`; the dismiss input is the check name. */
const CHECK_PREFIX = "connector-activity:";

export async function connectorActivityHealthChecks(boxRoot: string, { now }: { now: Date }): Promise<HealthCheck[]> {
  let episodes;
  try {
    episodes = await undismissedEpisodes(boxRoot, now);
  } catch (e) {
    // A damaged record is reported, not reset: resetting would discard dismissals.
    return [{ name: "connector-activity", ok: false, message: errorMessage(e), severity: "warning" }];
  }
  return episodes.flatMap(({ connector, verdict }) => {
    const message = describeVerdict(connector, verdict);
    if (message === null) return [];
    return [{
      name: `${CHECK_PREFIX}${connector}`,
      ok: false,
      message,
      severity: "warning" as const,
      actions: ["dismiss-connector-episode" as const],
    }];
  });
}

export const dismissConnectorEpisodeProcedure = ownerProcedure
  .input(z.object({ check: z.string().startsWith(CHECK_PREFIX) }))
  .mutation(async ({ ctx, input }) => {
    const connector = input.check.slice(CHECK_PREFIX.length);
    try {
      await dismissConnectorEpisode(ctx.boxRoot, { connector, now: getBoxTime(ctx.boxRoot) });
    } catch (e) {
      if (e instanceof NoConnectorEpisodeError) throw new TRPCError({ code: "NOT_FOUND", message: e.message });
      throw e;
    }
    return { success: true as const };
  });
