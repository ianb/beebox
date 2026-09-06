import type { EventBus } from "../../core/event-bus.js";
import type { Services } from "../../services/index.js";

/**
 * Authenticated user identity in the tRPC context. Structurally matches
 * `auth.ts` `SessionUser`, but declared here so the shared context type stays
 * free of the fastify-coupled `auth.ts` module (the frontend SSR caller
 * imports `TrpcContext`, and must not drag `request.cookies` typings in).
 */
export interface TrpcUser {
  email: string;
  name: string;
  picture?: string;
}

export interface TrpcContext {
  boxRoot: string;
  boxSlug: string;
  eventBus: EventBus;
  services: Services;
  /** Authenticated user from the request session cookie, or null. */
  user: TrpcUser | null;
  /**
   * Passed authentication: either the box is in open access (the `openAccess`
   * construction option) or a valid box-authorized session request. Mirrors the
   * box auth preHandler's outcome.
   */
  authed: boolean;
  /**
   * The request is the box owner (or the box is in open access). Mirrors the raw
   * `addOwnerCheck` gate exactly: open (`identity.source === "open"`) OR the
   * caller is the owner.
   */
  isOwner: boolean;
  /**
   * The request carries a REAL authenticated owner identity — an actual signed-in
   * user whose email is the owner's. Unlike {@link isOwner} it does not fold in
   * open access, because "nobody had to prove anything" is not an owner.
   *
   * Almost every owner surface is box-scoped, so open access (a box whose
   * boxholder deliberately opted out of the auth wall) passing them is correct.
   * The secret store is the exception: it is MACHINE-level, spanning every box
   * on the host, so one box's opt-out must not become a grant surface for its
   * neighbours' credentials (`docs/implemented-plans/secret-custody.md`, bias toward strict).
   */
  isAuthenticatedOwner: boolean;
}
