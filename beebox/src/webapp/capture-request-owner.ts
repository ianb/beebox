import type { FastifyRequest } from "fastify";
import { resolveMobileBearerIdentity } from "../core/mobile/pairing.js";
import { resolveBoxIdentity } from "./box-identity.js";

export type CaptureRequestOwner =
  | { status: "ok"; email: string | null }
  | { status: "ownerless-mobile" }
  | { status: "auth-store-unavailable" }
  | { status: "unauthenticated" };

export type CaptureOwnerAuthorization =
  | { status: "ok" }
  | { status: "rejected"; statusCode: 401 | 403 | 503; error: string };

/** Resolve cookie/hub, browse-owner and paired-device credentials to one capture owner. */
export async function resolveCaptureRequestOwner(opts: {
  boxRoot: string;
  request: FastifyRequest;
}): Promise<CaptureRequestOwner> {
  const requestIdentity = await resolveBoxIdentity({
    boxRoot: opts.boxRoot,
    request: opts.request,
    openAccess: opts.request.server.openAccess,
  });
  if (requestIdentity.email) {
    return { status: "ok", email: requestIdentity.email };
  }

  const mobileIdentity = await resolveMobileBearerIdentity(
    opts.boxRoot,
    opts.request.headers["authorization"],
  );
  if (mobileIdentity) {
    if (mobileIdentity.createdBy) {
      return { status: "ok", email: mobileIdentity.createdBy };
    }
    // Open mode (standalone opt-out or hub-wide off) — the resolver already
    // reported `source: "open"`, so an owner-less paired device is fine.
    if (requestIdentity.source === "open") {
      return { status: "ok", email: null };
    }
    return { status: "ownerless-mobile" };
  }

  if (requestIdentity.source === "open") {
    return { status: "ok", email: null };
  }
  // No cookie/hub identity and no paired device. Distinguish a corrupt/unreadable
  // credential store (fail closed with 503, Track D) from a plain unauthenticated
  // request (401) — checked AFTER mobile, which doesn't consult that store.
  if (requestIdentity.source === "unavailable") {
    return { status: "auth-store-unavailable" };
  }
  return { status: "unauthenticated" };
}

/** Require the same cookie/mobile owner that created a capture session. */
export async function authorizeCaptureSessionOwner(opts: {
  boxRoot: string;
  request: FastifyRequest;
  createdBy: string | null;
}): Promise<CaptureOwnerAuthorization> {
  const owner = await resolveCaptureRequestOwner(opts);
  if (owner.status === "unauthenticated") {
    return { status: "rejected", statusCode: 401, error: "Not authenticated" };
  }
  if (owner.status === "auth-store-unavailable") {
    return { status: "rejected", statusCode: 503, error: "Authentication temporarily unavailable" };
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
