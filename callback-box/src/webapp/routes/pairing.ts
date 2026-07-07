import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { redeemMobilePairingTicket } from "../../core/mobile/pairing.js";

const RedeemBody = z.object({
  pairingToken: z.string().min(1),
  deviceLabel: z.string().min(1).optional(),
});

export function isPairingRedeemUrl(url: string): boolean {
  return url.split("?")[0] === "/api/pairing/redeem";
}

export function registerPairingRoutes(
  server: FastifyInstance,
  opts: { boxRoot: string; boxSlug: string },
): void {
  server.post("/api/pairing/redeem", async (request, reply) => {
    const parsed = RedeemBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "invalid request body" });
    }
    const redeemed = redeemMobilePairingTicket(opts.boxRoot, {
      pairingToken: parsed.data.pairingToken,
      deviceLabel: parsed.data.deviceLabel ?? "iOS companion",
    });
    if (!redeemed) {
      return reply.status(401).send({ error: "Pairing code is invalid or expired." });
    }
    return {
      boxSlug: opts.boxSlug,
      label: "Callback Box",
      deviceId: redeemed.deviceId,
      deviceLabel: redeemed.label,
      token: redeemed.deviceToken,
    };
  });
}
