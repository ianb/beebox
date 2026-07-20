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
   * Passed authentication: either the box is in open mode (the
   * `CB_ALLOW_UNAUTHENTICATED` opt-out) or a valid box-authorized session
   * request. Mirrors the box auth preHandler's outcome.
   */
  authed: boolean;
  /**
   * The request is the box owner (or the box is in open mode). Mirrors the raw
   * `addOwnerCheck` gate exactly: open mode (`identity.source === "open"`) OR
   * the caller is the owner.
   */
  isOwner: boolean;
}
