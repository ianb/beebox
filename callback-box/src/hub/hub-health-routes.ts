/**
 * The hub's two diag-gated health routes, extracted from `hub-server.ts` to
 * keep `createHubServer` under its line cap.
 *
 * Both require the `CB_DIAG_API_KEY` bearer token, mirroring the box server's
 * own `/healthz` (`src/webapp/server-root.ts`). The hub's `/healthz` used to
 * be unauthenticated, publicly leaking slugs/PIDs/ports/error strings (nginx
 * proxies `/` straight to the hub), and reported a constant `status: "ok"`.
 *
 * - `GET /healthz` — the PASSIVE verdict from `getHealth()` (derived in
 *   `cli/commands/hub.ts` via `hubVerdict()`), served 503 when unhealthy so a
 *   monitor reading only the status code still alarms. No side effects.
 * - `GET /healthz/canary` — the ACTIVE check: cold-start one box and confirm
 *   it serves. The passive verdict only sees boxes the supervisor already
 *   tried to start; on a lazy hub most rest `stopped` and report nothing, so a
 *   fleet-wide startup break (e.g. a shared native-module ABI mismatch — the
 *   2026-07-16 incident) is invisible to it. The deploy can't drive a box
 *   through the normal proxy path — that's behind the session-cookie auth wall
 *   (`decideHubAuth`), and the diag key alone gets redirected to login — so
 *   this route drives `ensureRunning` server-side. Deploy-only; not a monitor
 *   endpoint (it wakes a box). See `docs/health-checks.md`.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyDiagBearerKey } from "../webapp/auth.js";
import { errorMessage } from "../lib/error-guards.js";
import type { Endpoint, EndpointProvider } from "./endpoints.js";
import type { HubHealth } from "./hub-server.js";

/** 503 when the diag key isn't configured, 401 when it's missing/wrong; false
 *  means the reply was already sent and the handler must stop. */
function requireDiagKey(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!process.env.CB_DIAG_API_KEY) {
    void reply.status(503).send({ status: "unconfigured", error: "CB_DIAG_API_KEY not set" });
    return false;
  }
  if (!verifyDiagBearerKey(request)) {
    void reply.status(401).send({ status: "unauthorized" });
    return false;
  }
  return true;
}

export function registerHealthRoutes(
  app: FastifyInstance,
  { endpoints, getHealth }: { endpoints: EndpointProvider; getHealth: () => HubHealth },
): void {
  app.get("/healthz", async (request, reply) => {
    if (!requireDiagKey(request, reply)) return reply;
    const health = getHealth();
    return reply.status(health.status === "unhealthy" ? 503 : 200).send(health);
  });

  // `?box=` names the canary; unset picks the first configured slug. On a lazy
  // hub `ensureRunning` cold-starts and waits for readiness; on a non-lazy hub
  // it's `get()` under the hood and the box is already up. 200 if it reaches a
  // live endpoint, 503 (naming the slug) if it can't — the exact signal the
  // deploy needs when a child crash-loops.
  app.get<{ Querystring: { box?: string } }>("/healthz/canary", async (request, reply) => {
    if (!requireDiagKey(request, reply)) return reply;
    const slug = request.query.box ?? endpoints.slugs()[0];
    if (slug === undefined) return reply.status(503).send({ status: "no-boxes" });
    let endpoint: Endpoint | undefined;
    try {
      endpoint = (await endpoints.ensureRunning?.(slug)) ?? endpoints.get(slug);
    } catch (e) {
      return reply.status(503).send({ status: "canary-failed", slug, error: errorMessage(e) });
    }
    if (!endpoint) return reply.status(503).send({ status: "canary-failed", slug });
    return reply.status(200).send({ status: "ok", slug });
  });
}
