import type { IncomingHttpHeaders } from "node:http";

import type { RouterAuthDecision } from "./router-auth.js";
import { rewriteMobileCookiePath } from "./router-cookie.js";

export interface MobileBootstrapTarget {
  authorization: string;
  boxSlug: string;
  worktree: string;
}

interface RequestFacts {
  method?: string | undefined;
  url?: string | undefined;
  headers: IncomingHttpHeaders;
}

/**
 * A bearer-authenticated document navigation gets the Vite HTML shell rather
 * than a response from the box, so the box has no opportunity to mint the
 * short-lived browser cookie. Native API requests remain bearer-only and must
 * not pay for a redundant session exchange.
 */
export function mobileBootstrapTarget(
  request: RequestFacts,
  decision: RouterAuthDecision,
): MobileBootstrapTarget | null {
  if (
    decision.allow === false ||
    decision.route.kind !== "box" ||
    decision.route.targetBox === null ||
    request.method !== "GET" ||
    typeof request.headers.authorization !== "string"
  ) {
    return null;
  }
  const pathname = (request.url ?? "").split("?")[0] ?? "";
  const boxBase = `/${decision.route.targetWorktree}/${decision.route.targetBox}`;
  if (pathname !== boxBase && pathname.startsWith(`${boxBase}/`) === false) {
    return null;
  }
  const boxPath = pathname.slice(boxBase.length);
  if (boxPath === "/api" || boxPath.startsWith("/api/")) {
    return null;
  }
  return {
    authorization: request.headers.authorization,
    boxSlug: decision.route.targetBox,
    worktree: decision.route.targetWorktree,
  };
}

/**
 * Ask the box to exchange the durable device bearer for its signed browser
 * session, then adapt the box-relative cookie path to the router's Vite base.
 * The router never signs a box credential itself.
 */
export async function bootstrapMobileSessionCookie(opts: {
  authorization: string;
  backendPort: number;
  boxSlug: string;
  worktree: string;
}): Promise<string[] | null> {
  const response = await fetch(
    `http://127.0.0.1:${opts.backendPort}/${encodeURIComponent(opts.boxSlug)}/api/pairing/session`,
    {
      method: "POST",
      headers: { authorization: opts.authorization },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (response.status !== 204) {
    return null;
  }
  const setCookie = response.headers.get("set-cookie") ?? undefined;
  return rewriteMobileCookiePath(setCookie, {
    worktree: opts.worktree,
    boxSlug: opts.boxSlug,
  }) ?? null;
}
