import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createMobilePairingTicket,
  listMobileDevices,
  revokeMobileDevice,
} from "../../../core/mobile/pairing.js";
import { router, ownerProcedure } from "../trpc.js";

export const pairingRouter = router({
  createTicket: ownerProcedure.mutation(({ ctx }) => {
    return createMobilePairingTicket(ctx.boxRoot, { createdBy: ctx.user?.email ?? null });
  }),

  devices: ownerProcedure.query(({ ctx }) => {
    return listMobileDevices(ctx.boxRoot);
  }),

  revokeDevice: ownerProcedure
    .input(z.object({ deviceId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const ok = revokeMobileDevice(ctx.boxRoot, input.deviceId);
      if (!ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
      }
      return { ok: true };
    }),
});
