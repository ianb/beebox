import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { redeemMobilePairingTicket, registerDevicePush, resolveMobileBearerIdentity } from "../../core/mobile/pairing.js";
import { APNS_ENVIRONMENTS } from "../../services/apns.js";
import { setMobileSessionCookie } from "../mobile-cookie.js";

const RedeemBody = z.object({
  pairingToken: z.string().min(1),
  deviceLabel: z.string().min(1).optional(),
});

/**
 * The phone's APNs registration (docs/mobile-contract.md §5.9). An APNs device
 * token is hex; Apple does not promise its length, so only a generous cap
 * applies. `environment` is the host the build was signed for.
 */
export const PushTokenBody = z.object({
  token: z
    .string()
    .regex(/^[\da-f]+$/i, "token must be the APNs device token in hex")
    .max(512)
    .transform((token) => token.toLowerCase()),
  environment: z.enum(APNS_ENVIRONMENTS),
});

export function isPairingRedeemUrl(url: string): boolean {
  const path = url.split("?")[0] ?? "";
  return path === "/api/pairing/redeem" || /^\/[^/]+\/api\/pairing\/redeem$/.test(path);
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
    const redeemed = await redeemMobilePairingTicket(opts.boxRoot, {
      pairingToken: parsed.data.pairingToken,
      deviceLabel: parsed.data.deviceLabel ?? "iOS companion",
    });
    if (!redeemed) {
      return reply.status(401).send({ error: "Pairing code is invalid or expired." });
    }
    return {
      boxSlug: opts.boxSlug,
      label: "Bee Box",
      deviceId: redeemed.deviceId,
      deviceLabel: redeemed.label,
      token: redeemed.deviceToken,
    };
  });

  /**
   * Exchange the durable device token for a short-lived `bbx_mobile` cookie.
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
    const identity = await resolveMobileBearerIdentity(opts.boxRoot, request.headers["authorization"]);
    if (!identity) {
      return reply.status(401).send({ error: "Mobile device token is invalid or revoked." });
    }
    setMobileSessionCookie(reply, { boxRoot: opts.boxRoot, boxSlug: opts.boxSlug, identity });
    return reply.status(204).send();
  });

  /**
   * Register the phone's APNs token so the box can push to it. The phone posts
   * on every launch (tokens change on reinstall with no signal); the latest
   * token replaces the earlier one. Authenticated by the device bearer only:
   * the registration belongs to the device the bearer names, so a web session
   * has nothing to register.
   */
  server.post("/api/pairing/push-token", async (request, reply) => {
    const identity = await resolveMobileBearerIdentity(opts.boxRoot, request.headers["authorization"]);
    if (!identity) {
      return reply.status(401).send({ error: "Mobile device token is invalid or revoked." });
    }
    const parsed = PushTokenBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "invalid request body" });
    }
    const registered = await registerDevicePush(opts.boxRoot, { deviceId: identity.deviceId, ...parsed.data });
    if (!registered) {
      // Revoked between the bearer check and the write.
      return reply.status(401).send({ error: "Mobile device token is invalid or revoked." });
    }
    return reply.status(204).send();
  });
}
