/**
 * Who may open the box browser page, and from where
 * (docs/plans/shared-browser.md, Track C, `ALL /browser`).
 *
 * The page is for the person. The box auth hook in front of it admits the
 * agent bearer and the browse key too, and lets any path with an asset
 * extension through unauthenticated, so this gate runs its own check on every
 * request under `/browser`, including the dashboard's scripts and the
 * WebSocket upgrade. An agent that reached the page could read the profile's
 * cookies in the dashboard's Storage pane; agents use `bbx browser` instead.
 *
 * The dashboard's own API (`/api/exec`, `/api/kill`) acts on the browser with
 * the person's cookie, so a request that names an `Origin` must come from the
 * page's own origin. The engine usually sits behind a proxy that rewrites
 * `Host` (the hub and the dev router both use `changeOrigin`), so the
 * request's `Host` often is not the origin the browser used. Three answers
 * count as same-origin: `Origin` equals the request's own origin
 * (`request.protocol` and `request.host`, which honour `X-Forwarded-*`),
 * `Origin` equals the box's configured public URL, or the browser itself says
 * `Sec-Fetch-Site: same-origin`.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAgentBearer } from "../../../../core/agent/token.js";
import { verifyBrowseKey } from "../../../../core/browse-key.js";
import { resolveMobileRequestAuth } from "../../../../core/mobile/request-auth.js";
import { resolveBoxPublicUrl } from "../../../../lib/public-url.js";
import { assertNever } from "../../../../shared/invariant.js";
import { getOwnerEmail, isHubMode } from "../../../auth.js";
import { loginRedirect } from "../../../base-prefix.js";
import { canAccessBox } from "../../../box-access.js";
import { resolveBoxIdentity } from "../../../box-identity.js";

export const AGENTS_REFUSED = "the browser page is for people; agents use bbx browser";

export interface PersonGateContext {
  readonly boxRoot: string;
  readonly openAccess: boolean;
}

/** A refusal to send, or null when the request may go on. */
export type GateRefusal = { readonly status: number; readonly error: string } | { readonly status: "login" };

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch (_e) {
    return null;
  }
}

/** True when the request names no `Origin`, or names this box's own. */
export async function isSameOrigin(ctx: PersonGateContext, request: FastifyRequest): Promise<boolean> {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (request.headers["sec-fetch-site"] === "same-origin") return true;
  if (origin === `${request.protocol}://${request.host}`) return true;
  const publicUrl = await resolveBoxPublicUrl(ctx.boxRoot);
  return publicUrl !== undefined && originOf(publicUrl) === origin;
}

/** An unauthenticated top-level page load, which goes to the login page instead of a 401. */
function isNavigation(request: FastifyRequest): boolean {
  return request.method === "GET" && request.headers.upgrade === undefined && (request.headers.accept ?? "").includes("text/html");
}

/** Decide whether a request under `/browser` is from a person allowed into this box. */
export async function checkPerson(ctx: PersonGateContext, request: FastifyRequest): Promise<GateRefusal | null> {
  const { boxRoot } = ctx;
  if (verifyAgentBearer(boxRoot, request.headers.authorization) || verifyBrowseKey(request.headers)) {
    return { status: 403, error: AGENTS_REFUSED };
  }
  if (!(await isSameOrigin(ctx, request))) {
    return { status: 403, error: "the browser page only accepts requests from its own origin" };
  }
  if ((await resolveMobileRequestAuth(boxRoot, request.headers)) !== null) return null;
  const identity = await resolveBoxIdentity({ boxRoot, request, openAccess: ctx.openAccess });
  switch (identity.source) {
    case "unavailable":
      return { status: 503, error: "Authentication temporarily unavailable" };
    case "open":
      return null;
    case "browse":
      // The browse key was refused above; a browse identity without it cannot occur.
      return { status: 403, error: AGENTS_REFUSED };
    case "hub":
    case "cookie":
    case null:
      break;
    default:
      assertNever(identity.source);
  }
  if (identity.email === null) {
    // Behind a hub the hub owns login, as in the box auth hook.
    return isNavigation(request) && !isHubMode() ? { status: "login" } : { status: 401, error: "Not authenticated" };
  }
  if (!(await canAccessBox({ boxRoot, email: identity.email, ownerEmail: getOwnerEmail() }))) {
    return { status: 403, error: "Not authorized for this box" };
  }
  return null;
}

/** Send `refusal` as the reply. */
export function sendRefusal(refusal: GateRefusal, { request, reply }: { request: FastifyRequest; reply: FastifyReply }): FastifyReply {
  if (refusal.status === "login") return loginRedirect(request, reply);
  return reply.status(refusal.status).send({ error: refusal.error });
}
