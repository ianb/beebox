import {
  acknowledgeCurrentBoxGrowth,
  expectCurrentBoxGrowthRates,
} from "../../../core/box-growth/health.js";
import { getBoxTime } from "../../../lib/time.js";
import { ownerProcedure } from "../trpc.js";

export const acknowledgeBoxGrowthProcedure = ownerProcedure.mutation(async ({ ctx }) => {
  await acknowledgeCurrentBoxGrowth(ctx.boxRoot, { now: getBoxTime(ctx.boxRoot) });
  return { success: true as const };
});

export const expectBoxGrowthRatesProcedure = ownerProcedure.mutation(async ({ ctx }) => {
  await expectCurrentBoxGrowthRates(ctx.boxRoot, { now: getBoxTime(ctx.boxRoot) });
  return { success: true as const };
});
