import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createMobilePairingTicket,
  listMobileDevices,
  revokeMobileDevice,
} from "../../../core/mobile/pairing.js";
import { router, authedProcedure, ownerProcedure } from "../trpc.js";

export const pairingRouter = router({
  // You pair YOUR OWN device, so anyone with access to the box may mint a
  // ticket — not the owner alone. The ticket records `createdBy`, and the
  // device then acts as that person (see `webapp/server-box-scope.ts`), so a
  // non-owner's phone gets exactly the access its person has and no more.
  //
  // Listing and revoking stay owner-only below: those span every device on the
  // box, including other people's.
  createTicket: authedProcedure.mutation(({ ctx }) => {
    return createMobilePairingTicket(ctx.boxRoot, { createdBy: ctx.user?.email ?? null });
  }),

  devices: ownerProcedure.query(({ ctx }) => {
    return listMobileDevices(ctx.boxRoot);
  }),

  revokeDevice: ownerProcedure
    .input(z.object({ deviceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ok = await revokeMobileDevice(ctx.boxRoot, input.deviceId);
      if (!ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
      }
      return { ok: true };
    }),
});
