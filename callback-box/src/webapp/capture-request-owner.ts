import type { FastifyRequest } from "fastify";
import { resolveMobileBearerIdentity } from "../core/mobile/pairing.js";
import { isAuthEnabled, isHubMode, resolveRequestIdentity } from "./auth.js";

export type CaptureRequestOwner =
  | { status: "ok"; email: string | null }
  | { status: "ownerless-mobile" }
  | { status: "unauthenticated" };

/** Resolve cookie/hub and paired-device credentials to one capture owner. */
export function resolveCaptureRequestOwner(opts: {
  boxRoot: string;
  request: FastifyRequest;
}): CaptureRequestOwner {
  const requestIdentity = resolveRequestIdentity(opts.request);
  if (requestIdentity.email) {
    return { status: "ok", email: requestIdentity.email };
  }

  const mobileIdentity = resolveMobileBearerIdentity(
    opts.boxRoot,
    opts.request.headers["authorization"],
  );
  if (mobileIdentity) {
    if (mobileIdentity.createdBy) {
      return { status: "ok", email: mobileIdentity.createdBy };
    }
    if (!isAuthEnabled()) {
      return { status: "ok", email: null };
    }
    return { status: "ownerless-mobile" };
  }

  const openStandalone = !isHubMode() && !isAuthEnabled();
  if (requestIdentity.source === "open" || openStandalone) {
    return { status: "ok", email: null };
  }
  return { status: "unauthenticated" };
}
