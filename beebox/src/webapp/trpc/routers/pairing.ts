import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createMobilePairingTicket,
  listMobileDevices,
  mayManageMobileDevice,
  revokeMobileDevice,
  type DeviceViewer,
} from "../../../core/mobile/pairing.js";
import { router, authedProcedure } from "../trpc.js";
import type { TrpcContext } from "../context.js";

function viewer(ctx: TrpcContext): DeviceViewer {
  return { isOwner: ctx.isOwner, email: ctx.user?.email ?? null };
}

export const pairingRouter = router({
  // You pair YOUR OWN device, so anyone with access to the box may mint a
  // ticket — not the owner alone. The ticket records `createdBy`, and the
  // device then acts as that person (see `webapp/server-box-scope.ts`), so a
  // non-owner's phone gets exactly the access its person has and no more.
  createTicket: authedProcedure.mutation(({ ctx }) => {
    const createdBy = ctx.user?.email ?? null;
    // A caller with no person behind it — an agent's loopback bearer, the browse
    // key on a box that did not opt in — would mint a device recorded against
    // nobody, and a device recorded against nobody is owner-only forever. That
    // breaks the rule this whole surface rests on: whoever can pair a phone can
    // unpair it. Refuse rather than create something the creator cannot manage.
    // The owner is exempt because the owner reaches every device anyway, which
    // covers an open-access box, where there is no identity to record and no
    // gate to enforce.
    if (createdBy === null && !ctx.isOwner) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Pairing records who paired the device, so it needs a signed-in person.",
      });
    }
    return createMobilePairingTicket(ctx.boxRoot, { createdBy });
  }),

  // Listing and revoking follow minting: if you can pair your phone you can see
  // it and unpair it. Both were owner-only, which left a non-owner unable to
  // kill their own lost phone and reading "Owner access required" under the
  // heading. Scope is decided HERE, not by two procedures the UI chooses
  // between — one surface that returns what the caller may reach cannot drift
  // into showing an owner's list to somebody else.
  //
  // `scope` tells the UI which list it got, so it can name it honestly rather
  // than implying a short list is the whole box.
  devices: authedProcedure.query(({ ctx }) => {
    const who = viewer(ctx);
    const devices = listMobileDevices(ctx.boxRoot).filter((device) =>
      mayManageMobileDevice(device, who),
    );
    return { scope: who.isOwner ? ("box" as const) : ("own" as const), devices };
  }),

  revokeDevice: authedProcedure
    .input(z.object({ deviceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // NOT_FOUND, not FORBIDDEN, for a device that is somebody else's: a
      // distinct refusal would confirm the id exists on this box.
      const device = listMobileDevices(ctx.boxRoot).find((item) => item.id === input.deviceId);
      if (!device || !mayManageMobileDevice(device, viewer(ctx))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
      }
      const ok = await revokeMobileDevice(ctx.boxRoot, input.deviceId);
      if (!ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
      }
      return { ok: true };
    }),
});
