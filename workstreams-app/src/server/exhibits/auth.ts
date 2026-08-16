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

import crypto from "node:crypto";

import type { FastifyInstance } from "fastify";

export const EXHIBITS_COOKIE = "cb_exhibits_session";
export const EXHIBITS_TOKEN_PARAM = "token";

const UNAUTHORIZED_HINT =
  "Exhibits need a token. Run `bin/exhibits url <workstream>/<exhibit>` to print an authorized URL.";

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

export function registerExhibitsAuth(app: FastifyInstance, token: string): void {
  app.addHook("onRequest", async (request, reply) => {
    const url = new URL(request.url, "http://exhibits.invalid");
    const presented = url.searchParams.get(EXHIBITS_TOKEN_PARAM);
    if (presented !== null && request.method === "GET" && tokensMatch(presented, token)) {
      url.searchParams.delete(EXHIBITS_TOKEN_PARAM);
      const target = `${url.pathname}${url.search}`;
      await reply.header("set-cookie", sessionCookie(token)).redirect(target, 302);
      return;
    }
    if (tokensMatch(readCookie(request.headers.cookie, EXHIBITS_COOKIE), token)) return;
    await reply.code(401).type("text/plain; charset=utf-8").send(`${UNAUTHORIZED_HINT}\n`);
  });
}
