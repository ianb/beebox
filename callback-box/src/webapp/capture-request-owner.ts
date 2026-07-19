import type { FastifyRequest } from "fastify";
import { resolveMobileBearerIdentity } from "../core/mobile/pairing.js";
import { isAuthEnabled, isHubMode, resolveRequestIdentity } from "./auth.js";

export type CaptureRequestOwner =
  | { status: "ok"; email: string | null }
  | { status: "ownerless-mobile" }
  | { status: "unauthenticated" };

export type CaptureOwnerAuthorization =
  | { status: "ok" }
  | { status: "rejected"; statusCode: 401 | 403; error: string };

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

/** Require the same cookie/mobile owner that created a capture session. */
export function authorizeCaptureSessionOwner(opts: {
  boxRoot: string;
  request: FastifyRequest;
  createdBy: string | null;
}): CaptureOwnerAuthorization {
  const owner = resolveCaptureRequestOwner(opts);
  if (owner.status === "unauthenticated") {
    return { status: "rejected", statusCode: 401, error: "Not authenticated" };
  }
  if (owner.status === "ownerless-mobile") {
    return {
      status: "rejected",
      statusCode: 403,
      error: "This paired device predates mobile identity. Re-pair it before using Capture.",
    };
  }
  if (owner.email !== opts.createdBy) {
    return { status: "rejected", statusCode: 403, error: "Capture belongs to another user" };
  }
  return { status: "ok" };
}
