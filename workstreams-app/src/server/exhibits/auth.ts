// Jupyter-style token->cookie access for the exhibits origin.
//
// The token is machine scoped, minted by the supervisor and handed to this
// process in EXHIBITS_TOKEN. `?token=<t>` on any GET exchanges it for a session
// cookie and redirects to the clean URL, so the capability leaves the address
// bar (W3C TAG capability-URL hygiene: history, logs, referrers). Everything
// else needs the cookie.
//
// The cookie is scoped to this origin only. It grants the exhibits routes and
// nothing else — the router/workstreams authority lives on a different origin
// behind a different credential, which is the whole reason for the second
// listener.
//
// SameSite is NOT a boundary here. Every loopback server is one "site" to a
// browser regardless of port, so any page on any localhost port — including an
// exhibit page's own scripts and anything else the developer runs locally —
// can send a cookie-bearing cross-origin write to this one. Mutating methods
// therefore check `Origin` explicitly: present-and-not-ours is refused, absent
// (curl, a non-browser agent) is allowed, because a browser always sends it on
// a cross-origin write.

import crypto from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";

import { renderUnauthorized } from "./pages.js";

export const EXHIBITS_COOKIE = "cb_exhibits_session";
export const EXHIBITS_TOKEN_PARAM = "token";

export const UNAUTHORIZED_HINT =
  "Exhibits need a token. Run `bin/exhibits url <workstream>/<exhibit>` to print an authorized URL.";

/** Loopback spellings of this origin; only the port is load-bearing. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * True when a mutating request may proceed: no Origin at all (a non-browser
 * client), or an Origin that is this very listener. A browser sends Origin on
 * every cross-origin write, so "absent" is not a hole a page can walk through.
 */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined || origin === "") return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch (_error) {
    // "null" (a sandboxed iframe) and anything unparseable are not this origin.
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return false;
  return parsed.port === String(port);
}

function isMutating(request: FastifyRequest): boolean {
  return request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS";
}

/** Constant-time compare, same shape as app.ts's capabilitiesMatch. */
export function tokensMatch(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

/** Minimal cookie-header read; the origin sets exactly one cookie. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

function sessionCookie(token: string): string {
  return `${EXHIBITS_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
}

export function registerExhibitsAuth(app: FastifyInstance, options: { token: string; port: number }): void {
  const { token } = options;
  app.addHook("onRequest", async (request, reply) => {
    const url = new URL(request.url, "http://exhibits.invalid");
    const presented = url.searchParams.get(EXHIBITS_TOKEN_PARAM);
    if (presented !== null && request.method === "GET" && tokensMatch(presented, token)) {
      url.searchParams.delete(EXHIBITS_TOKEN_PARAM);
      const target = `${url.pathname}${url.search}`;
      await reply.header("set-cookie", sessionCookie(token)).redirect(target, 302);
      return;
    }
    if (!tokensMatch(readCookie(request.headers.cookie, EXHIBITS_COOKIE), token)) {
      await reply
        .code(401)
        .type("text/html; charset=utf-8")
        .send(renderUnauthorized(UNAUTHORIZED_HINT));
      return;
    }
    if (isMutating(request) && !originAllowed(request.headers.origin, options.port)) {
      await reply.code(403).type("text/plain; charset=utf-8").send(
        `Refused: this write came from ${request.headers.origin ?? "an unknown origin"}, not the exhibits origin.\n`,
      );
      return;
    }
  });
}
