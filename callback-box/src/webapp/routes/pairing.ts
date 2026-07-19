import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { redeemMobilePairingTicket, resolveMobileBearerIdentity } from "../../core/mobile/pairing.js";
import { setMobileSessionCookie } from "../mobile-cookie.js";

const RedeemBody = z.object({
  pairingToken: z.string().min(1),
  deviceLabel: z.string().min(1).optional(),
});

export function isPairingRedeemUrl(url: string): boolean {
  const path = url.split("?")[0];
  return path === "/api/pairing/redeem" || path?.endsWith("/api/pairing/redeem") === true;
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

  /**
   * Exchange the durable device token for a short-lived `cb_mobile` cookie.
   *
   * The recovery path: a WebKit-initiated reload (back/forward, content-process
   * crash) re-issues the bare URL with no Authorization header, so once the
   * cookie lapses the page 401s. The web layer then calls this with the token
   * it holds and retries — which is why the durable token never has to go back
   * into a URL to re-establish a session.
   *
   * The box auth preHandler already accepted this request (that is what proves
   * the bearer), so this handler only has to mint. It re-resolves the identity
   * rather than trusting that, per the same fail-closed reasoning the tRPC
   * context uses.
   */
  server.post("/api/pairing/session", async (request, reply) => {
    const identity = resolveMobileBearerIdentity(opts.boxRoot, request.headers["authorization"]);
    if (!identity) {
      return reply.status(401).send({ error: "Mobile device token is invalid or revoked." });
    }
    setMobileSessionCookie(reply, { boxRoot: opts.boxRoot, boxSlug: opts.boxSlug, identity });
    return reply.status(204).send();
  });
}
